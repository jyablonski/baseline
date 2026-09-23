-- Minimal gold mart tables for API/MCP integration tests.
-- Mirrors dbt mart column shapes; seeded directly (dbt is covered by make test-dbt).

CREATE SCHEMA IF NOT EXISTS gold;

CREATE TABLE IF NOT EXISTS gold.dim_teams (
    team_id         UUID PRIMARY KEY,
    abbreviation    VARCHAR(5) NOT NULL,
    team_name       VARCHAR(100) NOT NULL,
    city            VARCHAR(50),
    nickname        VARCHAR(50),
    conference      VARCHAR(10) NOT NULL,
    division        VARCHAR(20) NOT NULL,
    arena_name                    VARCHAR(100),
    arena_latitude                DOUBLE PRECISION,
    arena_longitude               DOUBLE PRECISION,
    primary_color                 VARCHAR(7),
    alternate_color               VARCHAR(7),
    current_contract_season       VARCHAR(10),
    current_season_payroll        BIGINT,
    current_remaining_guaranteed  BIGINT,
    salary_cap                    BIGINT,
    luxury_tax                    BIGINT,
    first_apron                   BIGINT,
    second_apron                  BIGINT,
    over_luxury_tax               BOOLEAN,
    over_first_apron              BOOLEAN,
    over_second_apron             BOOLEAN
);

CREATE TABLE IF NOT EXISTS gold.dim_players (
    player_id               UUID PRIMARY KEY,
    first_name              VARCHAR(100) NOT NULL,
    last_name               VARCHAR(100) NOT NULL,
    full_name               VARCHAR(200) NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT FALSE,
    jersey_number           VARCHAR(10),
    position                VARCHAR(20),
    height                  VARCHAR(10),
    weight                  INTEGER,
    birth_date              DATE,
    team_id                 UUID REFERENCES gold.dim_teams(team_id),
    from_year               INTEGER,
    to_year                 INTEGER,
    career_games_played     INTEGER DEFAULT 0,
    first_game_date         DATE,
    last_game_date          DATE,
    first_season            VARCHAR(10),
    last_season             VARCHAR(10),
    seasons_played          INTEGER DEFAULT 0,
    career_ppg                    REAL,
    career_rpg                    REAL,
    career_apg                    REAL,
    current_contract_season       VARCHAR(10),
    current_contract_team_id      UUID,
    current_season_salary         BIGINT,
    current_remaining_guaranteed  BIGINT
);

CREATE TABLE IF NOT EXISTS gold.fct_team_game_results (
    game_id                 UUID PRIMARY KEY,
    season                  VARCHAR(10) NOT NULL,
    season_type             VARCHAR(20),
    game_date               DATE NOT NULL,
    arena                   VARCHAR(100),
    arena_city              VARCHAR(50),
    arena_state             VARCHAR(50),
    score_margin            INTEGER,
    home_team_id            UUID NOT NULL,
    home_team_abbreviation  VARCHAR(5),
    home_team_name          VARCHAR(100),
    home_score              INTEGER,
    away_team_id            UUID NOT NULL,
    away_team_abbreviation  VARCHAR(5),
    away_team_name          VARCHAR(100),
    away_score              INTEGER,
    winning_team_id         UUID,
    winner_location         VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS gold.fct_player_game_logs (
    player_id               UUID NOT NULL,
    game_id                 UUID NOT NULL,
    team_id                 UUID NOT NULL,
    game_date               DATE NOT NULL,
    season                  VARCHAR(10) NOT NULL,
    matchup                 VARCHAR(20),
    location                VARCHAR(10),
    opponent_abbreviation   VARCHAR(5),
    result                  CHAR(1),
    minutes                 REAL,
    points                  INTEGER,
    rebounds                INTEGER,
    assists                 INTEGER,
    steals                  INTEGER,
    blocks                  INTEGER,
    turnovers               INTEGER,
    field_goals_made        INTEGER,
    field_goals_attempted   INTEGER,
    field_goal_pct          REAL,
    three_pointers_made     INTEGER,
    three_pointers_attempted INTEGER,
    three_point_pct         REAL,
    free_throws_made        INTEGER,
    free_throws_attempted   INTEGER,
    free_throw_pct          REAL,
    plus_minus              INTEGER,
    season_type             VARCHAR(20),
    mvp_box_score           NUMERIC,
    mvp_game_score          NUMERIC,
    is_back_to_back         BOOLEAN DEFAULT FALSE,
    season_game_number      INTEGER,
    career_game_number      INTEGER,
    player_name             VARCHAR(200),
    team_abbreviation       VARCHAR(5),
    team_name               VARCHAR(100),
    PRIMARY KEY (player_id, game_id)
);

CREATE TABLE IF NOT EXISTS gold.fct_player_mvp_scores (
    player_id               UUID NOT NULL,
    season                  VARCHAR(10) NOT NULL,
    season_type             VARCHAR(20) NOT NULL,
    team_id                 UUID NOT NULL,
    games_played            INTEGER NOT NULL,
    team_games              INTEGER,
    wins                    INTEGER,
    losses                  INTEGER,
    win_pct                 NUMERIC,
    games_missed_pct        NUMERIC,
    avg_box_score           NUMERIC,
    avg_game_score          NUMERIC,
    availability_multiplier NUMERIC,
    mvp_score               NUMERIC,
    mvp_rank                INTEGER,
    PRIMARY KEY (player_id, season, season_type)
);

CREATE TABLE IF NOT EXISTS gold.fct_player_season_stats (
    player_id               UUID NOT NULL,
    season                  VARCHAR(10) NOT NULL,
    games_played            INTEGER NOT NULL,
    first_game_date         DATE,
    last_game_date          DATE,
    ppg                     REAL,
    rpg                     REAL,
    apg                     REAL,
    PRIMARY KEY (player_id, season)
);

CREATE TABLE IF NOT EXISTS gold.fct_standings (
    team_id             UUID NOT NULL REFERENCES gold.dim_teams(team_id),
    abbreviation        VARCHAR(5) NOT NULL,
    team_name           VARCHAR(100) NOT NULL,
    season              VARCHAR(10) NOT NULL,
    season_type         VARCHAR(20) NOT NULL,
    as_of_date          DATE NOT NULL,
    conference          VARCHAR(10) NOT NULL,
    division            VARCHAR(20) NOT NULL,
    conference_rank     INTEGER NOT NULL,
    division_rank       INTEGER NOT NULL,
    wins                INTEGER NOT NULL,
    losses              INTEGER NOT NULL,
    win_pct             REAL NOT NULL,
    games_back          REAL NOT NULL,
    conf_games_back     REAL NOT NULL,
    streak              VARCHAR(10),
    last_10             VARCHAR(10),
    playoff_seed        INTEGER,
    PRIMARY KEY (team_id, season, season_type)
);

CREATE TABLE IF NOT EXISTS gold.fct_games_schedule (
    game_id                 UUID PRIMARY KEY,
    season                  VARCHAR(10) NOT NULL,
    season_type             VARCHAR(20),
    game_date               DATE NOT NULL,
    status                  VARCHAR(20) NOT NULL,
    arena                   VARCHAR(100),
    arena_city              VARCHAR(50),
    arena_state             VARCHAR(50),
    home_team_id            UUID NOT NULL,
    home_team_abbreviation  VARCHAR(5),
    home_team_name          VARCHAR(100),
    home_score              INTEGER,
    away_team_id            UUID NOT NULL,
    away_team_abbreviation  VARCHAR(5),
    away_team_name          VARCHAR(100),
    away_score              INTEGER
);

CREATE TABLE IF NOT EXISTS gold.fct_game_predictions (
    game_id         UUID NOT NULL,
    as_of           TIMESTAMP NOT NULL,
    model_name      VARCHAR(50) NOT NULL,
    model_version   VARCHAR(50) NOT NULL,
    home_team_id    UUID NOT NULL,
    away_team_id    UUID NOT NULL,
    model_wp        DOUBLE PRECISION NOT NULL,
    away_wp         DOUBLE PRECISION NOT NULL,
    market_wp       DOUBLE PRECISION,
    game_date       DATE,
    season          VARCHAR(10),
    season_type     VARCHAR(20),
    game_status     VARCHAR(20),
    scraped_at      TIMESTAMP,
    PRIMARY KEY (game_id, model_version)
);

CREATE TABLE IF NOT EXISTS gold.fct_game_odds (
    odds_event_id   VARCHAR(64) NOT NULL,
    commence_time   TIMESTAMP,
    home_team_name  VARCHAR(100),
    away_team_name  VARCHAR(100),
    game_id         UUID,
    bookmaker       VARCHAR(64) NOT NULL,
    market          VARCHAR(16) NOT NULL,
    home_price      INTEGER,
    away_price      INTEGER,
    home_implied_wp DOUBLE PRECISION,
    away_implied_wp DOUBLE PRECISION,
    home_market_wp  DOUBLE PRECISION,
    away_market_wp  DOUBLE PRECISION,
    spread_home     DOUBLE PRECISION,
    scraped_at      TIMESTAMP,
    PRIMARY KEY (odds_event_id, bookmaker, market)
);

CREATE TABLE IF NOT EXISTS gold.fct_prediction_scorecard (
    season                  VARCHAR(10) NOT NULL,
    model_name              VARCHAR(50) NOT NULL,
    model_version           VARCHAR(50) NOT NULL,
    n                       INTEGER NOT NULL,
    logloss                 DOUBLE PRECISION,
    brier                   DOUBLE PRECISION,
    accuracy                DOUBLE PRECISION,
    home_always_accuracy    DOUBLE PRECISION,
    calibration_error       DOUBLE PRECISION,
    market_n                INTEGER,
    market_logloss          DOUBLE PRECISION,
    market_brier            DOUBLE PRECISION,
    PRIMARY KEY (season, model_version)
);
