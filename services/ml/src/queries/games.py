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

# A game whose tip-off has passed is left alone: its stored row is the pregame
# prediction the scorecard grades, and an hourly catch-up rescoring during
# game time would overwrite it. :scored_at is naive UTC (the containers run
# without a TZ) and start_time_et is Eastern wall-clock, so convert before
# comparing. No published tip-off time falls back to the date window alone.
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
      AND game_date BETWEEN :from_date AND :through_date
      AND (
          start_time_et IS NULL
          OR game_date + start_time_et
              > (CAST(:scored_at AS timestamp) AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York'
      )
    ORDER BY game_date, game_id
    """
)
