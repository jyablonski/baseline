import json
from contextlib import contextmanager
from datetime import date, datetime
from unittest.mock import MagicMock
from uuid import UUID, uuid5

import pytest
from click.testing import CliRunner

from elo import MODEL_VERSION, GameRow
from main import cli, main
from queries import (
    INSERT_GAME_PREDICTION,
    REGISTER_MODEL,
    SELECT_LIVE_PREDICTED_GAMES,
    SELECT_MARKET_WP_BY_GAME,
    SELECT_REGULAR_SEASON_FINALS,
    SELECT_UPCOMING_GAMES,
)
from scoring import (
    backfill_and_persist,
    build_backfill_rows,
    build_graded_rows,
    build_prediction_rows,
    evaluate,
    evaluate_holdout,
    holdout_season,
    load_elo_seed,
    load_live_predicted_games,
    load_market_wp,
    load_regular_season_finals,
    load_upcoming_games,
    score_and_persist,
    snapshot_elo,
    walk_elo_v0,
    walk_elo_v1,
)

TEAM_HOME = UUID("00000000-0000-4000-8000-000000000201")
TEAM_AWAY = UUID("00000000-0000-4000-8000-000000000202")
GAME_NAMESPACE = UUID("00000000-0000-0000-0000-000000000001")


def _id(value: str) -> UUID:
    return uuid5(GAME_NAMESPACE, value)


@contextmanager
def _session(mock_session):
    yield mock_session


def _game(season: str, home_won: bool | None, game_id: str = "1") -> GameRow:
    return GameRow(
        game_id=_id(game_id),
        game_date=date(2024, 10, 22),
        season=season,
        home_team_id=TEAM_HOME,
        away_team_id=TEAM_AWAY,
        home_won=home_won,
    )


@pytest.mark.unit
def test_query_sql_targets_gold_and_source() -> None:
    assert "gold.fct_team_game_results" in str(SELECT_REGULAR_SEASON_FINALS)
    assert "Regular Season" in str(SELECT_REGULAR_SEASON_FINALS)
    assert "gold.fct_games_schedule" in str(SELECT_UPCOMING_GAMES)
    assert "silver.stg_game_odds" in str(SELECT_MARKET_WP_BY_GAME)
    assert "INSERT INTO source.game_predictions" in str(INSERT_GAME_PREDICTION)


@pytest.mark.unit
def test_holdout_season_and_evaluate() -> None:
    games = [
        _game("2023-24", True, "a"),
        _game("2023-24", False, "b"),
        _game("2024-25", True, "c"),
        _game("2024-25", True, "d"),
    ]
    assert holdout_season(games) == "2024-25"
    assert holdout_season(games[:1]) is None
    result = evaluate_holdout(games)
    assert result["holdout_season"] == "2024-25"
    assert result["n"] == 2
    assert result["model_version"] == MODEL_VERSION
    single = evaluate_holdout(games[:1])
    assert single["n"] == 1


@pytest.mark.unit
def test_build_prediction_rows_attaches_market_wp() -> None:
    upcoming = [_game("2024-25", None, "002")]
    rows = build_prediction_rows(
        upcoming,
        [0.61],
        {_id("002"): 0.55},
        as_of=datetime(2024, 10, 26, 12, 0, 0),
    )
    assert rows[0]["model_wp"] == 0.61
    assert rows[0]["market_wp"] == 0.55
    assert rows[0]["model_version"] == MODEL_VERSION


@pytest.mark.unit
def test_load_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.mappings.return_value.all.return_value = [
        {
            "game_id": _id("002"),
            "game_date": date(2024, 10, 22),
            "season": "2024-25",
            "home_team_id": TEAM_HOME,
            "away_team_id": TEAM_AWAY,
            "winner_location": "home",
        }
    ]
    finals = load_regular_season_finals(session)
    assert finals[0].home_won is True
    session.execute.return_value.mappings.return_value.all.return_value = [
        {
            "game_id": _id("003"),
            "game_date": date(2024, 10, 27),
            "season": "2024-25",
            "home_team_id": TEAM_HOME,
            "away_team_id": TEAM_AWAY,
        }
    ]
    upcoming = load_upcoming_games(session)
    assert upcoming[0].home_won is None
    session.execute.return_value.mappings.return_value.all.return_value = [
        {"game_id": _id("003"), "market_wp": 0.58},
        {"game_id": _id("004"), "market_wp": None},
    ]
    assert load_market_wp(session) == {_id("003"): 0.58}


@pytest.mark.unit
def test_score_and_persist_and_evaluate(monkeypatch: pytest.MonkeyPatch) -> None:
    history = [_game("2023-24", True, "h1"), _game("2024-25", False, "h2")]
    upcoming = [_game("2024-25", None, "u1")]
    session = MagicMock()
    session.execute.return_value.mappings.return_value.first.return_value = {
        "model_version": "elo-v0",
        "model_name": "elo",
        "artifact": {},
    }
    monkeypatch.setattr("scoring.get_session", lambda: _session(session))
    monkeypatch.setattr("scoring.load_regular_season_finals", lambda sess: history)
    monkeypatch.setattr("scoring.load_upcoming_games", lambda sess: upcoming)
    monkeypatch.setattr("scoring.load_market_wp", lambda sess: {_id("u1"): 0.52})
    monkeypatch.setattr("scoring.upsert_rows", lambda *args, **kwargs: 1)
    result = score_and_persist(as_of=datetime(2024, 10, 26, 8, 0, 0))
    assert result["written"] == 1
    assert result["upcoming_games"] == 1
    assert result["history_games"] == 2

    eval_result = evaluate()
    assert eval_result["n"] == 1


@pytest.mark.unit
def test_build_graded_rows_filters_season_and_unfinished_games() -> None:
    scored = [
        (_game("2023-24", True, "a"), 0.7),
        (_game("2024-25", True, "b"), 0.6),
        (_game("2024-25", None, "c"), 0.5),
    ]
    scraped_at = datetime(2026, 9, 23, 9, 0, 0)
    rows = build_graded_rows(
        scored,
        {_id("b"): 0.55},
        season="2024-25",
        scraped_at=scraped_at,
        model_name="elo",
        model_version="elo-v0",
    )
    # Only the 2024-25 Final: "a" is the wrong season, "c" has no result.
    assert [row["game_id"] for row in rows] == [_id("b")]
    assert rows[0]["as_of"] == datetime(2024, 10, 22)
    assert rows[0]["model_wp"] == 0.6
    assert rows[0]["market_wp"] == 0.55
    assert rows[0]["scraped_at"] == scraped_at


@pytest.mark.unit
def test_build_backfill_rows_logit_is_opt_in_and_live_rows_are_kept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    history = [_game("2023-24", True, "a"), _game("2024-25", True, "b")]
    scraped_at = datetime(2026, 9, 23, 9, 0, 0)
    seasons: list[str | None] = []

    def _logit(rows, **kwargs):
        seasons.append(kwargs["season"])
        return [(history[1], 0.7)]

    monkeypatch.setattr("scoring._evaluate_logit_predictions", _logit)
    elo_only = build_backfill_rows(history, [], {}, season="2024-25", scraped_at=scraped_at)
    assert sorted(row["model_version"] for row in elo_only) == ["elo-v0", "elo-v1"]
    assert seasons == []

    rows = build_backfill_rows(
        history,
        [],
        {},
        season="2024-25",
        scraped_at=scraped_at,
        live={(_id("b"), "elo-v0")},
        with_logit=True,
    )
    by_version = {row["model_version"]: row for row in rows}
    # elo-v0 already has a live prediction for "b", so the replay stays out.
    assert sorted(by_version) == ["elo-v1", "logit-v1"]
    assert by_version["logit-v1"]["model_wp"] == 0.7
    assert seasons == ["2024-25"]

    # "a" was a home win, so the (regressed) home rating is above neutral.
    v0 = next(row for row in elo_only if row["model_version"] == "elo-v0")
    neutral = build_backfill_rows(history[1:], [], {}, season=None, scraped_at=scraped_at)
    neutral_v0 = next(row for row in neutral if row["model_version"] == "elo-v0")
    assert v0["model_wp"] > neutral_v0["model_wp"]


@pytest.mark.unit
def test_load_live_predicted_games() -> None:
    session = MagicMock()
    session.execute.return_value.mappings.return_value.all.return_value = [
        {"game_id": str(_id("a")), "model_version": "elo-v0"},
    ]
    assert load_live_predicted_games(session) == {(_id("a"), "elo-v0")}
    assert session.execute.call_args.args[0] is SELECT_LIVE_PREDICTED_GAMES


@pytest.mark.unit
def test_backfill_and_persist_batches_upserts(monkeypatch: pytest.MonkeyPatch) -> None:
    history = [_game("2024-25", True, str(index)) for index in range(3)]
    batches: list[int] = []
    feature_loads: list[bool] = []
    session = MagicMock()
    monkeypatch.setattr("scoring.get_session", lambda: _session(session))
    monkeypatch.setattr("scoring.load_regular_season_finals", lambda sess: history)
    monkeypatch.setattr("scoring.load_feature_rows", lambda sess: feature_loads.append(True) or [])
    monkeypatch.setattr("scoring.load_market_wp", lambda sess: {})
    monkeypatch.setattr("scoring.load_live_predicted_games", lambda sess: {(_id("0"), "elo-v1")})
    monkeypatch.setattr("scoring.BACKFILL_BATCH_SIZE", 4)

    def _upsert(session, model, rows, conflict_columns):
        batches.append(len(rows))
        return len(rows)

    monkeypatch.setattr("scoring.upsert_rows", _upsert)
    result = backfill_and_persist(season="2024-25")
    # 3 games x 2 Elo versions, minus the one live elo-v1 prediction.
    assert batches == [4, 1]
    assert result["written"] == 5
    assert result["model_versions"] == ["elo-v0", "elo-v1"]
    assert result["season"] == "2024-25"
    assert session.execute.call_args.args[0] is REGISTER_MODEL
    # Features are only loaded (and logit only replayed) when asked for.
    assert feature_loads == []
    assert backfill_and_persist(with_logit=True)["season"] == "all"
    assert feature_loads == [True]


@pytest.mark.unit
def test_cli_eval_and_score(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "main.evaluate",
        lambda: {
            "model_name": "elo",
            "model_version": "elo-v0",
            "holdout_season": "2024-25",
            "n": 2,
            "logloss": 0.68,
            "brier": 0.24,
            "accuracy": 0.55,
            "home_always_accuracy": 0.58,
        },
    )
    monkeypatch.setattr(
        "main.score_and_persist",
        lambda: {
            "model_name": "elo",
            "model_version": "elo-v0",
            "history_games": 10,
            "upcoming_games": 3,
            "written": 3,
            "as_of": "2024-10-26T08:00:00",
        },
    )
    runner = CliRunner()
    ev = runner.invoke(cli, ["eval"])
    assert ev.exit_code == 0
    assert "logloss" in ev.output
    sc = runner.invoke(cli, ["score"])
    assert sc.exit_code == 0
    assert "written=3" in sc.output

    monkeypatch.setattr(
        "main.evaluate_logit",
        lambda: {
            "n": 2,
            "logloss": 0.68,
            "brier": 0.24,
            "accuracy": 0.55,
            "home_always_accuracy": 0.58,
        },
    )
    logit_eval = runner.invoke(cli, ["eval-logit"])
    assert logit_eval.exit_code == 0
    assert "model=logit" in logit_eval.output

    monkeypatch.setattr(
        "main.train_model",
        lambda: {
            "model_name": "logit",
            "model_version": "logit-v1",
            "training_rows": 12,
            "training_seasons": ["2024-25"],
            "trained_at": "2024-10-26T08:00:00",
        },
    )
    train = runner.invoke(cli, ["train"])
    assert train.exit_code == 0
    assert "training_rows=12" in train.output

    seasons: list[str | None] = []
    logit_flags: list[bool] = []

    def _backfill(season=None, with_logit=False):
        seasons.append(season)
        logit_flags.append(with_logit)
        return {
            "model_versions": ["elo-v0", "elo-v1"],
            "season": season or "all",
            "history_games": 10,
            "written": 8,
        }

    monkeypatch.setattr("main.backfill_and_persist", _backfill)
    backfill = runner.invoke(cli, ["backfill", "--season", "2025-26"])
    assert backfill.exit_code == 0
    assert "written=8" in backfill.output
    assert "model_versions=elo-v0,elo-v1" in backfill.output
    assert seasons == ["2025-26"]
    assert runner.invoke(cli, ["backfill", "--with-logit"]).exit_code == 0
    assert logit_flags == [False, True]


@pytest.mark.unit
def test_main_invokes_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []
    monkeypatch.setattr("main.cli", lambda: called.append(True))
    main()
    assert called == [True]


@pytest.mark.unit
def test_settings_and_db_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    from config import Settings
    from db import get_session, upsert_rows
    from models import GamePrediction

    settings = Settings(database_url="")
    assert settings.database_url.startswith("postgresql://")
    session = MagicMock()
    assert upsert_rows(session, GamePrediction, [], ["game_id"]) == 0
    session.execute.assert_not_called()
    now = datetime.now()
    rows = [
        {
            "game_id": "002",
            "as_of": now,
            "model_name": "elo",
            "model_version": "elo-v0",
            "home_team_id": 1,
            "away_team_id": 2,
            "model_wp": 0.6,
            "market_wp": None,
            "scraped_at": now,
        }
    ]
    assert upsert_rows(session, GamePrediction, rows, ["game_id", "as_of", "model_version"]) == 1
    session.execute.assert_called()

    fake = MagicMock()
    with monkeypatch.context() as ctx:
        ctx.setattr("db.SessionLocal", lambda: fake)
        with get_session() as db:
            assert db is fake
    fake.commit.assert_called()
    fake.close.assert_called()

    fake = MagicMock()
    fake.commit.side_effect = RuntimeError("fail")
    with monkeypatch.context() as ctx:
        ctx.setattr("db.SessionLocal", lambda: fake)
        with pytest.raises(RuntimeError):
            with get_session():
                pass
    fake.rollback.assert_called()


def _season_games() -> list[GameRow]:
    """Two seasons, two games each, on distinct dates."""
    return [
        GameRow(
            game_id=_id(f"s{index}"),
            game_date=game_date,
            season=season,
            home_team_id=TEAM_HOME,
            away_team_id=TEAM_AWAY,
            home_won=home_won,
            home_margin=8 if home_won else -3,
        )
        for index, (season, game_date, home_won) in enumerate(
            [
                ("2025-26", date(2025, 10, 22), True),
                ("2025-26", date(2025, 10, 24), True),
                ("2026-27", date(2026, 10, 20), False),
                ("2026-27", date(2026, 10, 22), True),
            ]
        )
    ]


def _snapshot(monkeypatch: pytest.MonkeyPatch, history: list[GameRow], seeds: dict) -> dict:
    """Run snapshot_elo over `history`, returning the artifacts it stored by version."""
    session = MagicMock()
    monkeypatch.setattr("scoring.get_session", lambda: _session(session))
    monkeypatch.setattr("scoring.load_regular_season_finals", lambda sess: history)
    monkeypatch.setattr("scoring.load_elo_seed", lambda sess, version: seeds.get(version))
    snapshot_elo(trained_at=datetime(2026, 10, 4))
    return {
        call.args[1]["model_version"]: json.loads(call.args[1]["artifact"])
        for call in session.execute.call_args_list
    }


@pytest.mark.unit
def test_elo_snapshot_survives_deleting_its_games(monkeypatch: pytest.MonkeyPatch) -> None:
    games = _season_games()
    _all, full_v0_preds, full_ratings = walk_elo_v0(games)
    _all, full_v1_preds, full_state = walk_elo_v1(games)

    seeds = _snapshot(monkeypatch, games[:2], {})
    assert seeds["elo-v0"]["through_season"] == "2025-26"
    assert seeds["elo-v0"]["through_date"] == "2025-10-24"
    assert seeds["elo-v0"]["games"] == 2

    # 2025-26 deleted: resuming from the snapshot matches the uninterrupted walk,
    # including the regression at the season boundary.
    walked, v0_preds, ratings = walk_elo_v0(games[2:], seeds["elo-v0"])
    assert walked == games[2:]
    assert v0_preds == pytest.approx(full_v0_preds[2:])
    assert ratings == pytest.approx(full_ratings)
    _walked, v1_preds, state = walk_elo_v1(games[2:], seeds["elo-v1"])
    assert v1_preds == pytest.approx(full_v1_preds[2:])
    assert state.ratings == pytest.approx(full_state.ratings)
    assert state.season_games == full_state.season_games
    assert (state.home_wins, state.home_games) == (full_state.home_wins, full_state.home_games)

    # Nothing loaded at all still scores from the snapshot rather than 1500.
    _walked, _preds, ratings = walk_elo_v0([], seeds["elo-v0"])
    assert ratings[TEAM_HOME] > 1500.0 > ratings[TEAM_AWAY]


@pytest.mark.unit
def test_elo_snapshot_is_ignored_while_its_games_are_loaded() -> None:
    games = _season_games()
    stale = {
        "ratings": {str(TEAM_HOME): 1900.0, str(TEAM_AWAY): 1100.0},
        "through_season": "2025-26",
        "through_date": "2025-10-24",
        "games": 2,
    }
    walked, preds, ratings = walk_elo_v0(games, stale)
    assert walked == games
    assert (preds, ratings) == walk_elo_v0(games)[1:]
    rows = build_backfill_rows(
        games, [], {}, season="2025-26", scraped_at=datetime(2026, 10, 4), v0_seed=stale
    )
    assert sum(row["model_version"] == "elo-v0" for row in rows) == 2


@pytest.mark.unit
def test_elo_snapshot_rolls_forward_and_refuses_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    games = _season_games()
    seeds = _snapshot(monkeypatch, games[:2], {})
    # Old season gone, one new Final: the snapshot advances instead of restarting.
    rolled = _snapshot(monkeypatch, games[2:3], seeds)
    assert rolled["elo-v0"]["games"] == 3
    assert rolled["elo-v0"]["through_season"] == "2026-27"
    assert rolled["elo-v1"]["home_games"] == 3
    # No new games: unchanged.
    assert _snapshot(monkeypatch, [], seeds) == seeds
    with pytest.raises(ValueError, match="no Regular Season Finals"):
        _snapshot(monkeypatch, [], {})


@pytest.mark.unit
def test_load_elo_seed() -> None:
    session = MagicMock()
    session.execute.return_value.mappings.return_value.first.return_value = None
    assert load_elo_seed(session, "elo-v0") is None
    # The migration registers elo-v0 with an empty artifact.
    session.execute.return_value.mappings.return_value.first.return_value = {"artifact": {}}
    assert load_elo_seed(session, "elo-v0") is None
    seed = {"ratings": {}, "through_season": "2025-26", "through_date": "2026-04-12", "games": 0}
    session.execute.return_value.mappings.return_value.first.return_value = {"artifact": seed}
    assert load_elo_seed(session, "elo-v0") == seed


@pytest.mark.unit
def test_cli_snapshot_elo(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "main.snapshot_elo",
        lambda: {
            "model_versions": ["elo-v0", "elo-v1"],
            "through_season": "2025-26",
            "through_date": "2026-04-12",
            "games": 1230,
            "teams": 30,
            "trained_at": "2026-10-04T00:00:00",
        },
    )
    result = CliRunner().invoke(cli, ["snapshot-elo"])
    assert result.exit_code == 0
    assert "through_season=2025-26" in result.output
    assert "games=1230" in result.output
