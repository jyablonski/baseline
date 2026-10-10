with standings as (
    select * from {{ ref('stg_standings') }}
),

teams as (
    select * from {{ ref('stg_teams') }}
),

playoff_seeds as (
    select * from {{ ref('int_playoff_seeds') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
),

-- One row per team per finished Regular Season game, home and away alike.
appearances as (
    select
        results.home_team_id as team_id,
        results.season,
        results.game_date,
        results.game_id,
        results.winning_team_id = results.home_team_id as is_win
    from results
    where
        results.season_type = 'Regular Season'
        and results.winning_team_id is not null

    union all

    select
        results.away_team_id as team_id,
        results.season,
        results.game_date,
        results.game_id,
        results.winning_team_id = results.away_team_id as is_win
    from results
    where
        results.season_type = 'Regular Season'
        and results.winning_team_id is not null
),

-- game_number 1 is the team's most recent game of the season.
ordered as (
    select
        appearances.team_id,
        appearances.season,
        appearances.is_win,
        row_number() over (
            partition by appearances.team_id, appearances.season
            order by appearances.game_date desc, appearances.game_id desc
        ) as game_number
    from appearances
),

with_previous as (
    select
        ordered.team_id,
        ordered.season,
        ordered.is_win,
        ordered.game_number,
        lag(ordered.is_win) over (
            partition by ordered.team_id, ordered.season
            order by ordered.game_number
        ) as previous_is_win
    from ordered
),

-- streak_group 1 is the unbroken run of same results ending at the latest game.
marked as (
    select
        with_previous.team_id,
        with_previous.season,
        with_previous.is_win,
        with_previous.game_number,
        sum(
            case
                when
                    with_previous.game_number = 1
                    or with_previous.is_win is distinct from with_previous.previous_is_win
                    then 1
                else 0
            end
        ) over (
            partition by with_previous.team_id, with_previous.season
            order by with_previous.game_number
            rows between unbounded preceding and current row
        ) as streak_group
    from with_previous
),

form as (
    select
        marked.team_id,
        marked.season,
        concat(
            case when bool_or(marked.is_win) filter (where marked.streak_group = 1) then 'W' else 'L' end,
            count(*) filter (where marked.streak_group = 1)
        ) as streak,
        concat(
            count(*) filter (where marked.game_number <= 10 and marked.is_win),
            '-',
            count(*) filter (where marked.game_number <= 10 and not marked.is_win)
        ) as last_10
    from marked
    group by
        marked.team_id,
        marked.season
),

-- The source leaves games_back empty for a conference leader, so carry the
-- leader's record onto every row to derive it.
with_leader as (
    select
        standings.*,
        teams.abbreviation,
        teams.team_name,
        teams.city,
        teams.nickname,
        first_value(standings.wins) over conference_order as leader_wins,
        first_value(standings.losses) over conference_order as leader_losses
    from standings
    inner join teams
        on standings.team_id = teams.team_id
    window conference_order as (
        partition by standings.season, standings.season_type, standings.conference
        order by
            standings.win_pct desc nulls last,
            standings.wins desc nulls last,
            standings.losses asc nulls last,
            teams.team_name asc
    )
)

select
    with_leader.team_id,
    with_leader.abbreviation,
    with_leader.team_name,
    with_leader.city,
    with_leader.nickname,
    with_leader.season,
    with_leader.season_type,
    with_leader.as_of_date,
    with_leader.conference,
    with_leader.division,
    with_leader.conference_rank,
    with_leader.division_rank,
    with_leader.wins,
    with_leader.losses,
    with_leader.win_pct,
    coalesce(
        with_leader.games_back,
        ((with_leader.leader_wins - with_leader.wins) + (with_leader.losses - with_leader.leader_losses)) / 2.0
    ) as games_back,
    with_leader.conf_games_back,
    -- Basketball-Reference's standings page carries no form columns, so both
    -- come from our own Regular Season results when the source has none.
    -- A scraped streak may be spelled 'W 3'; the derived one is 'W3'.
    coalesce(nullif(nullif(replace(with_leader.streak, ' ', ''), ''), '—'), form.streak) as streak,
    coalesce(nullif(nullif(btrim(with_leader.last_10), ''), '—'), form.last_10) as last_10,
    playoff_seeds.playoff_seed
from with_leader
left join form
    on with_leader.team_id = form.team_id
    and with_leader.season = form.season
left join playoff_seeds
    on with_leader.team_id = playoff_seeds.team_id
    and with_leader.season = playoff_seeds.season
