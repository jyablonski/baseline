-- A play-by-play row's team must be one of the game's two teams.
with play_by_play as (
    select * from {{ ref('fct_play_by_play') }}
    where team_id is not null
),

results as (
    select * from {{ ref('fct_team_game_results') }}
)

select
    play_by_play.game_id,
    play_by_play.action_number,
    play_by_play.team_id
from play_by_play
inner join results
    on play_by_play.game_id = results.game_id
where play_by_play.team_id not in (results.home_team_id, results.away_team_id)
