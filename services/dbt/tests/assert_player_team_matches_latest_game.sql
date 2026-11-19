-- An active player's team must be the team of his latest game, unless a
-- transaction since then moved him there. The roster page lists players by
-- dim_players.team_id, so a wrong team drops a player from his roster. Two
-- known causes: play-by-play once credited a fouler with the fouled team's
-- column (the player lands on his last opponent), and a player waived and
-- re-signed elsewhere can keep the team that waived him.
-- A trade or signing names the player and his new team, which exempts him
-- until his first game for them. A team on the sending side does not.
with players as (
    select * from {{ ref('dim_players') }}
    where is_active
),

player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
),

transaction_participants as (
    select * from {{ ref('fct_transaction_participants') }}
),

ranked_game_logs as (
    select
        player_game_logs.player_id,
        player_game_logs.game_id,
        player_game_logs.game_date,
        player_game_logs.team_id,
        player_game_logs.team_abbreviation,
        row_number() over (
            partition by player_game_logs.player_id
            order by player_game_logs.game_date desc, player_game_logs.game_id desc
        ) as recency_rank
    from player_game_logs
),

latest_game_logs as (
    select * from ranked_game_logs
    where recency_rank = 1
),

player_participants as (
    select * from transaction_participants
    where participant_type = 'player'
),

team_participants as (
    select * from transaction_participants
    where participant_type = 'team' and direction <> 'from'
),

player_team_moves as (
    select distinct
        player_participants.player_id,
        team_participants.team_id,
        player_participants.transaction_date
    from player_participants
    inner join team_participants
        on player_participants.transaction_key = team_participants.transaction_key
),

explained_moves as (
    select distinct
        latest_game_logs.player_id,
        player_team_moves.team_id
    from latest_game_logs
    inner join player_team_moves
        on
            latest_game_logs.player_id = player_team_moves.player_id
            and latest_game_logs.game_date <= player_team_moves.transaction_date
)

select
    players.player_id,
    players.full_name,
    players.team_id,
    latest_game_logs.team_id as latest_game_team_id,
    latest_game_logs.team_abbreviation as latest_game_team,
    latest_game_logs.game_id as latest_game_id,
    latest_game_logs.game_date as latest_game_date
from players
inner join latest_game_logs
    on players.player_id = latest_game_logs.player_id
left join explained_moves
    on
        players.player_id = explained_moves.player_id
        and players.team_id = explained_moves.team_id
where
    players.team_id is distinct from latest_game_logs.team_id
    and explained_moves.player_id is null
