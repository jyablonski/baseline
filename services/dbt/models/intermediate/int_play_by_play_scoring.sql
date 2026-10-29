-- Materialized rather than a view: four window functions over the full
-- play_by_play history, read by both fct_play_by_play_scoring and
-- fct_game_flow. As a view the entire scan and sort ran once per consumer.
with actions as (
    select * from {{ ref('stg_play_by_play') }}
),

with_clock as (
    select
        actions.game_id,
        actions.season,
        actions.action_number,
        actions.period,
        actions.clock,
        actions.score_home,
        actions.score_away,
        actions.team_id,
        actions.player_id,
        actions.action_type,
        actions.sub_type,
        actions.description,
        case
            when coalesce(actions.period, 1) <= 4 then 720
            else 300
        end as period_length_seconds,
        case
            when actions.clock ~ '^PT' then
                coalesce((regexp_match(actions.clock, '([0-9]+)H'))[1]::numeric, 0) * 3600
                + coalesce((regexp_match(actions.clock, '([0-9]+)M'))[1]::numeric, 0) * 60
                + coalesce((regexp_match(actions.clock, '([0-9]+(?:\.[0-9]+)?)S'))[1]::numeric, 0)
            when actions.clock ~ '^[0-9]+:[0-9]+' then
                split_part(actions.clock, ':', 1)::numeric * 60
                + split_part(actions.clock, ':', 2)::numeric
            else 0
        end as parsed_clock_remaining
    from actions
),

with_elapsed as (
    select
        with_clock.*,
        least(
            greatest(with_clock.parsed_clock_remaining, 0),
            with_clock.period_length_seconds
        ) as clock_remaining_seconds,
        case
            when coalesce(with_clock.period, 1) <= 4 then
                (coalesce(with_clock.period, 1) - 1) * 720
                + (
                    with_clock.period_length_seconds
                    - least(
                        greatest(with_clock.parsed_clock_remaining, 0),
                        with_clock.period_length_seconds
                    )
                )
            else
                4 * 720
                + (with_clock.period - 5) * 300
                + (
                    with_clock.period_length_seconds
                    - least(
                        greatest(with_clock.parsed_clock_remaining, 0),
                        with_clock.period_length_seconds
                    )
                )
        end as elapsed_seconds
    from with_clock
),

filled_scores as (
    select
        with_elapsed.*,
        max(with_elapsed.score_home) over (
            partition by with_elapsed.game_id
            order by with_elapsed.action_number
            rows between unbounded preceding and current row
        ) as filled_score_home,
        max(with_elapsed.score_away) over (
            partition by with_elapsed.game_id
            order by with_elapsed.action_number
            rows between unbounded preceding and current row
        ) as filled_score_away
    from with_elapsed
),

with_previous as (
    select
        filled_scores.*,
        lag(filled_scores.filled_score_home) over (
            partition by filled_scores.game_id
            order by filled_scores.action_number
        ) as prev_score_home,
        lag(filled_scores.filled_score_away) over (
            partition by filled_scores.game_id
            order by filled_scores.action_number
        ) as prev_score_away
    from filled_scores
),

scoring as (
    select
        with_previous.game_id,
        with_previous.season,
        with_previous.action_number,
        with_previous.period,
        with_previous.clock,
        with_previous.clock_remaining_seconds,
        greatest(with_previous.elapsed_seconds, 0) as elapsed_seconds,
        with_previous.filled_score_home as score_home,
        with_previous.filled_score_away as score_away,
        with_previous.filled_score_home - with_previous.filled_score_away as score_differential,
        coalesce(with_previous.filled_score_home, 0)
        - coalesce(with_previous.prev_score_home, 0) as home_points,
        coalesce(with_previous.filled_score_away, 0)
        - coalesce(with_previous.prev_score_away, 0) as away_points,
        with_previous.prev_score_home,
        with_previous.prev_score_away,
        with_previous.team_id,
        with_previous.player_id,
        with_previous.action_type,
        with_previous.sub_type,
        with_previous.description
    from with_previous
    where
        with_previous.filled_score_home is not null
        and with_previous.filled_score_away is not null
        and (
            with_previous.filled_score_home is distinct from with_previous.prev_score_home
            or with_previous.filled_score_away is distinct from with_previous.prev_score_away
        )
)

select
    scoring.game_id,
    scoring.season,
    scoring.action_number,
    scoring.period,
    scoring.clock,
    scoring.clock_remaining_seconds,
    scoring.elapsed_seconds,
    scoring.score_home,
    scoring.score_away,
    scoring.score_differential,
    scoring.home_points,
    scoring.away_points,
    scoring.home_points + scoring.away_points as points_scored,
    case
        when scoring.home_points > scoring.away_points then 'home'
        when scoring.away_points > scoring.home_points then 'away'
        when scoring.home_points > 0 then 'home'
        when scoring.away_points > 0 then 'away'
    end as scoring_side,
    scoring.prev_score_home,
    scoring.prev_score_away,
    scoring.team_id,
    scoring.player_id,
    scoring.action_type,
    scoring.sub_type,
    scoring.description
from scoring
