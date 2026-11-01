from datetime import date, timedelta
from uuid import UUID

import pytest
from elo_v2 import PRIOR_WEIGHTS, GameContext
from elo_v2 import features as v2_features
from elo_v2 import walk_forward as v2_walk_forward
from elo_v3 import features, score_games, walk_forward

from elo import GameRow

HOME = UUID("00000000-0000-4000-8000-000000000201")
AWAY = UUID("00000000-0000-4000-8000-000000000202")


def _game(index: int, home_won: bool | None) -> GameRow:
    return GameRow(
        game_id=UUID(int=index + 1),
        game_date=date(2026, 11, 1) + timedelta(days=index),
        season="2026-27",
        home_team_id=HOME,
        away_team_id=AWAY,
        home_won=home_won,
    )


@pytest.mark.unit
def test_features_read_the_injury_score_not_the_notable_count() -> None:
    context = GameContext(home_back_to_back=True, home_notable_out=3, injury_score_diff=25.0)
    assert features(0.5, context) == pytest.approx((0.0, 1.0, 2.5))
    assert v2_features(0.5, context) == pytest.approx((0.0, 1.0, 3.0))


@pytest.mark.unit
def test_walk_forward_learns_that_a_depleted_home_team_loses() -> None:
    # Coin-flip base rate: every game the depleted side is the one that loses.
    games = [_game(index, index % 2 == 0) for index in range(200)]
    contexts = {
        game.game_id: GameContext(injury_score_diff=-20.0 if game.home_won else 20.0)
        for game in games
    }
    preds, weights = walk_forward(games, [0.5] * len(games), contexts)
    assert weights[2] < -0.5
    assert preds[0] == pytest.approx(0.5)
    assert preds[-2] > 0.6
    assert preds[-1] < 0.4


@pytest.mark.unit
def test_matches_elo_v2_when_nobody_is_missing() -> None:
    games = [_game(index, index % 3 == 0) for index in range(30)]
    contexts = {
        game.game_id: GameContext(home_back_to_back=index % 4 == 0)
        for index, game in enumerate(games)
    }
    v3_preds, _ = walk_forward(games, [0.55] * len(games), contexts)
    v2_preds, _ = v2_walk_forward(games, [0.55] * len(games), contexts)
    assert v3_preds == pytest.approx(v2_preds)


@pytest.mark.unit
def test_score_games_applies_the_layer_to_upcoming_games() -> None:
    game = _game(0, None)
    weights = (PRIOR_WEIGHTS[0], 0.0, -0.2)
    contexts = {game.game_id: GameContext(injury_score_diff=30.0)}
    assert score_games([game], [0.5], contexts, weights)[0] < 0.4
    assert score_games([game], [0.5], {}, weights)[0] == pytest.approx(0.5)
