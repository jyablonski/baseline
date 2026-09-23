"""Fit pregame models on Regular Season data and persist predictions."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from datetime import datetime, time
from typing import Any
from uuid import UUID

from logit import (
    FEATURE_NAMES,
    FeatureRow,
    cold_start,
    fit_artifact,
    predict_artifact,
)
from logit import (
    MODEL_NAME as LOGIT_MODEL_NAME,
)
from logit import (
    MODEL_VERSION as DEFAULT_LOGIT_MODEL_VERSION,
)
from logit import (
    rows_from_mappings as feature_rows_from_mappings,
)
from sqlalchemy.orm import Session

from config import settings
from db import get_session, upsert_rows
from elo import (
    MODEL_NAME,
    MODEL_VERSION,
    GameRow,
    fit_ratings,
    game_row_from_mapping,
    score_games,
    walk_forward,
)
from elo_v1 import MODEL_NAME as ELO_V1_MODEL_NAME
from elo_v1 import MODEL_VERSION as ELO_V1_MODEL_VERSION
from elo_v1 import score_games as score_games_v1
from elo_v1 import walk_forward as walk_forward_v1
from metrics import summarize
from models import GamePrediction
from queries.artifacts import (
    REGISTER_MODEL,
    SELECT_MODEL_ARTIFACT,
    SET_MODEL_CHAMPION,
    UPDATE_MODEL_CHAMPION,
    UPSERT_MODEL_ARTIFACT,
)
from queries.evaluations import UPSERT_MODEL_EVALUATION
from queries.features import SELECT_GAME_FEATURES
from queries.games import SELECT_REGULAR_SEASON_FINALS, SELECT_UPCOMING_GAMES
from queries.odds import SELECT_MARKET_WP_BY_GAME
from queries.predictions import SELECT_LIVE_PREDICTED_GAMES


def load_regular_season_finals(session: Session) -> list[GameRow]:
    rows = session.execute(SELECT_REGULAR_SEASON_FINALS).mappings().all()
    return [game_row_from_mapping(row) for row in rows]


def load_upcoming_games(session: Session) -> list[GameRow]:
    rows = session.execute(SELECT_UPCOMING_GAMES).mappings().all()
    return [game_row_from_mapping(row) for row in rows]


def load_market_wp(session: Session) -> dict[UUID, float]:
    rows = session.execute(SELECT_MARKET_WP_BY_GAME).mappings().all()
    market: dict[UUID, float] = {}
    for row in rows:
        game_id = UUID(str(row["game_id"]))
        value = row["market_wp"]
        if value is None:
            continue
        market[game_id] = float(value)
    return market


def load_live_predicted_games(session: Session) -> set[tuple[UUID, str]]:
    rows = session.execute(SELECT_LIVE_PREDICTED_GAMES).mappings().all()
    return {(UUID(str(row["game_id"])), str(row["model_version"])) for row in rows}


def load_feature_rows(session: Session) -> list[FeatureRow]:
    rows = session.execute(SELECT_GAME_FEATURES).mappings().all()
    return feature_rows_from_mappings(rows)


def load_model_artifact(session: Session, model_version: str) -> dict[str, Any] | None:
    row = (
        session.execute(
            SELECT_MODEL_ARTIFACT,
            {"model_version": model_version},
        )
        .mappings()
        .first()
    )
    if not isinstance(row, Mapping):
        return None
    artifact = row.get("artifact")
    if not isinstance(artifact, Mapping) or not _is_valid_logit_artifact(artifact):
        return None
    return dict(artifact)


def _is_valid_logit_artifact(artifact: Mapping[str, Any]) -> bool:
    means = artifact.get("means")
    scales = artifact.get("scales")
    coefficients = artifact.get("coefficients")
    return (
        artifact.get("feature_names") == list(FEATURE_NAMES)
        and isinstance(means, Mapping)
        and isinstance(scales, Mapping)
        and all(name in means and name in scales for name in FEATURE_NAMES)
        and isinstance(coefficients, list)
        and len(coefficients) == len(FEATURE_NAMES)
        and "intercept" in artifact
    )


def register_elo_v1(session: Session) -> None:
    """Registry row so CHAMPION_MODEL_VERSION=elo-v1 can promote it. Elo has no artifact."""
    session.execute(
        REGISTER_MODEL,
        {
            "model_version": ELO_V1_MODEL_VERSION,
            "model_name": ELO_V1_MODEL_NAME,
            "artifact": "{}",
            "trained_at": datetime.now(),
        },
    )


def set_champion_model(session: Session, model_version: str) -> None:
    """Apply the configured champion, failing if its registry row is absent."""
    available = (
        session.execute(
            SELECT_MODEL_ARTIFACT,
            {"model_version": model_version},
        )
        .mappings()
        .first()
    )
    if not isinstance(available, Mapping):
        raise ValueError(f"configured champion model is not registered: {model_version}")
    model_name = available.get("model_name")
    if model_name == LOGIT_MODEL_NAME:
        artifact = available.get("artifact")
        if not isinstance(artifact, Mapping) or not _is_valid_logit_artifact(artifact):
            raise ValueError(f"configured champion model has an invalid artifact: {model_version}")
    if model_name not in {MODEL_NAME, LOGIT_MODEL_NAME}:
        raise ValueError(f"configured champion model has an unsupported name: {model_name}")
    session.execute(UPDATE_MODEL_CHAMPION)
    session.execute(SET_MODEL_CHAMPION, {"model_version": model_version})


def train_model(
    *,
    model_version: str | None = None,
    trained_at: datetime | None = None,
) -> dict[str, Any]:
    version = model_version or settings.logit_model_version or DEFAULT_LOGIT_MODEL_VERSION
    timestamp = trained_at or datetime.now()
    with get_session() as session:
        feature_rows = load_feature_rows(session)
        artifact = fit_artifact(feature_rows, model_version=version)
        session.execute(
            UPSERT_MODEL_ARTIFACT,
            {
                "model_version": version,
                "model_name": LOGIT_MODEL_NAME,
                "artifact": json.dumps(artifact, sort_keys=True),
                "trained_at": timestamp,
            },
        )
        session.commit()
    return {
        "model_name": LOGIT_MODEL_NAME,
        "model_version": version,
        "training_rows": artifact["training_rows"],
        "training_seasons": artifact["training_seasons"],
        "trained_at": timestamp.isoformat(),
    }


def holdout_season(games: list[GameRow]) -> str | None:
    seasons = sorted({game.season for game in games})
    if len(seasons) < 2:
        return None
    return seasons[-1]


def evaluate_holdout(games: list[GameRow]) -> dict[str, Any]:
    """Walk-forward Elo; report metrics on the latest Regular Season."""
    season = holdout_season(games)
    preds, _ratings = walk_forward(games, update=True)
    labels: list[int] = []
    holdout_preds: list[float] = []
    for game, pred in zip(games, preds, strict=True):
        if game.home_won is None:
            continue
        if season is not None and game.season != season:
            continue
        if season is None:
            labels.append(1 if game.home_won else 0)
            holdout_preds.append(pred)
            continue
        labels.append(1 if game.home_won else 0)
        holdout_preds.append(pred)
    metrics = summarize(labels, holdout_preds)
    return {
        "holdout_season": season or (games[-1].season if games else None),
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        **metrics,
    }


def build_prediction_rows(
    upcoming: list[GameRow],
    probs: list[float],
    market_wp: dict[UUID, float],
    *,
    as_of: datetime,
    model_name: str = MODEL_NAME,
    model_version: str = MODEL_VERSION,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for game, prob in zip(upcoming, probs, strict=True):
        rows.append(
            {
                "game_id": game.game_id,
                "as_of": as_of,
                "model_name": model_name,
                "model_version": model_version,
                "home_team_id": game.home_team_id,
                "away_team_id": game.away_team_id,
                "model_wp": float(prob),
                "market_wp": market_wp.get(game.game_id),
                "scraped_at": as_of,
            }
        )
    return rows


def score_and_persist(*, as_of: datetime | None = None) -> dict[str, Any]:
    scored_at = as_of or datetime.now()
    with get_session() as session:
        history = load_regular_season_finals(session)
        upcoming = load_upcoming_games(session)
        market = load_market_wp(session)
        feature_rows = load_feature_rows(session)
        ratings = fit_ratings(history)
        elo_probs = score_games(upcoming, ratings)
        rows = build_prediction_rows(upcoming, elo_probs, market, as_of=scored_at)
        _v1_preds, v1_state = walk_forward_v1(history)
        rows.extend(
            build_prediction_rows(
                upcoming,
                score_games_v1(upcoming, v1_state),
                market,
                as_of=scored_at,
                model_name=ELO_V1_MODEL_NAME,
                model_version=ELO_V1_MODEL_VERSION,
            )
        )
        logit_version = settings.logit_model_version or DEFAULT_LOGIT_MODEL_VERSION
        logit_artifact = load_model_artifact(session, logit_version)
        if logit_artifact is not None:
            features_by_game = {row.game_id: row for row in feature_rows}
            logit_probs: list[float] = []
            for game, elo_prob in zip(upcoming, elo_probs, strict=True):
                feature_row = features_by_game.get(game.game_id)
                if feature_row is None or cold_start(feature_row, settings.logit_cold_start_games):
                    logit_probs.append(elo_prob)
                else:
                    logit_probs.append(predict_artifact(logit_artifact, feature_row))
            rows.extend(
                build_prediction_rows(
                    upcoming,
                    logit_probs,
                    market,
                    as_of=scored_at,
                    model_name=LOGIT_MODEL_NAME,
                    model_version=logit_version,
                )
            )
        register_elo_v1(session)
        set_champion_model(session, settings.champion_model_version)
        written = upsert_rows(
            session,
            GamePrediction,
            rows,
            ["game_id", "as_of", "model_version"],
        )
    return {
        "history_games": len(history),
        "upcoming_games": len(upcoming),
        "written": written,
        "model_name": MODEL_NAME,
        "model_version": MODEL_VERSION,
        "model_versions": [MODEL_VERSION, ELO_V1_MODEL_VERSION]
        + ([logit_version] if logit_artifact is not None else []),
        "as_of": scored_at.isoformat(),
    }


BACKFILL_BATCH_SIZE = 1000


def build_graded_rows(
    scored: Sequence[tuple[GameRow | FeatureRow, float]],
    market_wp: dict[UUID, float],
    *,
    season: str | None,
    scraped_at: datetime,
    model_name: str,
    model_version: str,
) -> list[dict[str, Any]]:
    """Pregame predictions for Finals, for grading in the scorecard.

    Only `season` is emitted (all seasons when None). as_of is midnight of game
    day: after the previous night's results, before tip.
    """
    rows: list[dict[str, Any]] = []
    for game, prob in scored:
        if game.home_won is None or (season is not None and game.season != season):
            continue
        rows.append(
            {
                "game_id": game.game_id,
                "as_of": datetime.combine(game.game_date, time.min),
                "model_name": model_name,
                "model_version": model_version,
                "home_team_id": game.home_team_id,
                "away_team_id": game.away_team_id,
                "model_wp": float(prob),
                "market_wp": market_wp.get(game.game_id),
                "scraped_at": scraped_at,
            }
        )
    return rows


def build_backfill_rows(
    history: list[GameRow],
    feature_rows: list[FeatureRow],
    market_wp: dict[UUID, float],
    *,
    season: str | None,
    scraped_at: datetime,
    live: set[tuple[UUID, str]] | None = None,
    with_logit: bool = False,
) -> list[dict[str, Any]]:
    """Walk-forward predictions for past Finals, per model.

    Both Elos walk every loaded season so ratings carry over (regressed) into
    the target one. Logit is opt-in because it refits per 50-game block (the
    same blocks as `eval-logit`), which is by far the slow part; games in the
    first block have nothing to train on and get no logit row. Any (game,
    model_version) in `live` already has a real pregame prediction and is left
    alone, so the scorecard keeps grading what was actually published.
    """
    v0_probs, _ratings = walk_forward(history, update=True)
    v1_probs, _state = walk_forward_v1(history)
    rows = [
        *build_graded_rows(
            list(zip(history, v0_probs, strict=True)),
            market_wp,
            model_name=MODEL_NAME,
            model_version=MODEL_VERSION,
            season=season,
            scraped_at=scraped_at,
        ),
        *build_graded_rows(
            list(zip(history, v1_probs, strict=True)),
            market_wp,
            model_name=ELO_V1_MODEL_NAME,
            model_version=ELO_V1_MODEL_VERSION,
            season=season,
            scraped_at=scraped_at,
        ),
    ]
    if with_logit:
        rows.extend(
            build_graded_rows(
                _evaluate_logit_predictions(
                    feature_rows,
                    block_size=50,
                    cold_start_games=None,
                    season=season,
                ),
                market_wp,
                model_name=LOGIT_MODEL_NAME,
                model_version=settings.logit_model_version or DEFAULT_LOGIT_MODEL_VERSION,
                season=season,
                scraped_at=scraped_at,
            )
        )
    if not live:
        return rows
    return [row for row in rows if (row["game_id"], row["model_version"]) not in live]


def backfill_and_persist(
    *,
    season: str | None = None,
    with_logit: bool = False,
    scraped_at: datetime | None = None,
) -> dict[str, Any]:
    timestamp = scraped_at or datetime.now()
    with get_session() as session:
        history = load_regular_season_finals(session)
        feature_rows = load_feature_rows(session) if with_logit else []
        market = load_market_wp(session)
        rows = build_backfill_rows(
            history,
            feature_rows,
            market,
            season=season,
            scraped_at=timestamp,
            live=load_live_predicted_games(session),
            with_logit=with_logit,
        )
        register_elo_v1(session)
        written = 0
        # One multi-row INSERT per batch keeps each statement under Postgres's
        # 65,535 bind-parameter limit (9 columns per row).
        for start in range(0, len(rows), BACKFILL_BATCH_SIZE):
            written += upsert_rows(
                session,
                GamePrediction,
                rows[start : start + BACKFILL_BATCH_SIZE],
                ["game_id", "as_of", "model_version"],
            )
    return {
        "model_versions": sorted({row["model_version"] for row in rows}),
        "season": season or "all",
        "history_games": len(history),
        "written": written,
    }


def evaluate() -> dict[str, Any]:
    with get_session() as session:
        history = load_regular_season_finals(session)
    return evaluate_holdout(history)


def evaluate_logit_rows(
    rows: list[FeatureRow],
    *,
    block_size: int = 50,
    cold_start_games: int | None = None,
) -> dict[str, float]:
    """Evaluate logit in expanding date blocks without using future rows."""
    scored_rows = _evaluate_logit_predictions(
        rows,
        block_size=block_size,
        cold_start_games=cold_start_games,
    )
    return summarize(
        [1 if row.home_won else 0 for row, _probability in scored_rows],
        [probability for _row, probability in scored_rows],
    )


def _evaluate_logit_predictions(
    rows: list[FeatureRow],
    *,
    block_size: int,
    cold_start_games: int | None,
    season: str | None = None,
) -> list[tuple[FeatureRow, float]]:
    """Return expanding-window predictions paired with their game rows.

    With `season`, blocks holding none of its games are not refit at all: the
    refit is the expensive step, and those predictions would be discarded.
    """
    completed = [row for row in rows if row.home_won is not None]
    if not completed:
        return []
    game_rows = [
        GameRow(
            game_id=row.game_id,
            game_date=row.game_date,
            season=row.season,
            home_team_id=row.home_team_id,
            away_team_id=row.away_team_id,
            home_won=row.home_won,
        )
        for row in completed
    ]
    elo_probs, _ratings = walk_forward(game_rows)
    scored_rows: list[tuple[FeatureRow, float]] = []
    threshold = settings.logit_cold_start_games if cold_start_games is None else cold_start_games
    for block_start in range(0, len(completed), block_size):
        block_end = min(len(completed), block_start + block_size)
        training_rows = completed[:block_start]
        if not training_rows:
            continue
        if season is not None and all(
            row.season != season for row in completed[block_start:block_end]
        ):
            continue
        artifact = fit_artifact(training_rows)
        for index in range(block_start, block_end):
            row = completed[index]
            probability = (
                elo_probs[index] if cold_start(row, threshold) else predict_artifact(artifact, row)
            )
            scored_rows.append((row, probability))
    return scored_rows


def evaluate_logit_rows_by_season(
    rows: list[FeatureRow],
    *,
    block_size: int = 50,
    cold_start_games: int | None = None,
) -> dict[str, dict[str, float]]:
    """Return expanding-window metrics grouped by Regular Season."""
    scored_rows = _evaluate_logit_predictions(
        rows,
        block_size=block_size,
        cold_start_games=cold_start_games,
    )
    grouped: dict[str, tuple[list[int], list[float]]] = {}
    for row, probability in scored_rows:
        labels, predictions = grouped.setdefault(row.season, ([], []))
        labels.append(1 if row.home_won else 0)
        predictions.append(probability)
    return {
        season: summarize(labels, predictions) for season, (labels, predictions) in grouped.items()
    }


def evaluate_logit() -> dict[str, float]:
    with get_session() as session:
        feature_rows = load_feature_rows(session)
        scored_rows = _evaluate_logit_predictions(
            feature_rows,
            block_size=50,
            cold_start_games=settings.logit_cold_start_games,
        )
        metrics = summarize(
            [1 if row.home_won else 0 for row, _probability in scored_rows],
            [probability for _row, probability in scored_rows],
        )
        evaluated_at = datetime.now()
        grouped: dict[str, tuple[list[int], list[float]]] = {}
        for row, probability in scored_rows:
            labels, predictions = grouped.setdefault(row.season, ([], []))
            labels.append(1 if row.home_won else 0)
            predictions.append(probability)
        for season, (labels, predictions) in grouped.items():
            season_metrics = summarize(labels, predictions)
            session.execute(
                UPSERT_MODEL_EVALUATION,
                {
                    "model_name": LOGIT_MODEL_NAME,
                    "model_version": settings.logit_model_version or DEFAULT_LOGIT_MODEL_VERSION,
                    "evaluation_name": "expanding-window",
                    "season": season,
                    "evaluated_at": evaluated_at,
                    **{
                        key: int(value) if key == "n" else value
                        for key, value in season_metrics.items()
                    },
                },
            )
        session.commit()
    return metrics
