"""SQL against source.game_predictions (written by the ML job)."""

from __future__ import annotations

from sqlalchemy import text

INSERT_GAME_PREDICTION = text(
    """
    INSERT INTO source.game_predictions (
        game_id,
        as_of,
        model_name,
        model_version,
        home_team_id,
        away_team_id,
        model_wp,
        market_wp,
        scraped_at
    )
    VALUES (
        :game_id,
        :as_of,
        :model_name,
        :model_version,
        :home_team_id,
        :away_team_id,
        :model_wp,
        :market_wp,
        :scraped_at
    )
    ON CONFLICT (game_id, as_of, model_version) DO UPDATE SET
        model_name = EXCLUDED.model_name,
        home_team_id = EXCLUDED.home_team_id,
        away_team_id = EXCLUDED.away_team_id,
        model_wp = EXCLUDED.model_wp,
        market_wp = EXCLUDED.market_wp,
        scraped_at = EXCLUDED.scraped_at
    """
)

# Predictions the daily `score` run made before tip: the graded live record,
# which `backfill` must not shadow. Backfill rows sit at exactly midnight of
# game day, and anything stamped after game day is never graded, so neither
# counts.
SELECT_LIVE_PREDICTED_GAMES = text(
    """
    SELECT DISTINCT
        game_predictions.game_id,
        game_predictions.model_version
    FROM source.game_predictions
    INNER JOIN source.games
        ON game_predictions.game_id = games.game_id
    WHERE
        game_predictions.as_of::date <= games.game_date
        AND game_predictions.as_of <> games.game_date::timestamp
    """
)
