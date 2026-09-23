"""SQL against gold pregame prediction marts."""

from __future__ import annotations

from sqlalchemy import text

LIST_PREDICTION_SCORECARD = text(
    """
    SELECT
        fct_prediction_scorecard.season,
        fct_prediction_scorecard.model_name,
        fct_prediction_scorecard.model_version,
        fct_prediction_scorecard.n,
        fct_prediction_scorecard.logloss,
        fct_prediction_scorecard.brier,
        fct_prediction_scorecard.accuracy,
        fct_prediction_scorecard.home_always_accuracy,
        fct_prediction_scorecard.calibration_error,
        fct_prediction_scorecard.market_n,
        fct_prediction_scorecard.market_logloss,
        fct_prediction_scorecard.market_brier
    FROM gold.fct_prediction_scorecard
    WHERE :season IS NULL OR fct_prediction_scorecard.season = :season
    ORDER BY
        fct_prediction_scorecard.season DESC,
        fct_prediction_scorecard.model_version ASC
    """
)

# fct_game_predictions only ever holds the champion's rows, so its most recent
# model_version names the champion and the API never leaves gold.
GET_CHAMPION_MODEL_VERSION = text(
    """
    SELECT fct_game_predictions.model_version
    FROM gold.fct_game_predictions
    ORDER BY fct_game_predictions.as_of DESC
    LIMIT 1
    """
)
