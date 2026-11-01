"""Elo v3: Elo v2's layer, with the injury score in place of the notable count.

    P(home) = sigmoid(a * logit(v1) + b * back_to_back_diff + c * injury_score_diff / 10)

Elo v2 counts a star and a rotation player the same and ignores everyone else.
`gold.fct_game_injury_scores` sums the production of every recently active
player on the morning report, weighted by status, so c prices lost production
instead of lost bodies. It is home minus away, so c is expected to come out
negative. Ratings, walk-forward fitting and the prior are all Elo v2's, so the
two differ only in that one input and any gap between them is down to it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from uuid import UUID

from elo_v2 import Features, GameContext, Weights
from elo_v2 import score_games as score_games_v2
from elo_v2 import walk_forward as walk_forward_v2

from elo import GameRow, clip_probability

MODEL_NAME = "elo"
MODEL_VERSION = "elo-v3"
# Puts a typical score gap near 1, the size of the layer's other inputs. The
# prior's strength is per unit of input, so this sets how fast c can move.
INJURY_SCORE_SCALE = 10.0


def features(base_prob: float, context: GameContext) -> Features:
    clipped = clip_probability(base_prob)
    return (
        math.log(clipped / (1.0 - clipped)),
        float(context.home_back_to_back) - float(context.away_back_to_back),
        context.injury_score_diff / INJURY_SCORE_SCALE,
    )


def walk_forward(
    games: Sequence[GameRow],
    base_probs: Sequence[float],
    contexts: Mapping[UUID, GameContext],
) -> tuple[list[float], Weights]:
    return walk_forward_v2(games, base_probs, contexts, feature_fn=features)


def score_games(
    games: Sequence[GameRow],
    base_probs: Sequence[float],
    contexts: Mapping[UUID, GameContext],
    weights: Weights,
) -> list[float]:
    return score_games_v2(games, base_probs, contexts, weights, feature_fn=features)
