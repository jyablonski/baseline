"""Why each Elo prediction came out the way it did, in points of spread.

Every Elo model is a sum on the log-odds scale: Elo v0 and v1 are the rating
gap plus the home edge, and Elo v2 / v3 put a linear layer on v1's log-odds.
So a prediction splits into parts exactly, with no approximation, and each part
converts to points by one constant. A part is positive when it favours the home
team, and the parts add up to the model's own line.

The stored JSON also carries the model's settings on that run (the home edge,
and the layer's weights), so the product can say what the live model weighs
today without re-running it.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from elo_v2 import FeatureFn, GameContext, Weights

from elo import HOME_ADVANTAGE, INITIAL_RATING, GameRow
from elo_v1 import EloV1State

# Points of spread per unit of log-odds, from the sportsbooks' own pairing of
# spread and de-vigged moneyline on 2026-11-10's slate (7.9-8.6 on the lopsided
# games, where the ratio is stable). It only turns log-odds into words: no
# probability depends on it, so it can be refined without touching a model.
POINTS_PER_LOGIT = 8.0
# Elo's expected score is 1 / (1 + 10 ** (-gap / 400)), so its log-odds are
# gap * ln(10) / 400.
LOGIT_PER_ELO = math.log(10.0) / 400.0

Part = tuple[str, float]


def _points(logit: float) -> float:
    return round(logit * POINTS_PER_LOGIT, 2)


def serialize(parts: Sequence[Part], settings: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "points_per_logit": POINTS_PER_LOGIT,
        "parts": [{"key": key, "points": _points(logit)} for key, logit in parts],
        "settings": dict(settings),
    }


def elo_parts(home_rating: float, away_rating: float, home_advantage: float) -> list[Part]:
    return [
        ("strength", (home_rating - away_rating) * LOGIT_PER_ELO),
        ("home_court", home_advantage * LOGIT_PER_ELO),
    ]


def elo_v0_breakdowns(games: Sequence[GameRow], ratings: Mapping[UUID, float]) -> list[dict]:
    settings = {"home_court_points": _points(HOME_ADVANTAGE * LOGIT_PER_ELO)}
    return [
        serialize(
            elo_parts(
                ratings.get(game.home_team_id, INITIAL_RATING),
                ratings.get(game.away_team_id, INITIAL_RATING),
                HOME_ADVANTAGE,
            ),
            settings,
        )
        for game in games
    ]


def elo_v1_settings(state: EloV1State) -> dict[str, Any]:
    """The learned home edge, and the raw tally it was learned from.

    The tally runs across every season the walk has seen (a snapshot carries
    it), so it is "games seen", not "this season".
    """
    return {
        "home_court_points": _points(state.home_advantage() * LOGIT_PER_ELO),
        "home_games": state.home_games,
        "home_win_rate": state.home_wins / state.home_games if state.home_games else None,
    }


def elo_v1_parts(games: Sequence[GameRow], state: EloV1State) -> list[list[Part]]:
    home_advantage = state.home_advantage()
    return [
        elo_parts(
            state.ratings.get(game.home_team_id, INITIAL_RATING),
            state.ratings.get(game.away_team_id, INITIAL_RATING),
            home_advantage,
        )
        for game in games
    ]


def layer_settings(
    base: Mapping[str, Any], weights: Weights, *, injury_unit: str
) -> dict[str, Any]:
    """Elo v1's settings plus the layer's weights, as words can use them.

    `confidence` is the weight on v1's log-odds: below 1 the layer pulls v1
    toward 50%. The other two are points per unit of input, home minus away:
    one back-to-back, and one `injury_unit` (a notable player for Elo v2, ten
    points of injury score for Elo v3).
    """
    confidence, back_to_back, injuries = weights
    return {
        **base,
        "confidence": round(confidence, 4),
        "back_to_back_points": _points(back_to_back),
        "injury_points": _points(injuries),
        "injury_unit": injury_unit,
    }


def layer_breakdowns(
    games: Sequence[GameRow],
    base_probs: Sequence[float],
    base_parts: Sequence[Sequence[Part]],
    contexts: Mapping[UUID, GameContext],
    weights: Weights,
    *,
    feature_fn: FeatureFn,
    settings: Mapping[str, Any],
) -> list[dict]:
    """Elo v1's parts, then what each of the layer's weights adds to them.

    `confidence` is (a - 1) * logit(v1), so the parts still sum to the layer's
    log-odds: a * logit(v1) + b * back_to_back_diff + c * injury_diff.
    """
    confidence, back_to_back, injuries = weights
    breakdowns: list[dict] = []
    for game, base_prob, parts in zip(games, base_probs, base_parts, strict=True):
        base_logit, back_to_back_diff, injury_diff = feature_fn(
            base_prob, contexts.get(game.game_id, GameContext())
        )
        breakdowns.append(
            serialize(
                [
                    *parts,
                    ("confidence", (confidence - 1.0) * base_logit),
                    ("back_to_back", back_to_back * back_to_back_diff),
                    ("injuries", injuries * injury_diff),
                ],
                settings,
            )
        )
    return breakdowns
