with standings as (
    select * from {{ source('source', 'standings') }}
)

select
    standings.team_id,
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
    standings.last_10
from standings
where standings.season_type = 'Regular Season'
