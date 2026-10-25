with games as (
    select * from {{ ref('stg_games_schedule') }}
),

home_teams as (
    select * from {{ ref('stg_teams') }}
),

away_teams as (
    select * from {{ ref('stg_teams') }}
),

opponent_teams as (
    select * from {{ ref('stg_teams') }}
),

-- One listing per game: the newest scrape wins if two ESPN events ever match
-- the same game.
broadcasts as (
    select distinct on (game_id)
        game_id,
        national_tv
    from {{ ref('stg_game_broadcasts') }}
    where game_id is not null
    order by game_id asc, scraped_at desc
),

-- Each game twice, once from each team's side, so a team's previous game can
-- be found whether it was home or away.
team_sides as (
    select
        games.game_id,
        games.season,
        games.game_date,
        games.home_team_id as team_id,
        games.away_team_id as opponent_team_id,
        true as was_home,
        games.home_score as team_score,
        games.away_score as opponent_score
    from games

    union all

    select
        games.game_id,
        games.season,
        games.game_date,
        games.away_team_id as team_id,
        games.home_team_id as opponent_team_id,
        false as was_home,
        games.away_score as team_score,
        games.home_score as opponent_score
    from games
),

previous_games as (
    select
        team_sides.game_id,
        team_sides.team_id,
        team_sides.game_date,
        lag(team_sides.game_date) over team_season as previous_game_date,
        lag(team_sides.opponent_team_id) over team_season as previous_opponent_team_id,
        lag(team_sides.was_home) over team_season as previous_was_home,
        lag(team_sides.team_score) over team_season as previous_team_score,
        lag(team_sides.opponent_score) over team_season as previous_opponent_score
    from team_sides
    window team_season as (
        partition by team_sides.team_id, team_sides.season
        order by team_sides.game_date, team_sides.game_id
    )
),

-- The second night of a back-to-back: the team's previous game was the day
-- before, by Eastern game date. Scores stay null when that game is not Final
-- yet, which is exactly when BRef is late posting it.
-- TODO(postponements): a postponed game keeps its date and never goes Final,
-- so it reads as a game played last night here. Exclude it once we know how
-- BRef marks one; same TODO as services/scraper/src/queries/catch_up.py.
last_nights as (
    select
        previous_games.game_id,
        previous_games.team_id,
        opponent_teams.abbreviation as opponent_abbreviation,
        previous_games.previous_was_home as was_home,
        previous_games.previous_team_score as team_score,
        previous_games.previous_opponent_score as opponent_score
    from previous_games
    left join opponent_teams
        on previous_games.previous_opponent_team_id = opponent_teams.team_id
    where previous_games.game_date - previous_games.previous_game_date = 1
),

home_last_nights as (
    select * from last_nights
),

away_last_nights as (
    select * from last_nights
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
    games.away_score,
    broadcasts.national_tv,
    home_last_nights.game_id is not null as home_is_back_to_back,
    home_last_nights.opponent_abbreviation as home_last_night_opponent_abbreviation,
    home_last_nights.was_home as home_last_night_was_home,
    home_last_nights.team_score as home_last_night_score,
    home_last_nights.opponent_score as home_last_night_opponent_score,
    away_last_nights.game_id is not null as away_is_back_to_back,
    away_last_nights.opponent_abbreviation as away_last_night_opponent_abbreviation,
    away_last_nights.was_home as away_last_night_was_home,
    away_last_nights.team_score as away_last_night_score,
    away_last_nights.opponent_score as away_last_night_opponent_score
from games
left join home_teams
    on games.home_team_id = home_teams.team_id
left join away_teams
    on games.away_team_id = away_teams.team_id
left join broadcasts
    on games.game_id = broadcasts.game_id
left join home_last_nights
    on
        games.game_id = home_last_nights.game_id
        and games.home_team_id = home_last_nights.team_id
left join away_last_nights
    on
        games.game_id = away_last_nights.game_id
        and games.away_team_id = away_last_nights.team_id
