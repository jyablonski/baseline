import math
from contextlib import contextmanager
from dataclasses import replace
from datetime import date, datetime
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from breakdown import (
    POINTS_PER_LOGIT,
    elo_v0_breakdowns,
    elo_v1_parts,
    elo_v1_settings,
    layer_breakdowns,
    layer_settings,
    serialize,
)
from elo_v2 import GameContext, features, predict
from elo_v3 import features as features_v3

from elo import GameRow, score_games
from elo_v1 import EloV1State
from elo_v1 import score_games as score_games_v1
from scoring import score_and_persist

HOME = UUID(int=1)
AWAY = UUID(int=2)


def _game(index: int, home_won: bool | None = None) -> GameRow:
    return GameRow(
        game_id=UUID(int=100 + index),
        game_date=date(2026, 11, 10),
        season="2026-27",
        home_team_id=HOME,
        away_team_id=AWAY,
        home_won=home_won,
    )


def _line(breakdown: dict) -> float:
    return sum(part["points"] for part in breakdown["parts"])


def _logit_points(probability: float) -> float:
    return math.log(probability / (1.0 - probability)) * POINTS_PER_LOGIT


@pytest.mark.unit
def test_elo_v0_parts_add_up_to_its_probability() -> None:
    ratings = {HOME: 1560.0, AWAY: 1480.0}
    game = _game(0)
    [breakdown] = elo_v0_breakdowns([game], ratings)
    [probability] = score_games([game], ratings)
    assert [part["key"] for part in breakdown["parts"]] == ["strength", "home_court"]
    assert _line(breakdown) == pytest.approx(_logit_points(probability), abs=0.02)
    # v0's fixed +100 Elo home edge is worth several points: the reason it was replaced.
    assert breakdown["settings"]["home_court_points"] == pytest.approx(4.61, abs=0.01)


@pytest.mark.unit
def test_elo_v1_parts_add_up_and_settings_carry_the_home_tally() -> None:
    state = EloV1State(ratings={HOME: 1490.0, AWAY: 1530.0}, home_wins=52.0, home_games=100)
    game = _game(0)
    [parts] = elo_v1_parts([game], state)
    breakdown = serialize(parts, elo_v1_settings(state))
    [probability] = score_games_v1([game], state)
    assert _line(breakdown) == pytest.approx(_logit_points(probability), abs=0.02)
    # The away team is stronger, so strength favours it (negative is away).
    assert breakdown["parts"][0]["points"] < 0
    settings = breakdown["settings"]
    assert settings["home_games"] == 100
    assert settings["home_win_rate"] == pytest.approx(0.52)
    # 52 + 33 prior wins in 160 games: the learned edge, not the raw 52%.
    assert settings["home_court_points"] == pytest.approx(_logit_points((52 + 33) / 160), abs=0.01)


@pytest.mark.unit
def test_elo_v1_settings_without_games_have_no_win_rate() -> None:
    assert elo_v1_settings(EloV1State())["home_win_rate"] is None


@pytest.mark.unit
@pytest.mark.parametrize(
    ("feature_fn", "context"),
    [
        (features, GameContext(away_back_to_back=True, home_notable_out=2)),
        (features_v3, GameContext(home_back_to_back=True, injury_score_diff=-14.0)),
    ],
)
def test_layer_parts_add_up_to_the_layer_probability(feature_fn, context) -> None:
    state = EloV1State(ratings={HOME: 1550.0, AWAY: 1500.0})
    game = _game(0)
    weights = (0.8, -0.3, -0.15)
    v1_probs = score_games_v1([game], state)
    [breakdown] = layer_breakdowns(
        [game],
        v1_probs,
        elo_v1_parts([game], state),
        {game.game_id: context},
        weights,
        feature_fn=feature_fn,
        settings=layer_settings(elo_v1_settings(state), weights, injury_unit="notable_player"),
    )
    probability = predict(weights, feature_fn(v1_probs[0], context))
    keys = [part["key"] for part in breakdown["parts"]]
    assert keys == ["strength", "home_court", "confidence", "back_to_back", "injuries"]
    assert _line(breakdown) == pytest.approx(_logit_points(probability), abs=0.05)
    settings = breakdown["settings"]
    assert settings["confidence"] == 0.8
    assert settings["back_to_back_points"] == pytest.approx(-0.3 * POINTS_PER_LOGIT)
    assert settings["injury_points"] == pytest.approx(-0.15 * POINTS_PER_LOGIT)
    assert settings["injury_unit"] == "notable_player"


@pytest.mark.unit
def test_layer_without_context_counts_rested_and_healthy() -> None:
    state = EloV1State(ratings={HOME: 1500.0, AWAY: 1500.0})
    game = _game(0)
    [breakdown] = layer_breakdowns(
        [game],
        score_games_v1([game], state),
        elo_v1_parts([game], state),
        {},
        (1.0, -0.3, -0.15),
        feature_fn=features,
        settings={},
    )
    by_key = {part["key"]: part["points"] for part in breakdown["parts"]}
    assert by_key["back_to_back"] == 0
    assert by_key["injuries"] == 0
    assert by_key["confidence"] == 0


@contextmanager
def _session(mock_session):
    yield mock_session


@pytest.mark.unit
def test_score_and_persist_stores_a_breakdown_for_every_elo_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    history = [
        replace(_game(day, home_won), game_date=date(2026, 11, day))
        for day, home_won in ((1, True), (2, False), (3, True))
    ]
    upcoming = [_game(9)]
    session = MagicMock()
    # No logit artifact and no Elo snapshot.
    session.execute.return_value.mappings.return_value.first.return_value = None
    stored: list[dict] = []
    monkeypatch.setattr("scoring.get_session", lambda: _session(session))
    monkeypatch.setattr("scoring.load_regular_season_finals", lambda sess: history)
    monkeypatch.setattr("scoring.load_upcoming_games", lambda sess, **window: upcoming)
    monkeypatch.setattr("scoring.load_market_wp", lambda sess: {})
    monkeypatch.setattr("scoring.load_feature_rows", lambda sess: [])
    monkeypatch.setattr(
        "scoring.load_game_contexts",
        lambda sess: {upcoming[0].game_id: GameContext(home_back_to_back=True)},
    )
    monkeypatch.setattr(
        "scoring.upsert_rows",
        lambda _session, _model, rows, _conflict: stored.extend(rows) or len(rows),
    )
    score_and_persist(as_of=datetime(2026, 11, 10, 8, 0))
    assert {row["model_version"] for row in stored} == {"elo-v0", "elo-v1", "elo-v2", "elo-v3"}
    for row in stored:
        assert _line(row["breakdown"]) == pytest.approx(_logit_points(row["model_wp"]), abs=0.05), (
            row["model_version"]
        )
