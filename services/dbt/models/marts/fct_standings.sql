with standings as (
    select * from {{ ref('int_standings_records') }}
),

playoff_seeds as (
    select * from {{ ref('int_playoff_seeds') }}
)

select
    standings.team_id,
    standings.abbreviation,
    standings.team_name,
    standings.city,
    standings.nickname,
    standings.season,
    standings.season_type,
    standings.as_of_date,
    standings.conference,
    standings.division,
    standings.conference_rank,
    standings.division_rank,
    standings.wins,
    standings.losses,
    standings.win_pct,
    standings.games_back,
    standings.streak,
    standings.last_10,
    standings.record_source,
    playoff_seeds.playoff_seed
from standings
left join playoff_seeds
    on standings.team_id = playoff_seeds.team_id
    and standings.season = playoff_seeds.season
