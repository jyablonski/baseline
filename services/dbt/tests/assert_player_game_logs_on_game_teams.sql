-- A box-score row must belong to one of the game's two teams, and its opponent
-- must be the other one.
with player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
)

select
    player_game_logs.player_id,
    player_game_logs.game_id,
    player_game_logs.team_abbreviation,
    player_game_logs.opponent_abbreviation,
    results.home_team_abbreviation,
    results.away_team_abbreviation
from player_game_logs
inner join results
    on player_game_logs.game_id = results.game_id
where
    not (
        player_game_logs.team_id = results.home_team_id
        and player_game_logs.opponent_abbreviation = results.away_team_abbreviation
    )
    and not (
        player_game_logs.team_id = results.away_team_id
        and player_game_logs.opponent_abbreviation = results.home_team_abbreviation
    )
