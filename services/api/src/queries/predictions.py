"""SQL against gold pregame prediction marts and the model registry."""

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

# fct_game_predictions names the model the product is serving; both public reads
# below follow it to the newest season so they stay in step with the schedule.
_LIVE_RESULTS = """
    WITH live_model AS (
        SELECT fct_game_predictions.model_version
        FROM gold.fct_game_predictions
        ORDER BY fct_game_predictions.as_of DESC
        LIMIT 1
    ),
    latest_season AS (
        SELECT max(fct_prediction_results.season) AS season
        FROM gold.fct_prediction_results
    ),
    live_results AS (
        SELECT
            fct_prediction_results.game_id,
            fct_prediction_results.game_date,
            fct_prediction_results.home_team_abbreviation,
            fct_prediction_results.away_team_abbreviation,
            fct_prediction_results.model_wp,
            fct_prediction_results.home_won
        FROM gold.fct_prediction_results
        INNER JOIN live_model
            ON fct_prediction_results.model_version = live_model.model_version
        INNER JOIN latest_season
            ON fct_prediction_results.season = latest_season.season
    )
"""

# Buckets rather than a list of ranges so a lopsided game is never left out.
LIST_PREDICTION_CALIBRATION = text(
    _LIVE_RESULTS
    + """
    SELECT
        CASE
            WHEN live_results.model_wp < 0.4 THEN 'under 40%'
            WHEN live_results.model_wp < 0.5 THEN '40–50%'
            WHEN live_results.model_wp < 0.6 THEN '50–60%'
            WHEN live_results.model_wp < 0.7 THEN '60–70%'
            ELSE '70%+'
        END AS bucket,
        avg(live_results.model_wp) AS predicted,
        avg(CASE WHEN live_results.home_won THEN 1.0 ELSE 0.0 END) AS actual,
        count(*)::integer AS n
    FROM live_results
    GROUP BY 1
    ORDER BY predicted
    """
)

LIST_PREDICTION_GAMES = text(
    _LIVE_RESULTS
    + """
    SELECT
        live_results.game_id,
        live_results.game_date,
        live_results.home_team_abbreviation,
        live_results.away_team_abbreviation,
        live_results.model_wp,
        live_results.home_won
    FROM live_results
    ORDER BY
        live_results.game_date DESC,
        live_results.game_id ASC
    LIMIT :limit OFFSET :offset
    """
)

COUNT_PREDICTION_GAMES = text(
    _LIVE_RESULTS
    + """
    SELECT count(*)
    FROM live_results
    """
)

LIST_MODEL_REGISTRY = text(
    """
    SELECT
        model_artifacts.model_version,
        model_artifacts.model_name,
        model_artifacts.is_champion,
        model_artifacts.promoted_at,
        model_artifacts.promoted_by
    FROM source.model_artifacts
    ORDER BY model_artifacts.model_version
    """
)

# Every model's call on every graded game of the newest season. The admin page
# works out shared-game gaps, rolling log loss and calibration from these.
LIST_MODEL_RESULTS = text(
    """
    WITH latest_season AS (
        SELECT max(fct_prediction_results.season) AS season
        FROM gold.fct_prediction_results
    )
    SELECT
        fct_prediction_results.game_id,
        fct_prediction_results.game_date,
        fct_prediction_results.home_team_abbreviation,
        fct_prediction_results.away_team_abbreviation,
        fct_prediction_results.model_version,
        fct_prediction_results.model_wp,
        fct_prediction_results.market_wp,
        fct_prediction_results.home_won
    FROM gold.fct_prediction_results
    INNER JOIN latest_season
        ON fct_prediction_results.season = latest_season.season
    ORDER BY
        fct_prediction_results.game_date DESC,
        fct_prediction_results.game_id ASC
    """
)

GET_PROMOTION_CANDIDATE = text(
    """
    SELECT
        model_artifacts.model_version,
        model_artifacts.is_champion,
        model_artifacts.promoted_at,
        model_artifacts.promoted_by,
        EXISTS (
            SELECT 1
            FROM source.game_predictions
            WHERE game_predictions.model_version = model_artifacts.model_version
        ) AS has_predictions,
        EXISTS (
            SELECT 1
            FROM source.game_predictions
            INNER JOIN gold.fct_games_schedule
                ON game_predictions.game_id = fct_games_schedule.game_id
            WHERE
                game_predictions.model_version = model_artifacts.model_version
                AND fct_games_schedule.status <> 'Final'
        ) AS covers_upcoming,
        EXISTS (
            SELECT 1
            FROM source.game_predictions
            INNER JOIN gold.fct_games_schedule
                ON game_predictions.game_id = fct_games_schedule.game_id
            WHERE fct_games_schedule.status <> 'Final'
        ) AS any_upcoming
    FROM source.model_artifacts
    WHERE model_artifacts.model_version = :model_version
    """
)

# The partial unique index allows one champion, so clear before setting. Both
# run in one transaction: a reader never sees zero champions.
CLEAR_CHAMPION = text(
    """
    UPDATE source.model_artifacts
    SET is_champion = FALSE
    WHERE is_champion
    """
)

SET_CHAMPION = text(
    """
    UPDATE source.model_artifacts
    SET
        is_champion = TRUE,
        promoted_at = now(),
        promoted_by = :promoted_by
    WHERE model_artifacts.model_version = :model_version
    RETURNING
        model_artifacts.model_version,
        model_artifacts.promoted_at,
        model_artifacts.promoted_by
    """
)
