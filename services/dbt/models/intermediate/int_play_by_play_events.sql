-- Basketball-Reference leaves action_type / sub_type null on every row, so the
-- event vocabulary only exists in the free-text description. This model turns
-- that text into typed columns (shots with distance, typed fouls and turnovers,
-- rebounds, free throws, substitutions, challenges) so downstream marts can
-- aggregate events without re-deriving the regexes. It carries the raw action
-- columns through as well, so fct_play_by_play can be a single wide mart
-- instead of a thin sibling pair over the same 632k-row grain.
--
-- Incremental because this is by far the most expensive model in the project:
-- ~30 regex operations per row over the full play_by_play history. Rebuilding
-- every row nightly to add one evening's games cost ~132s; scoping it to newly
-- scraped games makes the daily pass proportional to the slate. Logic changes
-- here need `dbt build --select int_play_by_play_events+ --full-refresh`.
with actions as (
    select * from {{ ref('stg_play_by_play') }}

    {% if is_incremental() %}
        -- A re-scraped game rewrites every one of its rows with a fresh
        -- scraped_at, so this picks up corrections as well as new games, and
        -- delete+insert on game_id replaces the old rows wholesale.
        where scraped_at > (
            select coalesce(max(scraped_at), '-infinity'::timestamp) from {{ this }}
        )
    {% endif %}
),

matched as (
    select
        actions.game_id,
        actions.season,
        actions.action_number,
        actions.action_id,
        actions.period,
        actions.clock,
        actions.team_id,
        actions.player_id,
        actions.secondary_player_id,
        actions.score_home,
        actions.score_away,
        actions.action_type,
        actions.sub_type,
        actions.description,
        actions.scraped_at,
        (regexp_match(actions.description, '(makes|misses) ([23])-pt'))[1] as shot_result,
        (regexp_match(actions.description, '(makes|misses) ([23])-pt'))[2] as shot_points,
        (regexp_match(
            actions.description, '[23]-pt (jump shot|layup|dunk|hook shot|tip-in)'
        ))[1] as shot_type,
        (regexp_match(actions.description, 'from ([0-9]+) ft'))[1] as shot_distance,
        (regexp_match(
            actions.description, '(makes|misses) (technical |flagrant |clear path )?free throw'
        ))[1] as free_throw_result,
        (regexp_match(
            actions.description, '(makes|misses) (technical |flagrant |clear path )?free throw'
        ))[2] as free_throw_kind,
        (regexp_match(actions.description, 'free throw ([0-9]+) of ([0-9]+)'))[1] as free_throw_num,
        (regexp_match(actions.description, 'free throw ([0-9]+) of ([0-9]+)'))[2] as free_throw_of,
        (regexp_match(actions.description, '^(Offensive|Defensive) rebound'))[1] as rebound_side,
        (regexp_match(actions.description, '^Turnover by .*? \((.*?)[;)]'))[1] as turnover_kind,
        (regexp_match(
            actions.description, '^([A-Za-z0-9 ]*?) ?foul(?: type ([0-9]))? by'
        ))[1] as foul_kind,
        (regexp_match(actions.description, '^Flagrant foul type ([0-9])'))[1] as flagrant_degree,
        (regexp_match(actions.description, '^Violation by .*? \((.*?)\)'))[1] as violation_kind,
        (regexp_match(actions.description, '^(.*?) (full|20 second) timeout$'))[2] as timeout_kind,
        (regexp_match(
            actions.description, '^Instant Replay \((Challenge|Request): (.*?)\)'
        ))[1] as replay_kind,
        (regexp_match(
            actions.description, '^Instant Replay \((Challenge|Request): (.*?)\)'
        ))[2] as replay_outcome,
        (regexp_match(
            actions.description, '^(Start|End) of [0-9]+[a-z]{2} (quarter|overtime)'
        ))[1] as period_marker
    from actions
)

-- Plain columns and casts first, derived expressions after (rule ST06).
select
    matched.game_id,
    matched.season,
    matched.action_number,
    matched.action_id,
    matched.period,
    matched.clock,
    matched.team_id,
    matched.player_id,
    matched.secondary_player_id,
    matched.score_home,
    matched.score_away,
    matched.action_type,
    matched.sub_type,
    matched.description,
    matched.scraped_at,
    matched.shot_type,
    matched.turnover_kind,
    matched.violation_kind,
    matched.timeout_kind,
    matched.replay_kind,
    matched.replay_outcome,
    matched.shot_points::int as shot_value,
    matched.free_throw_num::int as free_throw_number,
    matched.free_throw_of::int as free_throw_of,
    matched.flagrant_degree::int as flagrant_degree,
    case
        -- End-of-period heaves are credited to "Team" and carry no 2-pt / 3-pt marker.
        when matched.description ~ 'heave shot' then 'heave'
        when matched.shot_result = 'makes' then 'shot_made'
        when matched.shot_result = 'misses' then 'shot_missed'
        when matched.free_throw_result = 'makes' then 'free_throw_made'
        when matched.free_throw_result = 'misses' then 'free_throw_missed'
        when matched.rebound_side is not null then 'rebound'
        when matched.description ~ '^Turnover' then 'turnover'
        when matched.description ~ 'ejected from game' then 'ejection'
        when matched.description ~ ' foul(?: type [0-9])? by' then 'foul'
        when matched.description ~ 'enters the game for' then 'substitution'
        when matched.timeout_kind is not null then 'timeout'
        when matched.description ~ '^Violation' then 'violation'
        when matched.description ~ '^Jump ball' then 'jump_ball'
        when matched.description ~ '^Instant Replay' then 'replay'
        when matched.period_marker = 'Start' then 'period_start'
        when matched.period_marker = 'End' then 'period_end'
        else 'other'
    end as event_type,
    case
        when matched.shot_distance is not null then matched.shot_distance::int
        when matched.description ~ 'at rim' then 0
    end as shot_distance_ft,
    matched.description ~ 'assist by' as is_assisted,
    matched.description ~ 'block by' as is_blocked,
    matched.description ~ 'steal by' as is_stolen,
    lower(trim(coalesce(matched.free_throw_kind, 'regular'))) as free_throw_kind,
    -- BRef credits uncontested caroms to "Team" rather than a player.
    lower(matched.rebound_side) as rebound_side,
    matched.description ~ 'rebound by Team' as is_team_rebound,
    nullif(lower(trim(coalesce(matched.foul_kind, ''))), '') as foul_kind
from matched
