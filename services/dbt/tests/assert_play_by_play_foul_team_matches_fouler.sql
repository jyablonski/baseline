-- A foul's team must be the fouler's team in that game's box score.
-- Basketball-Reference files personal, shooting, take, flagrant and
-- away-from-play fouls in the fouled team's column, and a parser that trusts
-- the column credits the foul (and once the fouler himself) to the opponent.
with play_by_play as (
    select * from {{ ref('fct_play_by_play') }}
    where
        event_type = 'foul'
        and player_id is not null
        and team_id is not null
),

player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
)

select
    play_by_play.game_id,
    play_by_play.action_number,
    play_by_play.player_id,
    play_by_play.foul_kind,
    play_by_play.team_id,
    player_game_logs.team_id as fouler_team_id
from play_by_play
inner join player_game_logs
    on
        play_by_play.game_id = player_game_logs.game_id
        and play_by_play.player_id = player_game_logs.player_id
where play_by_play.team_id <> player_game_logs.team_id
