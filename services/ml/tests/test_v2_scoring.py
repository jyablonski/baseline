from contextlib import contextmanager
from dataclasses import replace
from datetime import date, datetime, timedelta
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from logit import FEATURE_NAMES, FeatureRow, fit_artifact

import scoring
from elo import GameRow

HOME = UUID("00000000-0000-4000-8000-000000000201")
AWAY = UUID("00000000-0000-4000-8000-000000000202")


def _feature(index: int, home_won: bool | None = None, before: int = 12) -> FeatureRow:
    return FeatureRow(
        game_id=UUID(int=index + 100),
        game_date=date(2024, 10, 1) + timedelta(days=index),
        season="2024-25",
        home_team_id=HOME,
        away_team_id=AWAY,
        home_won=home_won,
        home_games_before=before,
        away_games_before=before,
        values={name: float(index % 5) for name in FEATURE_NAMES},
    )


@pytest.mark.unit
def test_load_feature_rows_and_model_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    result = MagicMock()
    result.mappings.return_value.all.return_value = [
        {
            "game_id": UUID(int=101),
            "game_date": date(2024, 10, 1),
            "season": "2024-25",
            "home_team_id": HOME,
            "away_team_id": AWAY,
            "home_won": True,
            "home_games_before": 1,
            "away_games_before": 1,
            **{name: 0.0 for name in FEATURE_NAMES},
        }
    ]
    session.execute.return_value = result
    rows = scoring.load_feature_rows(session)
    assert rows[0].game_id == UUID(int=101)

    artifact = {
        "feature_names": list(FEATURE_NAMES),
        "means": {name: 0.0 for name in FEATURE_NAMES},
        "scales": {name: 1.0 for name in FEATURE_NAMES},
        "coefficients": [0.0 for _name in FEATURE_NAMES],
        "intercept": 0.0,
    }
    result.mappings.return_value.first.return_value = {"artifact": artifact}
    assert scoring.load_model_artifact(session, "logit-v1") == artifact
    result.mappings.return_value.first.return_value = None
    assert scoring.load_model_artifact(session, "missing") is None

    result.mappings.return_value.first.return_value = {
        "model_version": "elo-v0",
        "model_name": "elo",
        "artifact": {},
    }
    scoring.set_champion_model(session, "elo-v0")
    session.execute.assert_called()


@pytest.mark.unit
def test_set_champion_requires_registered_model() -> None:
    session = MagicMock()
    session.execute.return_value.mappings.return_value.first.return_value = None
    with pytest.raises(ValueError, match="not registered"):
        scoring.set_champion_model(session, "missing")


@pytest.mark.unit
def test_train_model_persists_json_artifact(monkeypatch: pytest.MonkeyPatch) -> None:
    rows = [_feature(index, index % 2 == 0) for index in range(12)]
    session = MagicMock()

    @contextmanager
    def session_context():
        yield session

    monkeypatch.setattr(scoring, "get_session", session_context)
    monkeypatch.setattr(scoring, "load_feature_rows", lambda _session: rows)
    result = scoring.train_model(
        model_version="logit-test",
        trained_at=datetime(2024, 12, 1, 12, 0, 0),
    )
    assert result["model_version"] == "logit-test"
    assert result["training_rows"] == 12
    assert '"coefficients"' in session.execute.call_args.args[1]["artifact"]


@pytest.mark.unit
def test_score_writes_elo_and_logit_when_artifact_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    game_id = UUID(int=100)
    history = [
        GameRow(
            game_id=UUID(int=1),
            game_date=date(2024, 9, 1),
            season="2024-25",
            home_team_id=HOME,
            away_team_id=AWAY,
            home_won=True,
        )
    ]
    upcoming = [
        GameRow(
            game_id=game_id,
            game_date=date(2024, 10, 20),
            season="2024-25",
            home_team_id=HOME,
            away_team_id=AWAY,
        )
    ]
    feature = _feature(0, None, before=12)
    artifact = fit_artifact([_feature(index, index % 2 == 0) for index in range(12)])
    session = MagicMock()

    @contextmanager
    def session_context():
        yield session

    captured: list[dict] = []
    monkeypatch.setattr(scoring, "get_session", session_context)
    monkeypatch.setattr(scoring, "load_regular_season_finals", lambda _session: history)
    monkeypatch.setattr(scoring, "load_upcoming_games", lambda _session: upcoming)
    monkeypatch.setattr(scoring, "load_market_wp", lambda _session: {})
    monkeypatch.setattr(scoring, "load_feature_rows", lambda _session: [feature])
    monkeypatch.setattr(scoring, "load_model_artifact", lambda _session, _version: artifact)
    monkeypatch.setattr(scoring, "set_champion_model", lambda *_args: None)
    monkeypatch.setattr(
        scoring,
        "upsert_rows",
        lambda _session, _model, rows, _conflict: captured.extend(rows) or len(rows),
    )
    result = scoring.score_and_persist(as_of=datetime(2024, 10, 20, 12, 0, 0))
    assert result["written"] == 3
    assert {row["model_version"] for row in captured} == {"elo-v0", "elo-v1", "logit-v1"}
    assert result["model_versions"] == ["elo-v0", "elo-v1", "logit-v1"]


@pytest.mark.unit
def test_evaluate_logit_rows_expands_and_handles_empty() -> None:
    rows = [_feature(index, index % 2 == 0, before=20) for index in range(12)]
    result = scoring.evaluate_logit_rows(rows, block_size=5, cold_start_games=0)
    assert result["n"] == 7
    assert scoring.evaluate_logit_rows([])["n"] == 0


@pytest.mark.unit
def test_evaluate_logit_predictions_only_refits_blocks_in_season(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [_feature(index, index % 2 == 0, before=20) for index in range(12)]
    rows = [
        replace(row, season="2025-26") if index >= 10 else row for index, row in enumerate(rows)
    ]
    fits: list[int] = []
    real_fit = scoring.fit_artifact
    monkeypatch.setattr(
        scoring, "fit_artifact", lambda training: fits.append(len(training)) or real_fit(training)
    )
    scored = scoring._evaluate_logit_predictions(
        rows, block_size=5, cold_start_games=0, season="2025-26"
    )
    # Blocks are games 0-4 (no training data), 5-9 (all 2024-25: skipped), 10-11.
    assert fits == [10]
    assert [row.season for row, _probability in scored] == ["2025-26", "2025-26"]


@pytest.mark.unit
def test_evaluate_logit_loads_features(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()

    @contextmanager
    def session_context():
        yield session

    rows = [_feature(index, index % 2 == 0, before=20) for index in range(12)]
    monkeypatch.setattr(scoring, "get_session", session_context)
    monkeypatch.setattr(scoring, "load_feature_rows", lambda _session: rows)
    result = scoring.evaluate_logit()
    assert result["n"] == 0


@pytest.mark.unit
def test_evaluate_logit_persists_season_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()

    @contextmanager
    def session_context():
        yield session

    rows = [_feature(index, index % 2 == 0, before=20) for index in range(12)]
    scored_rows = [(rows[0], 0.6), (rows[1], 0.4)]
    monkeypatch.setattr(scoring, "get_session", session_context)
    monkeypatch.setattr(scoring, "load_feature_rows", lambda _session: rows)
    monkeypatch.setattr(
        scoring, "_evaluate_logit_predictions", lambda *_args, **_kwargs: scored_rows
    )

    result = scoring.evaluate_logit()

    assert result["n"] == 2
    params = session.execute.call_args.args[1]
    assert params["evaluation_name"] == "expanding-window"
    assert params["season"] == "2024-25"
    assert params["n"] == 2
