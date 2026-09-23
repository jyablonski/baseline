"""Walk-forward Elo for Regular Season pregame home win probability.

Ratings update only after a game is scored. Features for game g use games
with game_date < g.game_date. Same-game scores are never inputs.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any
from uuid import UUID

INITIAL_RATING = 1500.0
K_FACTOR = 20.0
HOME_ADVANTAGE = 100.0
SEASON_REGRESS = 0.25
MODEL_NAME = "elo"
MODEL_VERSION = "elo-v0"


@dataclass(frozen=True)
class GameRow:
    game_id: UUID
    game_date: date
    season: str
    home_team_id: UUID
    away_team_id: UUID
    home_won: bool | None = None
    # Home minus away points; only elo-v1 reads it (margin-of-victory updates).
    home_margin: int | None = None


def expected_home_win(home_rating: float, away_rating: float) -> float:
    exponent = (away_rating - (home_rating + HOME_ADVANTAGE)) / 400.0
    return 1.0 / (1.0 + 10.0**exponent)


def clip_probability(value: float) -> float:
    return min(1.0 - 1e-6, max(1e-6, value))


def regress_ratings(ratings: dict[UUID, float]) -> dict[UUID, float]:
    """Move each rating toward INITIAL_RATING at a season boundary."""
    return {
        team_id: rating * (1.0 - SEASON_REGRESS) + INITIAL_RATING * SEASON_REGRESS
        for team_id, rating in ratings.items()
    }


def update_ratings(
    ratings: dict[UUID, float],
    *,
    home_team_id: UUID,
    away_team_id: UUID,
    home_won: bool,
    expected: float,
) -> None:
    actual = 1.0 if home_won else 0.0
    ratings[home_team_id] = ratings[home_team_id] + K_FACTOR * (actual - expected)
    ratings[away_team_id] = ratings[away_team_id] + K_FACTOR * ((1.0 - actual) - (1.0 - expected))


def walk_forward(
    games: Sequence[GameRow],
    *,
    update: bool = True,
) -> tuple[list[float], dict[UUID, float]]:
    """Predict each game from ratings entering the night, then update.

    Games must already be sorted by (game_date, game_id). Season changes
    regress ratings toward the mean. Games with home_won is None are
    scored but do not update ratings.
    """
    ratings: dict[UUID, float] = {}
    preds: list[float] = []
    current_season: str | None = None
    for game in games:
        if current_season is None:
            current_season = game.season
        elif game.season != current_season:
            ratings = regress_ratings(ratings)
            current_season = game.season
        home = ratings.setdefault(game.home_team_id, INITIAL_RATING)
        away = ratings.setdefault(game.away_team_id, INITIAL_RATING)
        expected = clip_probability(expected_home_win(home, away))
        preds.append(expected)
        if update and game.home_won is not None:
            update_ratings(
                ratings,
                home_team_id=game.home_team_id,
                away_team_id=game.away_team_id,
                home_won=game.home_won,
                expected=expected,
            )
    return preds, ratings


def fit_ratings(games: Sequence[GameRow]) -> dict[UUID, float]:
    _preds, ratings = walk_forward(games, update=True)
    return ratings


def score_games(games: Sequence[GameRow], ratings: dict[UUID, float]) -> list[float]:
    preds: list[float] = []
    for game in games:
        home = ratings.get(game.home_team_id, INITIAL_RATING)
        away = ratings.get(game.away_team_id, INITIAL_RATING)
        preds.append(clip_probability(expected_home_win(home, away)))
    return preds


def _get(row: Any, key: str, default: Any = None) -> Any:
    if isinstance(row, dict):
        return row.get(key, default)
    if hasattr(row, "get"):
        return row.get(key, default)
    return getattr(row, key, default)


def game_row_from_mapping(row: Any) -> GameRow:
    home_won_raw = _get(row, "home_won")
    if home_won_raw is None:
        winner = _get(row, "winner_location")
        home_won = None if winner is None else str(winner) == "home"
    else:
        home_won = bool(home_won_raw)
    home_score = _get(row, "home_score")
    away_score = _get(row, "away_score")
    home_margin = (
        None if home_score is None or away_score is None else int(home_score) - int(away_score)
    )
    return GameRow(
        game_id=UUID(str(_get(row, "game_id"))),
        game_date=_get(row, "game_date"),
        season=str(_get(row, "season")),
        home_team_id=UUID(str(_get(row, "home_team_id"))),
        away_team_id=UUID(str(_get(row, "away_team_id"))),
        home_won=home_won,
        home_margin=home_margin,
    )


def rows_from_mappings(rows: Iterable[Any]) -> list[GameRow]:
    return [game_row_from_mapping(row) for row in rows]
