"""Small, deterministic regularized logistic model for ML v2.

The service intentionally does not depend on numpy or scikit-learn. The
feature set is small, so a standardized batch gradient fit is easy to audit
and keeps the scoring image lightweight.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, cast
from uuid import UUID

from elo import clip_probability, sigmoid

MODEL_NAME = "logit"
MODEL_VERSION = "logit-v1"
FEATURE_NAMES = (
    "point_diff_diff",
    "win_pct_diff",
    "last10_point_diff_diff",
    "rest_days_diff",
    "min_rest_days",
    "travel_miles_diff",
    "total_travel_miles",
    "timezone_crossings_diff",
    "total_timezone_crossings",
    "h2h_home_win_pct",
    "h2h_games_before",
)


@dataclass(frozen=True)
class FeatureRow:
    game_id: UUID
    game_date: date
    season: str
    home_team_id: UUID
    away_team_id: UUID
    home_won: bool | None
    home_games_before: int
    away_games_before: int
    values: dict[str, float | None]


def _get(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(key, default)
    if hasattr(row, "get"):
        return row.get(key, default)
    return getattr(row, key, default)


def _float_or_none(value: Any) -> float | None:
    return None if value is None else float(value)


def feature_row_from_mapping(row: Any) -> FeatureRow:
    home_won_raw = _get(row, "home_won")
    home_won = None if home_won_raw is None else bool(home_won_raw)
    return FeatureRow(
        game_id=UUID(str(_get(row, "game_id"))),
        game_date=_get(row, "game_date"),
        season=str(_get(row, "season")),
        home_team_id=UUID(str(_get(row, "home_team_id"))),
        away_team_id=UUID(str(_get(row, "away_team_id"))),
        home_won=home_won,
        home_games_before=int(_get(row, "home_games_before") or 0),
        away_games_before=int(_get(row, "away_games_before") or 0),
        values={name: _float_or_none(_get(row, name)) for name in FEATURE_NAMES},
    )


def rows_from_mappings(rows: Sequence[Any]) -> list[FeatureRow]:
    return [feature_row_from_mapping(row) for row in rows]


def _mean_scale(rows: Sequence[FeatureRow]) -> tuple[dict[str, float], dict[str, float]]:
    means: dict[str, float] = {}
    scales: dict[str, float] = {}
    for name in FEATURE_NAMES:
        observed = [cast(float, row.values[name]) for row in rows if row.values[name] is not None]
        mean = sum(observed) / len(observed) if observed else 0.0
        variance = (
            sum((value - mean) ** 2 for value in observed) / len(observed) if observed else 0.0
        )
        means[name] = mean
        scales[name] = math.sqrt(variance) or 1.0
    return means, scales


def _standardized_values(
    row: FeatureRow,
    means: Mapping[str, float],
    scales: Mapping[str, float],
) -> list[float]:
    return [
        ((means[name] if row.values[name] is None else cast(float, row.values[name])) - means[name])
        / scales[name]
        for name in FEATURE_NAMES
    ]


def _fit_binary_logit(
    values: Sequence[Sequence[float]],
    labels: Sequence[int],
    *,
    l2: float,
    learning_rate: float,
    iterations: int,
    initial_intercept: float = 0.0,
) -> tuple[float, list[float]]:
    if not labels:
        return initial_intercept, [0.0] * (len(values[0]) if values else 0)
    intercept = initial_intercept
    coefficients = [0.0] * len(values[0])
    denominator = float(len(labels))
    for _ in range(iterations):
        intercept_gradient = 0.0
        coefficient_gradients = [0.0] * len(coefficients)
        for row, label in zip(values, labels, strict=True):
            probability = sigmoid(
                intercept
                + sum(
                    coefficient * value
                    for coefficient, value in zip(coefficients, row, strict=True)
                )
            )
            error = probability - label
            intercept_gradient += error
            for index, value in enumerate(row):
                coefficient_gradients[index] += error * value
        intercept_step = learning_rate * intercept_gradient / denominator
        intercept -= intercept_step
        max_step = abs(intercept_step)
        for index, coefficient in enumerate(coefficients):
            gradient = coefficient_gradients[index] / denominator + l2 * coefficient / denominator
            step = learning_rate * gradient
            coefficients[index] -= step
            max_step = max(max_step, abs(step))
        if max_step < 1e-8:
            break
    return intercept, coefficients


def _initial_intercept(labels: Sequence[int]) -> float:
    positive_rate = min(1.0 - 1e-6, max(1e-6, sum(labels) / len(labels)))
    return math.log(positive_rate / (1.0 - positive_rate))


def _fit_base_model(
    rows: Sequence[FeatureRow],
    *,
    l2: float,
) -> tuple[dict[str, float], dict[str, float], float, list[float]]:
    means, scales = _mean_scale(rows)
    values = [_standardized_values(row, means, scales) for row in rows]
    labels = [1 if row.home_won else 0 for row in rows]
    intercept, coefficients = _fit_binary_logit(
        values,
        labels,
        l2=l2,
        learning_rate=0.15,
        iterations=4000,
        initial_intercept=_initial_intercept(labels),
    )
    return means, scales, intercept, coefficients


def _fit_calibration(raw_logits: Sequence[float], labels: Sequence[int]) -> tuple[float, float]:
    if len(set(labels)) < 2:
        return 1.0, 0.0
    mean = sum(raw_logits) / len(raw_logits)
    variance = sum((value - mean) ** 2 for value in raw_logits) / len(raw_logits)
    scale = math.sqrt(variance) or 1.0
    standardized = [[(value - mean) / scale] for value in raw_logits]
    intercept, coefficient = _fit_binary_logit(
        standardized,
        labels,
        l2=0.25,
        learning_rate=0.1,
        iterations=2000,
        initial_intercept=_initial_intercept(labels),
    )
    return coefficient[0] / scale, intercept - coefficient[0] * mean / scale


def fit_artifact(
    rows: Sequence[FeatureRow],
    *,
    model_version: str = MODEL_VERSION,
    l2: float = 1.0,
) -> dict[str, Any]:
    training_rows = [row for row in rows if row.home_won is not None]
    if not training_rows:
        raise ValueError("cannot train logit without completed games")
    calibration_start = max(1, int(len(training_rows) * 0.8))
    base_rows = training_rows[:calibration_start]
    calibration_rows = training_rows[calibration_start:]
    base_means, base_scales, base_intercept, base_coefficients = _fit_base_model(
        base_rows,
        l2=l2,
    )
    calibration_values = [
        _standardized_values(row, base_means, base_scales) for row in calibration_rows
    ]
    calibration_logits = [
        base_intercept
        + sum(
            coefficient * value
            for coefficient, value in zip(base_coefficients, row_values, strict=True)
        )
        for row_values in calibration_values
    ]
    calibration_labels = [1 if row.home_won else 0 for row in calibration_rows]
    calibration_slope, calibration_intercept = _fit_calibration(
        calibration_logits,
        calibration_labels,
    )
    return {
        "model_version": model_version,
        "feature_names": list(FEATURE_NAMES),
        "means": base_means,
        "scales": base_scales,
        "coefficients": base_coefficients,
        "intercept": base_intercept,
        "calibration": {
            "slope": calibration_slope,
            "intercept": calibration_intercept,
        },
        "training_rows": len(training_rows),
        "fit_rows": len(base_rows),
        "training_seasons": sorted({row.season for row in training_rows}),
        "calibration_rows": len(calibration_rows),
    }


def predict_artifact(artifact: Mapping[str, Any], row: FeatureRow) -> float:
    means = {name: float(value) for name, value in artifact["means"].items()}
    scales = {name: float(value) for name, value in artifact["scales"].items()}
    values = _standardized_values(row, means, scales)
    raw_logit = float(artifact["intercept"]) + sum(
        float(coefficient) * value
        for coefficient, value in zip(artifact["coefficients"], values, strict=True)
    )
    calibration = artifact.get("calibration", {})
    calibrated_logit = float(calibration.get("slope", 1.0)) * raw_logit + float(
        calibration.get("intercept", 0.0)
    )
    return clip_probability(sigmoid(calibrated_logit))


def cold_start(row: FeatureRow, threshold: int) -> bool:
    return min(row.home_games_before, row.away_games_before) < threshold


__all__ = [
    "FEATURE_NAMES",
    "MODEL_NAME",
    "MODEL_VERSION",
    "FeatureRow",
    "cold_start",
    "feature_row_from_mapping",
    "fit_artifact",
    "predict_artifact",
    "rows_from_mappings",
]
