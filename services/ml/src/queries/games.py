"""SQL against gold game facts / schedule."""

from __future__ import annotations

from sqlalchemy import text

SELECT_REGULAR_SEASON_FINALS = text(
    """
    SELECT
        game_id,
        game_date,
        season,
        home_team_id,
        away_team_id,
        home_score,
        away_score,
        winner_location
    FROM gold.fct_team_game_results
    WHERE season_type = 'Regular Season'
    ORDER BY game_date, game_id
    """
)

SELECT_UPCOMING_GAMES = text(
    """
    SELECT
        game_id,
        game_date,
        season,
        season_type,
        home_team_id,
        away_team_id,
        status
    FROM gold.fct_games_schedule
    WHERE season_type = 'Regular Season'
      AND lower(status) NOT IN ('final', '3')
    ORDER BY game_date, game_id
    """
)
