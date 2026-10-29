"""Elo v2: Elo v1's ratings plus a learned layer for calibration, rest and injuries.

Ratings are Elo v1's, untouched. On top of each v1 pregame probability sits a
three-weight logistic layer:

    P(home) = sigmoid(a * logit(v1) + b * back_to_back_diff + c * notable_out_diff)

- a < 1 pulls v1 toward 50% once its confident calls have been missing.
- back_to_back_diff is home minus away (1 when only the home team played last
  night), so b is expected to come out negative.
- notable_out_diff is home minus away notable players ruled out on the morning
  report (`fct_game_injuries`) who played within RECENT_ABSENCE_DAYS, so c is
  expected to come out negative too. Older absences are already in the rating.

The layer is refit before every game date on the earlier Finals only, so a
replayed prediction never saw its own result. A Gaussian prior anchors it
at (1, 0, 0), plain Elo v1, and the season's games pull it away from there:
in week one it is Elo v1, by midseason the data dominates. Nothing is tuned on
the games it is graded on, which keeps `make ml-backfill` an honest replay.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from elo import GameRow, clip_probability, sigmoid

MODEL_NAME = "elo"
MODEL_VERSION = "elo-v2"
PRIOR_WEIGHTS = (1.0, 0.0, 0.0)
# Ridge strength toward PRIOR_WEIGHTS. A game carries roughly 0.1 of Fisher
# information about a and 0.05 about b, so 20 is worth a couple of hundred
# games: the layer barely moves before December.
PRIOR_STRENGTH = 20.0
NEWTON_ITERATIONS = 25
# An absence counts only while the player logged minutes this recently.
RECENT_ABSENCE_DAYS = 14

Features = tuple[float, float, float]
Weights = tuple[float, float, float]


@dataclass(frozen=True)
class GameContext:
    home_back_to_back: bool = False
    away_back_to_back: bool = False
    home_notable_out: int = 0
    away_notable_out: int = 0


def features(base_prob: float, context: GameContext) -> Features:
    clipped = clip_probability(base_prob)
    return (
        math.log(clipped / (1.0 - clipped)),
        float(context.home_back_to_back) - float(context.away_back_to_back),
        float(context.home_notable_out - context.away_notable_out),
    )


def predict(weights: Weights, values: Features) -> float:
    return clip_probability(
        sigmoid(sum(weight * value for weight, value in zip(weights, values, strict=True)))
    )


def _solve(matrix: list[list[float]], vector: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting; the Hessian is positive definite."""
    size = len(vector)
    rows = [[*matrix[index], vector[index]] for index in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda index: abs(rows[index][column]))
        rows[column], rows[pivot] = rows[pivot], rows[column]
        for below in range(column + 1, size):
            factor = rows[below][column] / rows[column][column]
            for index in range(column, size + 1):
                rows[below][index] -= factor * rows[column][index]
    solution = [0.0] * size
    for row in reversed(range(size)):
        known = sum(rows[row][index] * solution[index] for index in range(row + 1, size))
        solution[row] = (rows[row][size] - known) / rows[row][row]
    return solution


def fit_weights(samples: Sequence[tuple[Features, int]], start: Weights = PRIOR_WEIGHTS) -> Weights:
    """MAP logistic fit (no intercept: v1's home edge is already in its logit)."""
    weights = list(start)
    size = len(weights)
    for _ in range(NEWTON_ITERATIONS):
        gradient = [PRIOR_STRENGTH * (weights[row] - PRIOR_WEIGHTS[row]) for row in range(size)]
        hessian = [
            [PRIOR_STRENGTH if row == column else 0.0 for column in range(size)]
            for row in range(size)
        ]
        for values, label in samples:
            probability = sigmoid(
                sum(weight * value for weight, value in zip(weights, values, strict=True))
            )
            error = probability - label
            curvature = probability * (1.0 - probability)
            for row in range(size):
                gradient[row] += error * values[row]
                for column in range(size):
                    hessian[row][column] += curvature * values[row] * values[column]
        step = _solve(hessian, gradient)
        weights = [weight - delta for weight, delta in zip(weights, step, strict=True)]
        if max(abs(delta) for delta in step) < 1e-9:
            break
    return (weights[0], weights[1], weights[2])


def walk_forward(
    games: Sequence[GameRow],
    base_probs: Sequence[float],
    contexts: Mapping[UUID, GameContext],
) -> tuple[list[float], Weights]:
    """Predict each game from a layer fit on earlier dates, then learn from it.

    `games` and `base_probs` are Elo v1's walk: sorted by (game_date, game_id),
    each probability made before that game's result. Games without a context
    (no schedule features, no injury report) count as rested and healthy.
    """
    preds: list[float] = []
    samples: list[tuple[Features, int]] = []
    weights = PRIOR_WEIGHTS
    fitted = 0
    index = 0
    while index < len(games):
        game_date = games[index].game_date
        if len(samples) != fitted:
            weights = fit_weights(samples, weights)
            fitted = len(samples)
        day_end = index
        while day_end < len(games) and games[day_end].game_date == game_date:
            day_end += 1
        for game, base_prob in zip(games[index:day_end], base_probs[index:day_end], strict=True):
            values = features(base_prob, contexts.get(game.game_id, GameContext()))
            preds.append(predict(weights, values))
            if game.home_won is not None:
                samples.append((values, 1 if game.home_won else 0))
        index = day_end
    if len(samples) != fitted:
        weights = fit_weights(samples, weights)
    return preds, weights


def score_games(
    games: Sequence[GameRow],
    base_probs: Sequence[float],
    contexts: Mapping[UUID, GameContext],
    weights: Weights,
) -> list[float]:
    return [
        predict(weights, features(base_prob, contexts.get(game.game_id, GameContext())))
        for game, base_prob in zip(games, base_probs, strict=True)
    ]
