from datetime import date
from uuid import UUID

import pytest

from elo import INITIAL_RATING, GameRow, game_row_from_mapping
from elo_v1 import (
    EARLY_GAMES,
    HOME_PRIOR_RATE,
    EloV1State,
    expected_home_win,
    mov_multiplier,
    score_games,
    walk_forward,
)


def _game(
    game_id: int,
    season: str,
    home: int,
    away: int,
    home_won: bool | None,
    home_margin: int | None = None,
) -> GameRow:
    return GameRow(
        game_id=UUID(int=game_id),
        game_date=date(2025, 10, 21),
        season=season,
        home_team_id=UUID(int=home),
        away_team_id=UUID(int=away),
        home_won=home_won,
        home_margin=home_margin,
    )


@pytest.mark.unit
def test_home_advantage_starts_at_prior_and_learns() -> None:
    state = EloV1State()
    prior = expected_home_win(INITIAL_RATING, INITIAL_RATING, state.home_advantage())
    assert prior == pytest.approx(HOME_PRIOR_RATE)
    state.home_games, state.home_wins = 1000, 500.0
    assert state.home_advantage() < EloV1State().home_advantage()


@pytest.mark.unit
def test_mov_multiplier_grows_with_margin_and_damps_favourites() -> None:
    assert mov_multiplier(None, 0.0) == 1.0
    assert mov_multiplier(20, 0.0) > mov_multiplier(2, 0.0)
    assert mov_multiplier(-20, 0.0) == mov_multiplier(20, 0.0)
    assert mov_multiplier(20, 200.0) < mov_multiplier(20, -200.0)


@pytest.mark.unit
def test_walk_forward_predicts_before_update_and_scales_by_margin() -> None:
    games = [_game(1, "2025-26", 1, 2, True, 3), _game(2, "2025-26", 3, 4, True, 30)]
    preds, state = walk_forward(games)
    # Game 1 is predicted from the prior alone.
    assert preds[0] == pytest.approx(HOME_PRIOR_RATE)
    close_gain = state.ratings[UUID(int=1)] - INITIAL_RATING
    blowout_gain = state.ratings[UUID(int=3)] - INITIAL_RATING
    assert 0 < close_gain < blowout_gain
    assert state.home_games == 2
    assert state.season_games[UUID(int=1)] == 1


@pytest.mark.unit
def test_walk_forward_uses_smaller_k_after_early_games() -> None:
    # Alternating results keep team 1 near 1500, so the win's step size is set by K.
    settled = [_game(i, "2025-26", 1, 2, i % 2 == 0) for i in range(1, 2 * EARLY_GAMES + 1)]
    _preds, before = walk_forward(settled)
    _preds, after = walk_forward([*settled, _game(999, "2025-26", 1, 2, True)])
    _preds, early = walk_forward([_game(1, "2025-26", 1, 2, True)])
    settled_step = after.ratings[UUID(int=1)] - before.ratings[UUID(int=1)]
    early_step = early.ratings[UUID(int=1)] - INITIAL_RATING
    assert 0 < settled_step < early_step


@pytest.mark.unit
def test_walk_forward_regresses_and_resets_at_season_boundary() -> None:
    games = [
        _game(1, "2024-25", 1, 2, True, 20),
        _game(2, "2025-26", 1, 2, None),
    ]
    preds, state = walk_forward(games)
    assert state.season_games == {}
    assert preds[1] > preds[0]
    # Unfinished games are scored but change nothing.
    assert state.home_games == 1


@pytest.mark.unit
def test_score_games_uses_final_state() -> None:
    history = [_game(1, "2025-26", 1, 2, True, 10)]
    _preds, state = walk_forward(history)
    upcoming = [_game(2, "2025-26", 1, 2, None), _game(3, "2025-26", 5, 6, None)]
    strong, unknown = score_games(upcoming, state)
    assert strong > unknown


@pytest.mark.unit
def test_game_row_reads_home_margin_from_scores() -> None:
    row = game_row_from_mapping(
        {
            "game_id": UUID(int=1),
            "game_date": date(2025, 10, 21),
            "season": "2025-26",
            "home_team_id": UUID(int=1),
            "away_team_id": UUID(int=2),
            "winner_location": "away",
            "home_score": 100,
            "away_score": 110,
        }
    )
    assert row.home_margin == -10
    assert row.home_won is False
