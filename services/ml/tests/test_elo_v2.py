from dataclasses import replace
from datetime import date, timedelta
from uuid import UUID

import pytest
from elo_v2 import (
    PRIOR_WEIGHTS,
    GameContext,
    features,
    fit_weights,
    predict,
    score_games,
    walk_forward,
)

from elo import GameRow

HOME = UUID(int=1)
AWAY = UUID(int=2)


def _game(index: int, home_won: bool | None) -> GameRow:
    return GameRow(
        game_id=UUID(int=100 + index),
        game_date=date(2026, 10, 20) + timedelta(days=index),
        season="2026-27",
        home_team_id=HOME,
        away_team_id=AWAY,
        home_won=home_won,
    )


@pytest.mark.unit
def test_features_are_home_minus_away() -> None:
    context = GameContext(home_back_to_back=True, home_notable_out=1, away_notable_out=3)
    elo_logit, back_to_back, notable_out = features(0.5, context)
    assert elo_logit == pytest.approx(0.0)
    assert back_to_back == 1.0
    assert notable_out == -2.0


@pytest.mark.unit
def test_prior_layer_is_elo_v1() -> None:
    assert fit_weights([]) == PRIOR_WEIGHTS
    assert predict(PRIOR_WEIGHTS, features(0.7, GameContext(home_back_to_back=True))) == (
        pytest.approx(0.7)
    )


@pytest.mark.unit
def test_layer_learns_overconfidence_and_back_to_backs() -> None:
    # Elo v1 says 80% every night but home teams win half the time, and lose
    # every game they play on a back-to-back.
    games = [_game(index, index % 4 in (0, 1)) for index in range(400)]
    contexts = {
        game.game_id: GameContext(home_back_to_back=index % 4 == 2)
        for index, game in enumerate(games)
    }
    preds, weights = walk_forward(games, [0.8] * len(games), contexts)
    scale, back_to_back, notable_out = weights
    assert scale < 1.0
    assert back_to_back < 0.0
    assert notable_out == pytest.approx(0.0)
    # Opening night has nothing to learn from, so it is exactly Elo v1.
    assert preds[0] == pytest.approx(0.8)
    assert preds[-1] < 0.8


@pytest.mark.unit
def test_a_game_never_sees_its_own_result() -> None:
    games = [_game(index, index % 2 == 0) for index in range(30)]
    flipped = [*games[:-1], replace(games[-1], home_won=not games[-1].home_won)]
    preds, _weights = walk_forward(games, [0.65] * 30, {})
    flipped_preds, _flipped_weights = walk_forward(flipped, [0.65] * 30, {})
    assert preds == flipped_preds


@pytest.mark.unit
def test_same_day_games_share_one_fit() -> None:
    same_day = [replace(_game(index, True), game_date=date(2026, 10, 20)) for index in range(3)]
    preds, weights = walk_forward(same_day, [0.9, 0.9, 0.9], {})
    # None of the first night's results inform each other, but the next night's do.
    assert preds == pytest.approx([0.9, 0.9, 0.9])
    assert weights != PRIOR_WEIGHTS


@pytest.mark.unit
def test_score_games_applies_the_fitted_weights() -> None:
    weights = (0.5, -0.4, -0.2)
    upcoming = [_game(1, None)]
    context = {upcoming[0].game_id: GameContext(home_notable_out=2)}
    (scored,) = score_games(upcoming, [0.7], context, weights)
    assert scored == pytest.approx(predict(weights, features(0.7, context[upcoming[0].game_id])))
    assert scored < 0.7
