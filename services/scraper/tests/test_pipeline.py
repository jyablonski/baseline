from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from notify import SyncAlert, SyncFailedError
from pipeline import (
    DAILY_REDDIT_COMMENTS_PER_POST,
    DAILY_REDDIT_LIMIT,
    DAILY_REDDIT_SUBREDDIT,
    DAILY_REDDIT_TIME_FILTER,
    PipelineConfig,
    compose_run_action,
    decide_action,
    execute_contracts,
    execute_reddit,
    execute_scrape,
    execute_transactions,
    finish_run,
    in_season_window,
    load_config,
    mark_scrape_success,
    record_dbt_only_run,
    record_source_runs,
    run_pipeline_scrape,
    set_enabled,
    should_run_contracts,
    should_run_reddit,
    should_run_transactions,
    start_run,
    update_run_dbt_exit,
)

from queries import (
    INSERT_DBT_ONLY_RUN,
    INSERT_PIPELINE_RUN,
    INSERT_SOURCE_RUN,
    SELECT_PIPELINE_CONFIG,
    UPDATE_PIPELINE_ENABLED,
    UPDATE_PIPELINE_RUN,
    UPDATE_PIPELINE_RUN_DBT_EXIT,
    UPDATE_PIPELINE_SUCCESS,
)


@contextmanager
def _session(mock_session):
    yield mock_session


def _config(**overrides) -> PipelineConfig:
    defaults = dict(
        enabled=True,
        season_active=True,
        season_start=date(2025, 10, 1),
        season_end=date(2026, 6, 30),
        scrape_mode="daily",
        target_season="2025-26",
        last_success_at=None,
        last_scrape_date=None,
        reason=None,
        updated_at=None,
    )
    defaults.update(overrides)
    return PipelineConfig(**defaults)


def _row(**overrides) -> SimpleNamespace:
    defaults = dict(
        enabled=True,
        season_active=True,
        season_start=date(2025, 10, 1),
        season_end=date(2026, 6, 30),
        scrape_mode="daily",
        target_season="2025-26",
        last_success_at=None,
        last_scrape_date=None,
        reason=None,
        updated_at=None,
    )
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


class _session_ctx:
    """Stand-in for get_session()'s context manager."""

    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False


@pytest.mark.unit
def test_query_sql_targets_source_tables() -> None:
    from queries import DELETE_STALE_GAME_ODDS, DELETE_STALE_PLAYER_INJURIES

    assert "DELETE FROM source.player_injuries" in str(DELETE_STALE_PLAYER_INJURIES)
    assert "DELETE FROM source.game_odds" in str(DELETE_STALE_GAME_ODDS)
    assert "FROM source.scrape_pipeline" in str(SELECT_PIPELINE_CONFIG)
    assert "scrape_reddit" not in str(SELECT_PIPELINE_CONFIG)
    assert "UPDATE source.scrape_pipeline" in str(UPDATE_PIPELINE_ENABLED)
    assert "scrape_reddit" not in str(UPDATE_PIPELINE_ENABLED)
    assert "UPDATE source.scrape_pipeline" in str(UPDATE_PIPELINE_SUCCESS)
    assert "INSERT INTO source.pipeline_runs" in str(INSERT_PIPELINE_RUN)
    assert "UPDATE source.pipeline_runs" in str(UPDATE_PIPELINE_RUN)
    assert "reddit_ran = :reddit_ran" in str(UPDATE_PIPELINE_RUN)
    assert "UPDATE source.pipeline_runs" in str(UPDATE_PIPELINE_RUN_DBT_EXIT)


@pytest.mark.unit
def test_pipeline_config_from_row_defaults_mode() -> None:
    config = PipelineConfig.from_row(_row(scrape_mode=None, enabled=0))
    assert config.scrape_mode == "daily"
    assert config.enabled is False
    assert not hasattr(config, "scrape_reddit")


@pytest.mark.unit
def test_load_config_executes_select() -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    config = load_config(session)
    session.execute.assert_called_once_with(SELECT_PIPELINE_CONFIG)
    assert config.scrape_mode == "daily"


@pytest.mark.unit
def test_set_enabled_then_reloads() -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(enabled=True, reason="on")
    config = set_enabled(session, enabled=True, reason="on", scrape_mode="season")
    session.execute.assert_any_call(
        UPDATE_PIPELINE_ENABLED,
        {
            "enabled": True,
            "season_active": None,
            "season_start": None,
            "season_end": None,
            "scrape_mode": "season",
            "target_season": None,
            "reason": "on",
        },
    )
    assert config.enabled is True


@pytest.mark.unit
def test_in_season_window() -> None:
    today = date(2026, 1, 15)
    assert in_season_window(_config(), today=today) is True
    assert in_season_window(_config(season_active=False), today=today) is False
    assert in_season_window(_config(season_start=date(2026, 2, 1)), today=today) is False
    assert in_season_window(_config(season_end=date(2025, 12, 1)), today=today) is False
    assert in_season_window(_config(season_start=None, season_end=None), today=today) is True
    assert in_season_window(_config(season_start=None, season_end=None)) is True


@pytest.mark.unit
def test_decide_action_branches() -> None:
    today = date(2026, 1, 15)
    action, _ = decide_action(_config(enabled=False), today=today)
    assert action == "skipped_disabled"
    action, _ = decide_action(_config(season_active=False), today=today)
    assert action == "skipped_offseason"
    action, _ = decide_action(_config(scrape_mode="none"), today=today)
    assert action == "skipped_mode_none"
    action, _ = decide_action(_config(scrape_mode="season", target_season=None), today=today)
    assert action == "noop"
    action, detail = decide_action(_config(scrape_mode="season"), today=today)
    assert action == "season"
    assert "2025-26" in detail
    action, _ = decide_action(_config(), today=today)
    assert action == "daily"
    action, _ = decide_action(
        _config(enabled=False, season_active=False, scrape_mode="none"),
        force=True,
    )
    assert action == "skipped_mode_none"


@pytest.mark.unit
def test_should_run_reddit_when_pipeline_allowed() -> None:
    today = date(2026, 1, 15)
    assert should_run_reddit(_config(enabled=True, season_active=False)) is True
    assert should_run_reddit(_config(enabled=True, season_active=True)) is True
    assert should_run_reddit(_config(enabled=False)) is False
    assert should_run_reddit(_config(enabled=False), force=True) is True
    action, _ = decide_action(_config(season_active=False), today=today)
    assert action == "skipped_offseason"
    assert compose_run_action("skipped_offseason", True) == "reddit"
    assert compose_run_action("daily", True) == "daily+reddit"
    assert compose_run_action("daily", False) == "daily"
    assert compose_run_action("season", True) == "season+reddit"
    assert compose_run_action("skipped_offseason", False, False) == "skipped_offseason"
    assert compose_run_action("skipped_offseason", True, True) == "contracts+reddit"
    assert compose_run_action("daily", True, True) == "daily+contracts+reddit"
    assert (
        compose_run_action("skipped_offseason", True, True, True) == "contracts+transactions+reddit"
    )
    assert compose_run_action("daily", True, True, True) == "daily+contracts+transactions+reddit"


@pytest.mark.unit
def test_should_run_contracts_ignores_season_active() -> None:
    """Payroll moves in the offseason, so contracts follow ``enabled`` alone."""
    assert should_run_contracts(_config(enabled=True, season_active=False)) is True
    assert should_run_contracts(_config(enabled=True, season_active=True)) is True
    assert should_run_contracts(_config(enabled=False)) is False
    assert should_run_contracts(_config(enabled=False, season_active=True)) is False
    assert should_run_contracts(_config(enabled=False), force=True) is True


@pytest.mark.unit
def test_should_run_transactions_ignores_season_active() -> None:
    """The transactions log is busiest in the offseason."""
    assert should_run_transactions(_config(enabled=True, season_active=False)) is True
    assert should_run_transactions(_config(enabled=True, season_active=True)) is True
    assert should_run_transactions(_config(enabled=False)) is False
    assert should_run_transactions(_config(enabled=False), force=True) is True


@pytest.mark.unit
def test_execute_transactions_reports_transaction_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """rows= counts transactions, not the participant total beside it."""
    monkeypatch.setattr("pipeline.scrape_transactions", lambda: (40, 95))
    alert = SyncAlert("pipeline")
    assert execute_transactions(alert) == (40, 95)
    by_step = {step.step: step for step in alert.steps}
    assert by_step["transactions"].rows == 40
    assert alert.failures == []


@pytest.mark.unit
def test_execute_contracts_reports_combined_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    """Explicit rows= keeps contracts from reporting a bare tuple."""
    monkeypatch.setattr("pipeline.scrape_contracts", lambda: (500, 30))
    alert = SyncAlert("pipeline")
    assert execute_contracts(alert) == (500, 30)
    by_step = {step.step: step for step in alert.steps}
    assert by_step["contracts"].rows == 530
    assert alert.failures == []


@pytest.mark.unit
def test_execute_scrape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("pipeline.scrape_todays_games", lambda: [])
    monkeypatch.setattr("pipeline.scrape_standings", lambda season: 30)
    monkeypatch.setattr("pipeline.scrape_injuries", lambda: 4)
    monkeypatch.setattr("pipeline.scrape_odds", lambda: 0)
    monkeypatch.setattr("pipeline.current_season", lambda: "2025-26")
    pbp_calls: list[object] = []
    monkeypatch.setattr(
        "pipeline.scrape_play_by_play",
        lambda **kwargs: pbp_calls.append(kwargs) or 7,
    )
    count, detail = execute_scrape("daily", _config())
    assert count == 34
    assert "standings: 30" in detail
    assert "injuries: 4" in detail
    assert "odds: 0" in detail
    assert "contracts" not in detail
    assert pbp_calls == []

    monkeypatch.setattr(
        "pipeline.scrape_todays_games", lambda: [{"game_id": "1"}, {"game_id": "2"}]
    )
    monkeypatch.setattr("pipeline.scrape_logs_for_games", lambda games: 10)
    count, detail = execute_scrape("daily", _config())
    assert count == 51
    assert "2 game" in detail
    assert "standings: 30" in detail
    assert "pbp: 7" in detail
    assert pbp_calls == [{"game_ids": ["1", "2"]}]

    monkeypatch.setattr("pipeline.scrape_games", lambda season: 82)
    monkeypatch.setattr("pipeline.scrape_player_game_logs", lambda season, active_only=False: 5)
    count, detail = execute_scrape("season", _config())
    assert count == 117
    assert "2025-26" in detail
    assert "30 standings" in detail

    count, detail = execute_scrape("noop", _config())
    assert count == 0
    assert "noop" in detail


@pytest.mark.unit
def test_execute_scrape_collects_multiple_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "pipeline.scrape_todays_games",
        lambda: (_ for _ in ()).throw(RuntimeError("games down")),
    )
    monkeypatch.setattr(
        "pipeline.scrape_standings",
        lambda season: (_ for _ in ()).throw(ValueError("standings down")),
    )
    monkeypatch.setattr("pipeline.current_season", lambda: "2025-26")
    monkeypatch.setattr("pipeline.scrape_injuries", lambda: 0)
    monkeypatch.setattr("pipeline.scrape_odds", lambda: 0)
    monkeypatch.setattr("pipeline.scrape_contracts", lambda: (0, 0))
    alert = SyncAlert("pipeline")
    with pytest.raises(SyncFailedError, match="2 scrape step"):
        execute_scrape("daily", _config(), alert=alert)
    assert [item.step for item in alert.failures] == ["todays_games", "standings"]
    assert alert.failures[1].season == "2025-26"

    season_alert = SyncAlert("pipeline")
    monkeypatch.setattr(
        "pipeline.scrape_games",
        lambda season: (_ for _ in ()).throw(RuntimeError("g")),
    )
    monkeypatch.setattr(
        "pipeline.scrape_player_game_logs",
        lambda season, active_only=False: (_ for _ in ()).throw(RuntimeError("l")),
    )
    with pytest.raises(SyncFailedError, match="3 scrape step"):
        execute_scrape("season", _config(), alert=season_alert)
    assert [item.step for item in season_alert.failures] == [
        "games",
        "player_game_logs",
        "standings",
    ]


@pytest.mark.unit
def test_daily_records_skipped_sources_rather_than_omitting_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Off-day + unkeyed odds must leave rows, not gaps.

    An absent row reads the same as a source that quietly stopped existing,
    which is the failure this table is meant to make visible.
    """
    monkeypatch.setattr("pipeline.missing_odds_env_names", lambda: ["ODDS_API_KEY"])
    monkeypatch.setattr("pipeline.scrape_todays_games", lambda: [])
    monkeypatch.setattr("pipeline.scrape_standings", lambda season: 30)
    monkeypatch.setattr("pipeline.scrape_injuries", lambda: 12)

    alert = SyncAlert("pipeline")
    execute_scrape("daily", _config(), alert=alert)

    by_step = {step.step: step for step in alert.steps}
    assert by_step["odds"].status == "skipped"
    assert "ODDS_API_KEY" in (by_step["odds"].error_detail or "")
    # Present-but-skipped, not missing entirely.
    assert by_step["player_game_logs"].status == "skipped"
    assert by_step["play_by_play"].status == "skipped"
    assert "No completed games today" in (by_step["play_by_play"].error_detail or "")
    assert "contracts" not in by_step
    assert by_step["todays_games"].rows == 0
    assert alert.failures == []


@pytest.mark.unit
@pytest.mark.parametrize(("dbt_exit", "expected"), [(0, 7), (1, 7)])
def test_record_dbt_only_run_logs_a_standalone_build(
    monkeypatch: pytest.MonkeyPatch, dbt_exit: int, expected: int
) -> None:
    """`make dbt` has no run row to mark, so it opens its own.

    Without this a fixed dbt failure never clears in the admin view: the last
    refresh-daily exit code would be reported indefinitely.
    """
    session = MagicMock()
    session.execute.return_value.scalar_one.return_value = expected
    monkeypatch.setattr("pipeline.get_session", lambda: _session_ctx(session))

    assert record_dbt_only_run(dbt_exit, detail="make dbt") == expected
    session.execute.assert_called_once_with(
        INSERT_DBT_ONLY_RUN,
        {"triggered_by": "dbt", "dbt_exit": dbt_exit, "detail": "make dbt", "failed_nodes": None},
    )
    session.commit.assert_called_once()


@pytest.mark.unit
def test_record_source_runs_writes_one_row_per_step() -> None:
    from datetime import datetime

    from notify import StepOutcome

    started = datetime(2026, 9, 9, 8, 15, 0)
    finished = datetime(2026, 9, 9, 8, 15, 30)
    steps = [
        StepOutcome(
            step="standings",
            status="success",
            started_at=started,
            finished_at=finished,
            rows=30,
            season="2025-26",
        ),
        StepOutcome(
            step="odds",
            status="failed",
            started_at=started,
            finished_at=finished,
            error_type="HTTPError",
            error_detail="429",
        ),
    ]
    session = MagicMock()
    record_source_runs(session, 42, steps)

    assert session.execute.call_count == 2
    first = session.execute.call_args_list[0]
    assert first.args[0] is INSERT_SOURCE_RUN
    assert first.args[1] == {
        "run_id": 42,
        "source_name": "standings",
        "status": "success",
        "expectation": "met",
        "rows_written": 30,
        "season": "2025-26",
        "attempt": 1,
        "error_type": None,
        "error_detail": None,
        "started_at": started,
        "finished_at": finished,
    }
    second = session.execute.call_args_list[1].args[1]
    assert second["source_name"] == "odds"
    assert second["status"] == "failed"
    assert second["error_type"] == "HTTPError"
    assert second["rows_written"] is None
    assert second["expectation"] == "not_checked"


@pytest.mark.unit
@pytest.mark.parametrize(
    ("step", "status", "rows", "expected"),
    [
        ("standings", "success", 30, "met"),
        # Zero rows from a source that always has some: not published yet, or
        # a parser that stopped matching. Only a streak tells which.
        ("injuries", "success", 0, "below"),
        # Zero is a legitimate answer for these, so it is never judged.
        ("todays_games", "success", 0, "not_checked"),
        ("transactions", "success", 0, "not_checked"),
        ("odds", "success", None, "not_checked"),
        ("odds", "failed", None, "not_checked"),
        ("reddit", "skipped", None, "not_checked"),
    ],
)
def test_expectation_for(step: str, status: str, rows: int | None, expected: str) -> None:
    from datetime import datetime

    from notify import StepOutcome
    from pipeline import expectation_for

    now = datetime(2026, 9, 9, 8, 15, 0)
    outcome = StepOutcome(step=step, status=status, started_at=now, finished_at=now, rows=rows)
    assert expectation_for(outcome) == expected


@pytest.mark.unit
def test_record_source_runs_no_steps_is_a_noop() -> None:
    session = MagicMock()
    record_source_runs(session, 42, [])
    session.execute.assert_not_called()


@pytest.mark.unit
def test_run_helpers_execute_sql() -> None:
    session = MagicMock()
    session.execute.return_value.scalar_one.return_value = 42
    assert start_run(session, triggered_by="manual", scrape_action="daily") == 42
    session.execute.assert_called_with(
        INSERT_PIPELINE_RUN,
        {"triggered_by": "manual", "scrape_action": "daily"},
    )

    finish_run(session, 42, status="success", scrape_exit=0, dbt_exit=None, detail="ok")
    session.execute.assert_called_with(
        UPDATE_PIPELINE_RUN,
        {
            "run_id": 42,
            "status": "success",
            "scrape_exit": 0,
            "dbt_exit": None,
            "detail": "ok",
            "reddit_ran": False,
            "reddit_exit": None,
        },
    )

    mark_scrape_success(session, scrape_date=date(2026, 1, 15))
    session.execute.assert_called_with(
        UPDATE_PIPELINE_SUCCESS,
        {"scrape_date": date(2026, 1, 15)},
    )

    mark_scrape_success(session)
    args, kwargs = session.execute.call_args
    assert args[0] is UPDATE_PIPELINE_SUCCESS
    assert "scrape_date" in args[1]


@pytest.mark.unit
def test_run_pipeline_scrape_skipped(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(enabled=False)
    session.execute.return_value.scalar_one.return_value = 7
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "skipped"
    assert result["action"] == "skipped_disabled"
    assert result["run_id"] == 7
    assert result["scrape_exit"] == 0

    session.execute.return_value.one.return_value = _row(scrape_mode="season", target_season=None)
    monkeypatch.setattr("pipeline.execute_reddit", lambda alert=None: 4)
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["action"] == "contracts+transactions+reddit"
    assert result["status"] == "success"
    assert result["reddit_ran"] is True


@pytest.mark.unit
def test_run_pipeline_scrape_success_and_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 9
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_scrape", lambda action, config, alert=None: (3, "ok"))
    monkeypatch.setattr("pipeline.execute_reddit", lambda alert=None: 4)
    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))
    assert result["status"] == "success"
    assert result["action"] == "daily+contracts+transactions+reddit"
    assert "ok" in result["detail"]
    assert "r/nba" in result["detail"]
    assert result["reddit_ran"] is True

    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda action, config, alert=None: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    result = run_pipeline_scrape(force=True, triggered_by="cron", today=date(2026, 1, 15))
    assert result["status"] == "failed"
    assert result["scrape_exit"] == 1
    assert "boom" in result["detail"]


@pytest.mark.unit
def test_run_pipeline_scrape_notifies_once_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 9
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda action, config, alert=None: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    posted: list[object] = []

    def fake_notify(failures, *, sync_name, webhook_url=None, extra_lines=()):
        posted.append((list(failures), sync_name))

    monkeypatch.setattr("notify.notify_sync_failures", fake_notify)
    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))
    assert result["status"] == "failed"
    assert len(posted) == 1
    failures, sync_name = posted[0]
    assert sync_name == "pipeline"
    assert len(failures) == 1
    assert failures[0].error_type == "RuntimeError"


@pytest.mark.unit
def test_run_pipeline_scrape_success_and_skip_do_not_notify(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 9
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: ["REDDIT_CLIENT_ID"])
    monkeypatch.setattr("pipeline.execute_scrape", lambda action, config, alert=None: (3, "ok"))
    posted: list[object] = []
    monkeypatch.setattr("notify.notify_sync_failures", lambda *args, **kwargs: posted.append(1))
    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))
    assert result["status"] == "success"
    assert posted == []

    session.execute.return_value.one.return_value = _row(enabled=False)
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "skipped"
    assert posted == []


@pytest.mark.unit
def test_update_run_dbt_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    update_run_dbt_exit(3, 1, detail="dbt failed", failed_nodes=["model fct_x"])
    session.execute.assert_called_once_with(
        UPDATE_PIPELINE_RUN_DBT_EXIT,
        {"run_id": 3, "dbt_exit": 1, "detail": "dbt failed", "failed_nodes": ["model fct_x"]},
    )


@pytest.mark.unit
def test_execute_reddit_uses_r_nba_day_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_reddit(**kwargs):
        seen.update(kwargs)
        return 9

    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: [])
    monkeypatch.setattr("pipeline.scrape_reddit", fake_reddit)
    assert execute_reddit() == 9
    assert seen["subreddit"] == DAILY_REDDIT_SUBREDDIT == "nba"
    assert seen["limit"] == DAILY_REDDIT_LIMIT
    assert seen["time_filter"] == DAILY_REDDIT_TIME_FILTER
    assert seen["comments_per_post"] == DAILY_REDDIT_COMMENTS_PER_POST == 250


@pytest.mark.unit
def test_execute_reddit_skips_without_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    called = []
    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: ["REDDIT_CLIENT_ID"])
    monkeypatch.setattr("pipeline.scrape_reddit", lambda **kwargs: called.append(1) or 9)
    assert execute_reddit() == 0
    assert called == []


@pytest.mark.unit
def test_run_pipeline_reddit_on_season_off(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(
        season_active=False,
        season_start=None,
        season_end=None,
    )
    session.execute.return_value.scalar_one.return_value = 11
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    executed: list[str] = []
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda *args, **kwargs: executed.append("nba") or (0, "nba"),
    )
    monkeypatch.setattr(
        "pipeline.execute_reddit", lambda alert=None: executed.append("reddit") or 4
    )
    # This test is the one proving contracts run with the season gate shut, so
    # its stub records the call instead of silently succeeding.
    monkeypatch.setattr(
        "pipeline.execute_contracts",
        lambda alert=None: executed.append("contracts") or (5, 1),
    )
    monkeypatch.setattr(
        "pipeline.execute_transactions",
        lambda alert=None: executed.append("transactions") or (9, 20),
    )
    result = run_pipeline_scrape(today=date(2026, 8, 1))
    assert result["status"] == "success"
    assert result["action"] == "contracts+transactions+reddit"
    assert result["reddit_ran"] is True
    assert result["reddit_exit"] == 0
    assert executed == ["contracts", "transactions", "reddit"]
    assert "r/nba" in result["detail"]


@pytest.mark.unit
def test_run_pipeline_season_on_always_reddits(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 12
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    executed: list[str] = []
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda *args, **kwargs: executed.append("nba") or (3, "ok"),
    )
    monkeypatch.setattr(
        "pipeline.execute_reddit",
        lambda alert=None: executed.append("reddit") or 1,
    )
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "success"
    assert result["action"] == "daily+contracts+transactions+reddit"
    assert result["reddit_ran"] is True
    assert executed == ["nba", "reddit"]


@pytest.mark.unit
def test_run_pipeline_both_on(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 13
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    executed: list[str] = []
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda *args, **kwargs: executed.append("nba") or (3, "ok"),
    )
    monkeypatch.setattr(
        "pipeline.execute_reddit", lambda alert=None: executed.append("reddit") or 2
    )
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "success"
    assert result["action"] == "daily+contracts+transactions+reddit"
    assert result["reddit_ran"] is True
    assert result["reddit_exit"] == 0
    assert executed == ["nba", "reddit"]


@pytest.mark.unit
def test_run_pipeline_disabled_skips_reddit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(
        enabled=False,
        season_active=False,
    )
    session.execute.return_value.scalar_one.return_value = 14
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    executed: list[str] = []
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda *args, **kwargs: executed.append("nba") or (0, "x"),
    )
    monkeypatch.setattr(
        "pipeline.execute_reddit", lambda alert=None: executed.append("reddit") or 1
    )
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "skipped"
    assert result["action"] == "skipped_disabled"
    assert executed == []

    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))
    assert result["status"] == "success"
    assert result["action"] == "daily+contracts+transactions+reddit"
    assert executed == ["nba", "reddit"]


@pytest.mark.unit
def test_run_pipeline_force_also_runs_reddit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(
        enabled=False,
        season_active=False,
    )
    session.execute.return_value.scalar_one.return_value = 15
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    executed: list[str] = []
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda *args, **kwargs: executed.append("nba") or (1, "forced"),
    )
    monkeypatch.setattr(
        "pipeline.execute_reddit", lambda alert=None: executed.append("reddit") or 1
    )
    result = run_pipeline_scrape(force=True, today=date(2026, 8, 1))
    assert result["status"] == "success"
    assert result["action"] == "daily+contracts+transactions+reddit"
    assert result["reddit_ran"] is True
    assert executed == ["nba", "reddit"]


@pytest.mark.unit
def test_run_pipeline_reddit_failure_records_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row(
        season_active=False,
        season_start=None,
        season_end=None,
    )
    session.execute.return_value.scalar_one.return_value = 16
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_scrape", lambda *args, **kwargs: (0, "nba"))
    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: [])
    monkeypatch.setattr(
        "pipeline.scrape_reddit", lambda **kwargs: (_ for _ in ()).throw(RuntimeError("praw"))
    )
    posted: list[object] = []
    monkeypatch.setattr("notify.notify_sync_failures", lambda *args, **kwargs: posted.append(1))
    result = run_pipeline_scrape(today=date(2026, 8, 1))
    assert result["status"] == "failed"
    assert result["scrape_exit"] == 1
    assert result["reddit_ran"] is True
    assert result["reddit_exit"] == 1
    assert len(posted) == 1


@pytest.mark.unit
def test_run_pipeline_nba_failure_still_runs_reddit(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 17
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))

    def fake_nba(action, config, alert=None):
        if alert is not None:
            alert.record("todays_games", RuntimeError("down"))
            raise SyncFailedError(alert.failures)
        raise RuntimeError("down")

    executed: list[str] = []
    monkeypatch.setattr("pipeline.execute_scrape", fake_nba)
    monkeypatch.setattr(
        "pipeline.execute_reddit", lambda alert=None: executed.append("reddit") or 2
    )
    posted: list[object] = []
    monkeypatch.setattr("notify.notify_sync_failures", lambda *args, **kwargs: posted.append(1))
    result = run_pipeline_scrape(today=date(2026, 1, 15))
    assert result["status"] == "failed"
    assert executed == ["reddit"]
    assert result["reddit_ran"] is True
    assert result["reddit_exit"] == 0
    assert len(posted) == 1


def _streak_row(**overrides):
    row = {
        "source_name": "injuries",
        "streak": 3,
        "failed_runs": 0,
        "below_runs": 3,
        "latest_error_type": None,
        "latest_error_detail": None,
    }
    row.update(overrides)
    return row


@pytest.mark.unit
def test_find_unhealthy_streaks_maps_rows() -> None:
    from pipeline import find_unhealthy_streaks

    from queries import SELECT_UNHEALTHY_SOURCE_STREAKS

    session = MagicMock()
    session.execute.return_value.mappings.return_value = [
        _streak_row(),
        _streak_row(source_name="odds", failed_runs=2, below_runs=1, latest_error_type="HTTPError"),
    ]
    streaks = find_unhealthy_streaks(session, 7, threshold=3)
    session.execute.assert_called_once_with(
        SELECT_UNHEALTHY_SOURCE_STREAKS, {"run_id": 7, "threshold": 3}
    )
    assert [item.source_name for item in streaks] == ["injuries", "odds"]
    assert streaks[1].failed_runs == 2
    assert streaks[1].latest_error_type == "HTTPError"


def _pipeline_session_with_streaks(streak_rows):
    session = MagicMock()
    session.execute.return_value.one.return_value = _row()
    session.execute.return_value.scalar_one.return_value = 9
    session.execute.return_value.mappings.return_value = streak_rows
    return session


@pytest.mark.unit
def test_successful_scrape_with_a_streak_posts_one_degraded_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _pipeline_session_with_streaks([_streak_row()])
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: ["REDDIT_CLIENT_ID"])
    monkeypatch.setattr("pipeline.execute_scrape", lambda action, config, alert=None: (3, "ok"))
    failure_posts: list[object] = []
    monkeypatch.setattr("notify.notify_sync_failures", lambda *a, **k: failure_posts.append(1))
    texts: list[str] = []
    monkeypatch.setattr("pipeline.post_webhook_text", lambda text: texts.append(text))

    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))

    assert result["status"] == "success"
    assert failure_posts == []
    assert len(texts) == 1
    assert texts[0].startswith("NBA scrape degraded: pipeline")
    assert "injuries: 3 runs in a row returned no rows" in texts[0]


@pytest.mark.unit
def test_failed_scrape_folds_streaks_into_its_single_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _pipeline_session_with_streaks(
        [_streak_row(source_name="standings", failed_runs=3, below_runs=0)]
    )
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr(
        "pipeline.execute_scrape",
        lambda action, config, alert=None: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    posted: list[tuple] = []

    def fake_notify(failures, *, sync_name, webhook_url=None, extra_lines=()):
        posted.append((sync_name, list(extra_lines)))

    monkeypatch.setattr("notify.notify_sync_failures", fake_notify)
    texts: list[str] = []
    monkeypatch.setattr("pipeline.post_webhook_text", lambda text: texts.append(text))

    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))

    assert result["status"] == "failed"
    assert texts == [], "a failed sync must not also post a separate degraded alert"
    assert len(posted) == 1
    sync_name, extra = posted[0]
    assert sync_name == "pipeline"
    assert extra and extra[0].startswith("- standings: unhealthy 3 runs in a row")


@pytest.mark.unit
def test_streak_lookup_failure_does_not_fail_the_scrape(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _pipeline_session_with_streaks([])
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    monkeypatch.setattr("pipeline.execute_contracts", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.execute_transactions", lambda alert=None: (0, 0))
    monkeypatch.setattr("pipeline.missing_reddit_env_names", lambda: ["REDDIT_CLIENT_ID"])
    monkeypatch.setattr("pipeline.execute_scrape", lambda action, config, alert=None: (3, "ok"))

    def broken_lookup(*args, **kwargs):
        raise RuntimeError("db went away")

    monkeypatch.setattr("pipeline.find_unhealthy_streaks", broken_lookup)
    texts: list[str] = []
    monkeypatch.setattr("pipeline.post_webhook_text", lambda text: texts.append(text))

    result = run_pipeline_scrape(force=True, today=date(2026, 1, 15))

    assert result["status"] == "success"
    assert texts == []


@pytest.mark.unit
def test_update_run_ml_exit(monkeypatch: pytest.MonkeyPatch) -> None:
    from pipeline import update_run_ml_exit

    from queries import UPDATE_PIPELINE_RUN_ML_EXIT

    session = MagicMock()
    monkeypatch.setattr("pipeline.get_session", lambda: _session(session))
    update_run_ml_exit(3, 1, detail="ml score finished with exit 1")
    session.execute.assert_called_once_with(
        UPDATE_PIPELINE_RUN_ML_EXIT,
        {"run_id": 3, "ml_exit": 1, "detail": "ml score finished with exit 1"},
    )
