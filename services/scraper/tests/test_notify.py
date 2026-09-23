from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from click.testing import CliRunner
from notify import (
    StepFailure,
    SyncAlert,
    SyncFailedError,
    format_sync_failure_text,
    infer_rows,
    notify_sync_failures,
)

from main import cli


def _failure(
    step: str = "games",
    error_type: str = "RuntimeError",
    message: str = "boom",
    season: str | None = "2024-25",
) -> StepFailure:
    return StepFailure(step=step, error_type=error_type, message=message, season=season)


def _response(status_code: int = 200) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    return response


@pytest.mark.unit
def test_unset_url_sends_no_request(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[object] = []
    monkeypatch.setattr("notify.settings", SimpleNamespace(slack_webhook_url=None))
    monkeypatch.setattr(
        "notify.requests.post", lambda *args, **kwargs: posted.append((args, kwargs))
    )
    notify_sync_failures([_failure()], sync_name="scrape-all")
    assert posted == []

    notify_sync_failures([_failure()], sync_name="scrape-all", webhook_url="")
    notify_sync_failures([_failure()], sync_name="scrape-all", webhook_url="   ")
    assert posted == []


@pytest.mark.unit
def test_three_step_failures_post_exactly_once(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[tuple[tuple, dict]] = []

    def fake_post(*args, **kwargs):
        posted.append((args, kwargs))
        return _response()

    monkeypatch.setattr("notify.requests.post", fake_post)
    failures = [
        _failure("games", "RuntimeError", "timeout", "2024-25"),
        _failure("player_game_logs", "HTTPError", "503", "2024-25"),
        _failure("standings", "ValueError", "empty payload", "2023-24"),
    ]
    notify_sync_failures(failures, sync_name="scrape-all", webhook_url="https://hooks.slack.test/x")
    assert len(posted) == 1
    args, kwargs = posted[0]
    assert args[0] == "https://hooks.slack.test/x"
    assert kwargs["timeout"] == 8
    text = kwargs["json"]["text"]
    assert "scrape-all (3 step(s))" in text
    assert "games (2024-25): RuntimeError: timeout" in text
    assert "player_game_logs (2024-25): HTTPError: 503" in text
    assert "standings (2023-24): ValueError: empty payload" in text


@pytest.mark.unit
def test_all_steps_ok_sends_no_request(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[object] = []
    monkeypatch.setattr("notify.requests.post", lambda *args, **kwargs: posted.append(1))
    notify_sync_failures([], sync_name="scrape-all", webhook_url="https://hooks.slack.test/x")
    SyncAlert("scrape-daily").notify(webhook_url="https://hooks.slack.test/x")
    assert posted == []


@pytest.mark.unit
def test_webhook_http_error_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("notify.requests.post", lambda *args, **kwargs: _response(500))
    notify_sync_failures(
        [_failure()], sync_name="pipeline", webhook_url="https://hooks.slack.test/x"
    )


@pytest.mark.unit
def test_webhook_transport_error_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args, **kwargs):
        raise TimeoutError("slack down")

    monkeypatch.setattr("notify.requests.post", boom)
    notify_sync_failures(
        [_failure()], sync_name="pipeline", webhook_url="https://hooks.slack.test/x"
    )


@pytest.mark.unit
def test_error_message_strips_html_and_truncates() -> None:
    html = StepFailure.from_exception(
        "contracts",
        RuntimeError("<html><body>" + "x" * 400 + "</body></html>"),
        season=None,
    )
    assert "<html>" not in html.message
    assert "<body>" not in html.message
    assert len(html.message) <= 200
    assert html.message.endswith("...")
    assert "\n" not in html.message


@pytest.mark.unit
def test_format_caps_listed_failures() -> None:
    failures = [_failure(step=f"step-{i}", season=None) for i in range(16)]
    text = format_sync_failure_text("scrape-all", failures)
    assert "16 step(s)" in text
    assert "...and 1 more" in text


@pytest.mark.unit
def test_sync_alert_try_run_records_and_continues() -> None:
    alert = SyncAlert("scrape-all")
    assert alert.try_run("teams", lambda: 30) == 30
    assert (
        alert.try_run(
            "games", lambda: (_ for _ in ()).throw(RuntimeError("nope")), season="2024-25"
        )
        is None
    )
    assert alert.try_run("standings", lambda: 15, season="2024-25") == 15
    assert len(alert.failures) == 1
    assert alert.failures[0].step == "games"
    assert alert.failures[0].error_type == "RuntimeError"
    assert alert.failures[0].season == "2024-25"
    with pytest.raises(SyncFailedError, match="1 scrape step"):
        alert.raise_if_failed()


@pytest.mark.unit
def test_try_run_records_a_step_outcome_per_source() -> None:
    alert = SyncAlert("pipeline")
    alert.try_run("standings", lambda: 30, season="2025-26")
    alert.try_run("odds", lambda: (_ for _ in ()).throw(RuntimeError("429 slow down")))
    alert.record_skipped("reddit", reason="REDDIT_* unset; no HTTP attempted")

    assert [(step.step, step.status) for step in alert.steps] == [
        ("standings", "success"),
        ("odds", "failed"),
        ("reddit", "skipped"),
    ]

    standings, odds, reddit = alert.steps
    assert standings.rows == 30
    assert standings.season == "2025-26"
    assert standings.error_type is None
    assert standings.finished_at >= standings.started_at

    # A failed step still needs its own row, with the error attributed to it.
    assert odds.error_type == "RuntimeError"
    assert "429" in (odds.error_detail or "")
    assert odds.rows is None

    # Skipped is deliberately distinct from success-with-zero-rows: it is what
    # makes "odds have not run for a week" visible instead of looking healthy.
    assert reddit.rows is None
    assert "REDDIT_*" in (reddit.error_detail or "")


@pytest.mark.unit
def test_try_run_rows_override_beats_inference() -> None:
    alert = SyncAlert("pipeline")
    alert.try_run("todays_games", lambda: [{"game_id": "a"}, {"game_id": "b"}])
    alert.try_run("contracts", lambda: (500, 30), rows=lambda result: result[0])
    assert [step.rows for step in alert.steps] == [2, 500]


@pytest.mark.unit
@pytest.mark.parametrize(
    ("result", "expected"),
    [
        (30, 30),
        (0, 0),
        ((500, 30), 530),
        ([{"a": 1}, {"a": 2}], 2),
        ([], 0),
        (None, None),
        (True, None),
        ("rows", None),
    ],
)
def test_infer_rows(result: object, expected: int | None) -> None:
    assert infer_rows(result) == expected


@pytest.mark.unit
def test_scrape_all_three_failures_one_post(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[object] = []

    def fake_post(*args, **kwargs):
        posted.append(kwargs["json"]["text"])
        return _response()

    monkeypatch.setattr("notify.requests.post", fake_post)
    monkeypatch.setattr(
        "main.scrape_teams", lambda: (_ for _ in ()).throw(RuntimeError("teams down"))
    )
    monkeypatch.setattr(
        "main.scrape_players",
        lambda enrich=False: (_ for _ in ()).throw(ValueError("players down")),
    )
    monkeypatch.setattr(
        "main.scrape_contracts",
        lambda: (_ for _ in ()).throw(RuntimeError("contracts down")),
    )
    monkeypatch.setattr("main.scrape_games", lambda season: 82)
    monkeypatch.setattr("main.scrape_player_game_logs", lambda season, active_only=False: 5)
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    monkeypatch.setattr("main.scrape_transactions", lambda season: (9, 20))
    monkeypatch.setattr(
        "notify.settings", SimpleNamespace(slack_webhook_url="https://hooks.slack.test/x")
    )
    result = CliRunner().invoke(cli, ["scrape-all", "--seasons", "2024-25"])
    assert result.exit_code == 1
    assert len(posted) == 1
    assert "3 step(s)" in posted[0]
    assert "teams: RuntimeError: teams down" in posted[0]
    assert "players: ValueError: players down" in posted[0]
    assert "contracts: RuntimeError: contracts down" in posted[0]


@pytest.mark.unit
def test_scrape_all_with_reddit_still_one_alert(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("main.scrape_teams", lambda: 30)
    monkeypatch.setattr("main.scrape_players", lambda enrich=False: 10)
    monkeypatch.setattr("main.scrape_contracts", lambda: (8, 2))
    monkeypatch.setattr("main.scrape_games", lambda season: 82)
    monkeypatch.setattr("main.scrape_player_game_logs", lambda season, active_only=False: 5)
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    monkeypatch.setattr("main.scrape_transactions", lambda season: (9, 20))
    monkeypatch.setattr("main.scrape_reddit", lambda: 12)
    monkeypatch.setattr("main.stamp_cli_success", lambda: None)
    posted: list[object] = []
    monkeypatch.setattr("notify.requests.post", lambda *args, **kwargs: posted.append(1))
    monkeypatch.setattr(
        "notify.settings", SimpleNamespace(slack_webhook_url="https://hooks.slack.test/x")
    )
    result = CliRunner().invoke(cli, ["scrape-all", "--seasons", "2024-25", "--with-reddit"])
    assert result.exit_code == 0
    assert "Reddit posts: 12" in result.output
    assert posted == []


@pytest.mark.unit
def test_scrape_daily_success_sends_no_post(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[object] = []
    monkeypatch.setattr("notify.requests.post", lambda *args, **kwargs: posted.append(1))
    monkeypatch.setattr(
        "notify.settings", SimpleNamespace(slack_webhook_url="https://hooks.slack.test/x")
    )
    monkeypatch.setattr("main.scrape_todays_games", lambda: [])
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    monkeypatch.setattr("main.scrape_transactions", lambda season: (9, 20))
    monkeypatch.setattr("main.scrape_injuries", lambda: 0)
    monkeypatch.setattr("main.scrape_odds", lambda: 0)
    monkeypatch.setattr("main.scrape_contracts", lambda: (8, 2))
    monkeypatch.setattr("main.stamp_cli_success", lambda: None)
    result = CliRunner().invoke(cli, ["scrape-daily"])
    assert result.exit_code == 0
    assert posted == []


@pytest.mark.unit
def test_scrape_daily_webhook_500_still_exits_nonzero(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[object] = []

    def fake_post(*args, **kwargs):
        posted.append(1)
        return _response(500)

    monkeypatch.setattr("notify.requests.post", fake_post)
    monkeypatch.setattr(
        "notify.settings", SimpleNamespace(slack_webhook_url="https://hooks.slack.test/x")
    )
    monkeypatch.setattr(
        "main.scrape_todays_games",
        lambda: (_ for _ in ()).throw(RuntimeError("nba timeout")),
    )
    monkeypatch.setattr(
        "main.scrape_standings",
        lambda season: (_ for _ in ()).throw(RuntimeError("standings 503")),
    )
    monkeypatch.setattr("main.scrape_injuries", lambda: 0)
    monkeypatch.setattr("main.scrape_odds", lambda: 0)
    monkeypatch.setattr("main.scrape_contracts", lambda: (0, 0))
    result = CliRunner().invoke(cli, ["scrape-daily"])
    assert result.exit_code == 1
    assert len(posted) == 1


@pytest.mark.unit
def test_post_webhook_text_swallows_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    from notify import post_webhook_text

    monkeypatch.setattr("notify.requests.post", lambda *args, **kwargs: _response(500))
    post_webhook_text("hello", webhook_url="https://hooks.slack.test/x")

    def boom(*args, **kwargs):
        raise OSError("network down")

    monkeypatch.setattr("notify.requests.post", boom)
    post_webhook_text("hello", webhook_url="https://hooks.slack.test/x")


@pytest.mark.unit
def test_failure_alert_appends_extra_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    posted: list[dict] = []
    monkeypatch.setattr(
        "notify.requests.post",
        lambda url, json, timeout: posted.append(json) or _response(),
    )
    notify_sync_failures(
        [_failure()],
        sync_name="pipeline",
        webhook_url="https://hooks.slack.test/x",
        extra_lines=["- odds: unhealthy 3 runs in a row; latest HTTPError"],
    )
    assert len(posted) == 1
    assert posted[0]["text"].endswith("- odds: unhealthy 3 runs in a row; latest HTTPError")


@pytest.mark.unit
def test_streak_lines_separate_empty_from_erroring() -> None:
    from notify import SourceStreak, format_degraded_text, format_streak_lines

    empty = SourceStreak(source_name="injuries", streak=3, failed_runs=0, below_runs=3)
    erroring = SourceStreak(
        source_name="odds",
        streak=4,
        failed_runs=3,
        below_runs=1,
        latest_error_type="HTTPError",
        latest_error_detail="401 Unauthorized",
    )
    bare = SourceStreak(source_name="standings", streak=3, failed_runs=3, below_runs=0)
    lines = format_streak_lines([empty, erroring, bare])
    assert "returned no rows" in lines[0]
    assert "check the parser" in lines[0]
    assert lines[1] == "- odds: unhealthy 4 runs in a row; latest HTTPError: 401 Unauthorized"
    assert lines[2] == "- standings: unhealthy 3 runs in a row; latest error"

    text = format_degraded_text("pipeline", [empty])
    assert text.splitlines()[0] == (
        "NBA scrape degraded: pipeline succeeded but 1 source(s) keep failing"
    )


@pytest.mark.unit
def test_stage_failure_text() -> None:
    from notify import format_stage_failure_text

    assert format_stage_failure_text("ml", 2) == "NBA refresh failed: ml exited 2"
    assert format_stage_failure_text("dbt build", 1, run_id=9, detail="dbt finished") == (
        "NBA refresh failed: dbt build exited 1 (run_id=9)\n- dbt finished"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("command", "exit_flag", "recorder"),
    [
        ("mark-dbt", "--dbt-exit", "main.update_run_dbt_exit"),
        ("mark-ml", "--ml-exit", "main.update_run_ml_exit"),
    ],
)
def test_mark_stage_notifies_only_on_failure_with_flag(
    monkeypatch: pytest.MonkeyPatch, command: str, exit_flag: str, recorder: str
) -> None:
    recorded: list[tuple] = []
    texts: list[str] = []
    monkeypatch.setattr(recorder, lambda run_id, code, detail=None: recorded.append((run_id, code)))
    monkeypatch.setattr("main.post_webhook_text", lambda text: texts.append(text))
    runner = CliRunner()

    ok = runner.invoke(cli, ["pipeline", command, "--run-id", "5", exit_flag, "0", "--notify"])
    assert ok.exit_code == 0, ok.output
    assert texts == []

    quiet = runner.invoke(cli, ["pipeline", command, "--run-id", "5", exit_flag, "1"])
    assert quiet.exit_code == 0, quiet.output
    assert texts == [], "without --notify a failure is recorded but not posted"

    loud = runner.invoke(
        cli, ["pipeline", command, "--run-id", "5", exit_flag, "1", "--notify", "--detail", "x"]
    )
    assert loud.exit_code == 0, loud.output
    assert len(texts) == 1
    assert "(run_id=5)" in texts[0]
    assert recorded == [(5, 0), (5, 1), (5, 1)]


@pytest.mark.unit
def test_mark_stage_alerts_even_when_recording_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    texts: list[str] = []

    def broken(*args, **kwargs):
        raise RuntimeError("postgres down")

    monkeypatch.setattr("main.update_run_ml_exit", broken)
    monkeypatch.setattr("main.post_webhook_text", lambda text: texts.append(text))
    result = CliRunner().invoke(
        cli, ["pipeline", "mark-ml", "--run-id", "5", "--ml-exit", "1", "--notify"]
    )
    assert result.exit_code != 0
    assert len(texts) == 1
