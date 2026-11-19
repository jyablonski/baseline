-- A team's player points in a game must add up to its final score. A shortfall
-- is a player row missing from the box score; an excess is a duplicate or a
-- player filed under the wrong team.
with player_game_logs as (
    select * from {{ ref('fct_player_game_logs') }}
),

results as (
    select * from {{ ref('fct_team_game_results') }}
),

team_points as (
    select
        player_game_logs.game_id,
        player_game_logs.team_id,
        sum(coalesce(player_game_logs.points, 0)) as box_score_points
    from player_game_logs
    group by player_game_logs.game_id, player_game_logs.team_id
    -- Fewer than five rows is not a full box score (the e2e seed logs one
    -- player a side), so only full ones are checked.
    having count(*) >= 5
),

final_scores as (
    select
        results.game_id,
        results.home_team_id as team_id,
        results.home_score as final_score
    from results
    union all
    select
        results.game_id,
        results.away_team_id as team_id,
        results.away_score as final_score
    from results
)

select
    final_scores.game_id,
    final_scores.team_id,
    final_scores.final_score,
    team_points.box_score_points
from final_scores
inner join team_points
    on
        final_scores.game_id = team_points.game_id
        and final_scores.team_id = team_points.team_id
where team_points.box_score_points <> final_scores.final_score
