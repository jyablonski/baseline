with games as (
    select * from {{ ref('stg_games_schedule') }}
),

home_teams as (
    select * from {{ ref('stg_teams') }}
),

away_teams as (
    select * from {{ ref('stg_teams') }}
)

select
    games.game_id,
    games.season,
    games.season_type,
    games.game_date,
    games.start_time_et,
    games.status,
    games.arena,
    games.arena_city,
    games.arena_state,
    games.home_team_id,
    home_teams.abbreviation as home_team_abbreviation,
    home_teams.team_name as home_team_name,
    games.home_score,
    games.away_team_id,
    away_teams.abbreviation as away_team_abbreviation,
    away_teams.team_name as away_team_name,
    games.away_score
from games
left join home_teams
    on games.home_team_id = home_teams.team_id
left join away_teams
    on games.away_team_id = away_teams.team_id
