with player_game_logs as (
    select * from {{ ref('int_player_game_logs_enriched') }}
),

players as (
    select * from {{ ref('stg_players') }}
),

teams as (
    select * from {{ ref('stg_teams') }}
)

select
    player_game_logs.player_id,
    player_game_logs.game_id,
    player_game_logs.team_id,
    player_game_logs.game_date,
    player_game_logs.season,
    player_game_logs.season_type,
    player_game_logs.matchup,
    player_game_logs.location,
    player_game_logs.opponent_abbreviation,
    player_game_logs.result,
    player_game_logs.minutes,
    player_game_logs.points,
    player_game_logs.rebounds,
    player_game_logs.assists,
    player_game_logs.steals,
    player_game_logs.blocks,
    player_game_logs.turnovers,
    player_game_logs.field_goals_made,
    player_game_logs.field_goals_attempted,
    player_game_logs.field_goal_pct,
    player_game_logs.three_pointers_made,
    player_game_logs.three_pointers_attempted,
    player_game_logs.three_point_pct,
    player_game_logs.free_throws_made,
    player_game_logs.free_throws_attempted,
    player_game_logs.free_throw_pct,
    player_game_logs.plus_minus,
    round(player_game_logs.mvp_box_score, 1) as mvp_box_score,
    round(player_game_logs.mvp_game_score, 1) as mvp_game_score,
    player_game_logs.is_back_to_back,
    player_game_logs.season_game_number,
    player_game_logs.career_game_number,
    players.full_name as player_name,
    teams.abbreviation as team_abbreviation,
    teams.team_name
from player_game_logs
left join players
    on player_game_logs.player_id = players.player_id
left join teams
    on player_game_logs.team_id = teams.team_id
