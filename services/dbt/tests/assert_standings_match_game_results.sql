-- Official standings must agree with the record counted from Final Regular
-- Season games. Basketball-Reference's standings can trail the box scores by
-- one game (a team that played last night), so a difference of one win or one
-- loss passes; more means games are missing or mis-scored.
with standings as (
    select * from {{ ref('fct_standings') }}
    where record_source = 'official'
),

results as (
    select * from {{ ref('fct_team_game_results') }}
    where
        season_type = 'Regular Season'
        and winning_team_id is not null
),

appearances as (
    select
        results.home_team_id as team_id,
        results.season,
        results.winning_team_id = results.home_team_id as is_win
    from results
    union all
    select
        results.away_team_id as team_id,
        results.season,
        results.winning_team_id = results.away_team_id as is_win
    from results
),

counted_records as (
    select
        appearances.team_id,
        appearances.season,
        count(*) filter (where appearances.is_win) as wins,
        count(*) filter (where not appearances.is_win) as losses
    from appearances
    group by appearances.team_id, appearances.season
)

select
    standings.team_id,
    standings.abbreviation,
    standings.season,
    standings.wins as official_wins,
    standings.losses as official_losses,
    coalesce(counted_records.wins, 0) as counted_wins,
    coalesce(counted_records.losses, 0) as counted_losses
from standings
left join counted_records
    on
        standings.team_id = counted_records.team_id
        and standings.season = counted_records.season
where
    abs(standings.wins - coalesce(counted_records.wins, 0)) > 1
    or abs(standings.losses - coalesce(counted_records.losses, 0)) > 1
