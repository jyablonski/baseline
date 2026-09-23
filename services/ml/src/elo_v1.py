"""Elo v1: elo-v0 plus margin of victory, a learned home edge, and a faster start.

Same walk-forward discipline as elo-v0 (a game's prediction uses only earlier
results). Three changes, each measured on 2025-26 with settings fixed on
Oct-Jan and graded on Feb-Apr:

- Margin of victory scales K (FiveThirtyEight's multiplier), damped when the
  favourite wins so blowouts by good teams don't inflate ratings.
- Home advantage is the league home win rate so far, not a fixed +100 points.
  +100 implies ~64% for equal teams; 2025-26 home teams won ~55%.
- K doubles until both teams have played 20 games in the season, so ratings
  catch up quickly from a cold (or regressed) start.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from uuid import UUID

from elo import INITIAL_RATING, GameRow, clip_probability, regress_ratings

MODEL_NAME = "elo"
MODEL_VERSION = "elo-v1"
K_FACTOR = 20.0
EARLY_K_FACTOR = 40.0
EARLY_GAMES = 20
# Beta prior on the home win rate: 60 pseudo-games at 55%, so opening night
# isn't driven by a handful of results.
HOME_PRIOR_RATE = 0.55
HOME_PRIOR_GAMES = 60.0


@dataclass
class EloV1State:
    ratings: dict[UUID, float] = field(default_factory=dict)
    # Games played this season; resets at each season boundary.
    season_games: dict[UUID, int] = field(default_factory=dict)
    home_wins: float = 0.0
    home_games: int = 0

    def home_advantage(self) -> float:
        """League home win rate so far, as Elo points."""
        rate = (self.home_wins + HOME_PRIOR_RATE * HOME_PRIOR_GAMES) / (
            self.home_games + HOME_PRIOR_GAMES
        )
        return 400.0 * math.log10(rate / (1.0 - rate))


def expected_home_win(home_rating: float, away_rating: float, home_advantage: float) -> float:
    exponent = (away_rating - (home_rating + home_advantage)) / 400.0
    return 1.0 / (1.0 + 10.0**exponent)


def mov_multiplier(home_margin: int | None, winner_elo_edge: float) -> float:
    if home_margin is None:
        return 1.0
    return ((abs(home_margin) + 3.0) ** 0.8) / (7.5 + 0.006 * winner_elo_edge)


def _predict(state: EloV1State, game: GameRow) -> float:
    home = state.ratings.get(game.home_team_id, INITIAL_RATING)
    away = state.ratings.get(game.away_team_id, INITIAL_RATING)
    return clip_probability(expected_home_win(home, away, state.home_advantage()))


def _update(state: EloV1State, game: GameRow, expected: float) -> None:
    home_won = bool(game.home_won)
    home = state.ratings.setdefault(game.home_team_id, INITIAL_RATING)
    away = state.ratings.setdefault(game.away_team_id, INITIAL_RATING)
    home_edge = home + state.home_advantage() - away
    k = K_FACTOR
    if (
        min(
            state.season_games.get(game.home_team_id, 0),
            state.season_games.get(game.away_team_id, 0),
        )
        < EARLY_GAMES
    ):
        k = EARLY_K_FACTOR
    k *= mov_multiplier(game.home_margin, home_edge if home_won else -home_edge)
    delta = k * ((1.0 if home_won else 0.0) - expected)
    state.ratings[game.home_team_id] = home + delta
    state.ratings[game.away_team_id] = away - delta
    for team_id in (game.home_team_id, game.away_team_id):
        state.season_games[team_id] = state.season_games.get(team_id, 0) + 1
    state.home_games += 1
    state.home_wins += 1.0 if home_won else 0.0


def walk_forward(games: Sequence[GameRow]) -> tuple[list[float], EloV1State]:
    """Predict each game from the state entering it, then update on its result.

    Games must be sorted by (game_date, game_id). Games with home_won None are
    scored but change nothing.
    """
    state = EloV1State()
    preds: list[float] = []
    current_season: str | None = None
    for game in games:
        if current_season is not None and game.season != current_season:
            state.ratings = regress_ratings(state.ratings)
            state.season_games = {}
        current_season = game.season
        expected = _predict(state, game)
        preds.append(expected)
        if game.home_won is not None:
            _update(state, game, expected)
    return preds, state


def score_games(games: Sequence[GameRow], state: EloV1State) -> list[float]:
    return [_predict(state, game) for game in games]
