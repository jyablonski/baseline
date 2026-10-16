"""SQL against gold team dims and game results."""

from __future__ import annotations

from sqlalchemy import text

from queries.records import (
    RECORD_LOSSES,
    RECORD_SOURCE,
    RECORD_WIN_PCT,
    RECORD_WINS,
    REGULAR_SEASON_RECORDS,
    RESOLVED_SEASON,
)

TEAM_GAME_FILTERS = """
    (fct_team_game_results.home_team_id = :team_id OR fct_team_game_results.away_team_id = :team_id)
    AND (:season IS NULL OR fct_team_game_results.season = :season)
    AND (:since_season IS NULL OR fct_team_game_results.season >= :since_season)
    AND (
        :opponent_team_id IS NULL
        OR (
            (fct_team_game_results.home_team_id = :team_id AND fct_team_game_results.away_team_id = :opponent_team_id)
            OR (fct_team_game_results.away_team_id = :team_id AND fct_team_game_results.home_team_id = :opponent_team_id)
        )
    )
    AND (
        :location IS NULL
        OR (:location = 'home' AND fct_team_game_results.home_team_id = :team_id)
        OR (:location = 'away' AND fct_team_game_results.away_team_id = :team_id)
    )
    AND (:arena_city IS NULL OR fct_team_game_results.arena_city ILIKE :arena_city)
    AND (:season_type IS NULL OR fct_team_game_results.season_type = :season_type)
"""

TEAM_BY_ID = text(
    """
    SELECT
        team_id, abbreviation, team_name, conference, division, city, nickname,
        arena_name, arena_latitude, arena_longitude,
        primary_color, alternate_color,
        current_season_payroll, current_remaining_guaranteed,
        current_contract_season,
        salary_cap, luxury_tax, first_apron, second_apron,
        over_luxury_tax, over_first_apron, over_second_apron
    FROM gold.dim_teams
    WHERE team_id = :team_id
    """
)

TEAM_BY_ABBREVIATION = text(
    """
    SELECT
        team_id, abbreviation, team_name, conference, division, city, nickname,
        arena_name, arena_latitude, arena_longitude,
        primary_color, alternate_color,
        current_season_payroll, current_remaining_guaranteed,
        current_contract_season,
        salary_cap, luxury_tax, first_apron, second_apron,
        over_luxury_tax, over_first_apron, over_second_apron
    FROM gold.dim_teams
    WHERE upper(abbreviation) = upper(:abbreviation)
    """
)

LIST_TEAMS_COUNT = text("SELECT count(*) FROM gold.dim_teams")

# Regular Season points scored/allowed per game. Gold has no possessions or
# offensive rebounds, so this is not possession-adjusted ORtg/DRtg.
REGULAR_SEASON_SCORING = f"""
    SELECT
        appearances.team_id,
        round(avg(appearances.pts_scored)::numeric, 1) AS pts_scored_avg,
        round(avg(appearances.pts_allowed)::numeric, 1) AS pts_allowed_avg
    FROM (
        SELECT
            fct_team_game_results.home_team_id AS team_id,
            fct_team_game_results.home_score AS pts_scored,
            fct_team_game_results.away_score AS pts_allowed
        FROM gold.fct_team_game_results
        WHERE
            fct_team_game_results.season_type = 'Regular Season'
            AND fct_team_game_results.season = ({RESOLVED_SEASON})
            AND fct_team_game_results.home_score IS NOT NULL
            AND fct_team_game_results.away_score IS NOT NULL
        UNION ALL
        SELECT
            fct_team_game_results.away_team_id AS team_id,
            fct_team_game_results.away_score AS pts_scored,
            fct_team_game_results.home_score AS pts_allowed
        FROM gold.fct_team_game_results
        WHERE
            fct_team_game_results.season_type = 'Regular Season'
            AND fct_team_game_results.season = ({RESOLVED_SEASON})
            AND fct_team_game_results.home_score IS NOT NULL
            AND fct_team_game_results.away_score IS NOT NULL
    ) AS appearances
    GROUP BY appearances.team_id
"""

LIST_TEAMS = text(
    f"""
    SELECT
        dim_teams.team_id,
        dim_teams.abbreviation,
        dim_teams.team_name,
        dim_teams.conference,
        dim_teams.division,
        dim_teams.city,
        dim_teams.nickname,
        {RECORD_WINS} AS wins,
        {RECORD_LOSSES} AS losses,
        {RECORD_WIN_PCT} AS win_pct,
        {RECORD_SOURCE} AS record_source,
        scoring.pts_scored_avg,
        scoring.pts_allowed_avg
    FROM gold.dim_teams
    LEFT JOIN gold.fct_standings
        ON fct_standings.team_id = dim_teams.team_id
        AND fct_standings.season = ({RESOLVED_SEASON})
        AND fct_standings.season_type = 'Regular Season'
    LEFT JOIN ({REGULAR_SEASON_RECORDS}) AS records
        ON records.team_id = dim_teams.team_id
    LEFT JOIN ({REGULAR_SEASON_SCORING}) AS scoring
        ON scoring.team_id = dim_teams.team_id
    ORDER BY
        dim_teams.conference,
        dim_teams.division,
        dim_teams.team_name
    LIMIT :limit OFFSET :offset
    """
)

LATEST_SEASON_FOR_TEAM = text(
    """
    SELECT max(season) AS season
    FROM gold.fct_team_game_results
    WHERE
        home_team_id = :team_id
        OR away_team_id = :team_id
    """
)

COMPUTE_RECORD = text(
    f"""
    SELECT
        count(*) AS games,
        count(*) FILTER (WHERE fct_team_game_results.winning_team_id = :team_id) AS wins
    FROM gold.fct_team_game_results
    WHERE
        {TEAM_GAME_FILTERS}
    """
)

COMPUTE_RECORDS_BY_SEASON_TYPE = text(
    """
    SELECT
        fct_team_game_results.season_type,
        count(*) AS games,
        count(*) FILTER (WHERE fct_team_game_results.winning_team_id = :team_id) AS wins
    FROM gold.fct_team_game_results
    WHERE
        (
            fct_team_game_results.home_team_id = :team_id
            OR fct_team_game_results.away_team_id = :team_id
        )
      AND fct_team_game_results.season = :season
    GROUP BY fct_team_game_results.season_type
    """
)

LIST_TEAM_GAMES_COUNT = text(
    f"""
    SELECT count(*) AS total
    FROM gold.fct_team_game_results
    WHERE
        {TEAM_GAME_FILTERS}
    """
)

LIST_TEAM_GAMES = text(
    f"""
    WITH home_teams AS (
        SELECT
            team_id,
            arena_name,
            city
        FROM gold.dim_teams
    )
    SELECT
        fct_team_game_results.game_id,
        fct_team_game_results.season,
        fct_team_game_results.season_type,
        fct_team_game_results.game_date,
        coalesce(nullif(btrim(fct_team_game_results.arena), ''), home_teams.arena_name) AS arena,
        coalesce(nullif(btrim(fct_team_game_results.arena_city), ''), home_teams.city) AS arena_city,
        fct_team_game_results.arena_state,
        fct_team_game_results.home_team_id,
        fct_team_game_results.home_team_abbreviation,
        fct_team_game_results.home_team_name,
        fct_team_game_results.home_score,
        fct_team_game_results.away_team_id,
        fct_team_game_results.away_team_abbreviation,
        fct_team_game_results.away_team_name,
        fct_team_game_results.away_score,
        fct_team_game_results.winning_team_id,
        fct_team_game_results.winner_location,
        CASE
            WHEN fct_team_game_results.home_score IS NULL OR fct_team_game_results.away_score IS NULL THEN NULL
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.home_score - fct_team_game_results.away_score
            ELSE fct_team_game_results.away_score - fct_team_game_results.home_score
        END AS score_margin,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN 'home'
            ELSE 'away'
        END AS location,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_id
            ELSE fct_team_game_results.home_team_id
        END AS opponent_team_id,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_abbreviation
            ELSE fct_team_game_results.home_team_abbreviation
        END AS opponent_abbreviation,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_team_name
            ELSE fct_team_game_results.home_team_name
        END AS opponent_name,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.home_score
            ELSE fct_team_game_results.away_score
        END AS team_score,
        CASE
            WHEN fct_team_game_results.home_team_id = :team_id THEN fct_team_game_results.away_score
            ELSE fct_team_game_results.home_score
        END AS opponent_score,
        (fct_team_game_results.winning_team_id = :team_id) AS is_win
    FROM gold.fct_team_game_results
    LEFT JOIN home_teams
        ON home_teams.team_id = fct_team_game_results.home_team_id
    WHERE
        {TEAM_GAME_FILTERS}
    ORDER BY
        fct_team_game_results.game_date DESC,
        fct_team_game_results.game_id DESC
    LIMIT :limit OFFSET :offset
    """
)

# Every game of one team's season in any state, for the team calendar. Without
# a season, the newest one the team has on the schedule. The back-to-back flag
# is computed over all the team's games before season_type narrows them, so a
# playoff opener the night after a play-in game still counts.
LIST_TEAM_SEASON_GAMES = text(
    """
    WITH target_seasons AS (
        SELECT
            coalesce(
                CAST(:season AS text),
                (
                    SELECT max(fct_games_schedule.season)
                    FROM gold.fct_games_schedule
                    WHERE
                        fct_games_schedule.home_team_id = :team_id
                        OR fct_games_schedule.away_team_id = :team_id
                )
            ) AS season
    ),

    team_games AS (
        SELECT
            fct_games_schedule.game_id,
            fct_games_schedule.season,
            fct_games_schedule.season_type,
            fct_games_schedule.game_date,
            fct_games_schedule.start_time_et,
            fct_games_schedule.status,
            fct_games_schedule.national_tv,
            fct_games_schedule.home_team_id = :team_id AS is_home,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_id
                ELSE fct_games_schedule.home_team_id
            END AS opponent_team_id,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_abbreviation
                ELSE fct_games_schedule.home_team_abbreviation
            END AS opponent_abbreviation,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_team_name
                ELSE fct_games_schedule.home_team_name
            END AS opponent_name,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.home_score
                ELSE fct_games_schedule.away_score
            END AS team_score,
            CASE
                WHEN fct_games_schedule.home_team_id = :team_id THEN fct_games_schedule.away_score
                ELSE fct_games_schedule.home_score
            END AS opponent_score,
            coalesce(
                fct_games_schedule.game_date
                - lag(fct_games_schedule.game_date) OVER (ORDER BY fct_games_schedule.game_date) = 1,
                FALSE
            ) AS is_back_to_back
        FROM gold.fct_games_schedule
        INNER JOIN target_seasons
            ON target_seasons.season = fct_games_schedule.season
        WHERE
            fct_games_schedule.home_team_id = :team_id
            OR fct_games_schedule.away_team_id = :team_id
    )

    SELECT
        team_games.game_id,
        team_games.season,
        team_games.season_type,
        team_games.game_date,
        team_games.start_time_et,
        team_games.status,
        team_games.national_tv,
        team_games.is_home,
        team_games.opponent_team_id,
        team_games.opponent_abbreviation,
        team_games.opponent_name,
        team_games.team_score,
        team_games.opponent_score,
        CASE
            WHEN
                team_games.status <> 'Final'
                OR team_games.team_score IS NULL
                OR team_games.opponent_score IS NULL
                THEN NULL
            WHEN team_games.team_score > team_games.opponent_score THEN 'W'
            ELSE 'L'
        END AS result,
        -- The champion's pregame estimate, from this team's side.
        CASE
            WHEN team_games.is_home THEN fct_game_predictions.model_wp
            ELSE fct_game_predictions.away_wp
        END AS win_probability,
        team_games.is_back_to_back
    FROM team_games
    LEFT JOIN gold.fct_game_predictions
        ON fct_game_predictions.game_id = team_games.game_id
    WHERE CAST(:season_type AS text) IS NULL OR team_games.season_type = :season_type
    ORDER BY
        team_games.game_date,
        team_games.start_time_et NULLS LAST,
        team_games.game_id
    """
)
