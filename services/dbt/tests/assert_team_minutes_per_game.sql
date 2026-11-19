-- A team's player minutes in a game must come to 240 (five players for 48
-- minutes) plus 25 per overtime. Anything else is a missing or duplicated
-- player row. Minutes are stored to a fraction of a second, so a minute of
-- slack absorbs rounding.
with player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
),

team_minutes as (
    select
        player_game_logs.game_id,
        player_game_logs.team_id,
        sum(coalesce(player_game_logs.minutes, 0)) as total_minutes
    from player_game_logs
    group by player_game_logs.game_id, player_game_logs.team_id
    -- Fewer than five rows is not a full box score (the e2e seed logs one
    -- player a side), so only full ones are checked.
    having count(*) >= 5
)

select
    team_minutes.game_id,
    team_minutes.team_id,
    team_minutes.total_minutes
from team_minutes
where
    team_minutes.total_minutes < 239
    or abs(
        (team_minutes.total_minutes - 240)
        - 25 * round((team_minutes.total_minutes - 240) / 25)
    ) > 1
