"""Operational gate for scrape → dbt refresh.

Reads the singleton row in ``source.scrape_pipeline`` to decide whether a
run should scrape NBA daily, scrape r/nba, no-op (off-season / no flags),
or skip (disabled). Default is safe: enabled=false until an operator
enables the pipeline.

BRef / odds daily follows ``enabled`` + ``season_active`` (and
the season window when set): schedule, Finals logs, those games' PBP,
standings, injuries, odds-if-keyed.

Reddit, contracts, and transactions run whenever the pipeline is
enabled (or ``--force``), not behind ``season_active``. Contracts and
transactions sit here because roster and payroll movement peaks in the
offseason — free agency, trades, extensions all land while the season
gate is shut. Missing ``REDDIT_*`` skips HTTP like odds.

Source DDL is owned by Alembic (``make db-migrate``); this module does
not CREATE TABLES.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Literal

from notify import (
    SourceStreak,
    StepOutcome,
    SyncAlert,
    SyncFailedError,
    format_degraded_text,
    format_streak_lines,
    post_webhook_text,
)
from sqlalchemy.orm import Session

from config import missing_odds_env_names, missing_reddit_env_names, settings
from db import get_session
from queries.pipeline_runs import (
    INSERT_DBT_ONLY_RUN,
    INSERT_PIPELINE_RUN,
    UPDATE_PIPELINE_RUN,
    UPDATE_PIPELINE_RUN_DBT_EXIT,
    UPDATE_PIPELINE_RUN_ML_EXIT,
)
from queries.scrape_pipeline import (
    SELECT_PIPELINE_CONFIG,
    UPDATE_PIPELINE_ENABLED,
    UPDATE_PIPELINE_SUCCESS,
)
from queries.scrape_source_runs import INSERT_SOURCE_RUN, SELECT_UNHEALTHY_SOURCE_STREAKS
from scrapers import current_season
from scrapers.contracts import scrape_contracts
from scrapers.games import scrape_games, scrape_todays_games
from scrapers.injuries import scrape_injuries
from scrapers.odds import scrape_odds
from scrapers.play_by_play import scrape_play_by_play
from scrapers.player_game_logs import scrape_logs_for_games, scrape_player_game_logs
from scrapers.reddit import DEFAULT_SUBREDDIT, scrape_reddit
from scrapers.standings import scrape_standings
from scrapers.transactions import scrape_transactions

ScrapeAction = Literal[
    "daily",
    "season",
    "reddit",
    "noop",
    "skipped_disabled",
    "skipped_offseason",
    "skipped_mode_none",
]

# Daily r/nba pull: hot + top for the day, plus top-N comments per post.
# Request cost is ~1 per 100 listing items plus 1 per unique post (its comment
# page); comments are picked from that already-loaded page (PRAW asks for
# comment_limit=2048, Reddit returns a few hundred), so raising
# COMMENTS_PER_POST costs no requests until it exceeds what one page holds.
# Posts with fewer comments just yield fewer. ~200 requests a day against Reddit's
# 100/min OAuth quota, which prawcore enforces by sleeping on the rate headers.
DAILY_REDDIT_SUBREDDIT = DEFAULT_SUBREDDIT
DAILY_REDDIT_LIMIT = 100
DAILY_REDDIT_TIME_FILTER = "day"
DAILY_REDDIT_COMMENTS_PER_POST = 250

logger = logging.getLogger(__name__)

_NBA_RUN_ACTIONS = frozenset({"daily", "season"})


@dataclass(frozen=True)
class PipelineConfig:
    enabled: bool
    season_active: bool
    season_start: date | None
    season_end: date | None
    scrape_mode: str
    target_season: str | None
    last_success_at: datetime | None
    last_scrape_date: date | None
    reason: str | None
    updated_at: datetime | None

    @classmethod
    def from_row(cls, row: Any) -> PipelineConfig:
        return cls(
            enabled=bool(row.enabled),
            season_active=bool(row.season_active),
            season_start=row.season_start,
            season_end=row.season_end,
            scrape_mode=str(row.scrape_mode or "daily"),
            target_season=row.target_season,
            last_success_at=row.last_success_at,
            last_scrape_date=row.last_scrape_date,
            reason=row.reason,
            updated_at=row.updated_at,
        )


def load_config(session: Session) -> PipelineConfig:
    row = session.execute(SELECT_PIPELINE_CONFIG).one()
    return PipelineConfig.from_row(row)


def set_enabled(
    session: Session,
    *,
    enabled: bool,
    reason: str | None = None,
    season_active: bool | None = None,
    season_start: date | None = None,
    season_end: date | None = None,
    scrape_mode: str | None = None,
    target_season: str | None = None,
) -> PipelineConfig:
    session.execute(
        UPDATE_PIPELINE_ENABLED,
        {
            "enabled": enabled,
            "season_active": season_active,
            "season_start": season_start,
            "season_end": season_end,
            "scrape_mode": scrape_mode,
            "target_season": target_season,
            "reason": reason,
        },
    )
    return load_config(session)


def in_season_window(config: PipelineConfig, today: date | None = None) -> bool:
    """True when scraping is in-season.

    Prefer explicit ``season_active``. If season_start/end are set, also
    require ``today`` to fall inside that inclusive window.
    """
    day = today or date.today()
    if not config.season_active:
        return False
    if config.season_start and day < config.season_start:
        return False
    return not (config.season_end and day > config.season_end)


def decide_action(
    config: PipelineConfig,
    *,
    force: bool = False,
    today: date | None = None,
) -> tuple[ScrapeAction, str]:
    """Return the NBA scrape action (reddit is decided separately).

    ``--force`` bypasses ``enabled`` and the season window so a manual test
    can run the basketball daily. It does not change ``scrape_mode=none``.
    """
    if not force and not config.enabled:
        return (
            "skipped_disabled",
            "Pipeline disabled in source.scrape_pipeline (enable to run on schedule).",
        )

    if not force and not in_season_window(config, today=today):
        return (
            "skipped_offseason",
            "Season inactive or outside season_start/season_end window.",
        )

    mode = (config.scrape_mode or "daily").lower()
    if mode == "none":
        return ("skipped_mode_none", "scrape_mode=none; nothing to scrape.")
    if mode == "season":
        if not config.target_season:
            return ("noop", "scrape_mode=season but target_season is unset.")
        return ("season", f"Scrape season {config.target_season}.")
    return (
        "daily",
        "Scrape today's slate (Final + upcoming), logs, PBP for those Finals, standings, injuries, contracts, odds.",
    )


def should_run_contracts(config: PipelineConfig, *, force: bool = False) -> bool:
    """Contracts and payroll follow ``enabled`` alone, like reddit.

    Deliberately not behind ``season_active``: free agency, trades, and
    extensions all move payroll while the season gate is shut, so gating
    them on the season staled the data exactly when it changed fastest.
    """
    return bool(force or config.enabled)


def should_run_transactions(config: PipelineConfig, *, force: bool = False) -> bool:
    """Transactions follow ``enabled`` alone, like contracts and reddit.

    The transactions log is busiest in the offseason, so gating it on
    ``season_active`` would skip exactly the window it matters most in.
    """
    return bool(force or config.enabled)


def should_run_reddit(config: PipelineConfig, *, force: bool = False) -> bool:
    """Everyday r/nba when the pipeline is allowed to run.

    Requires ``enabled`` unless ``--force``. Not gated by ``season_active``.
    Missing ``REDDIT_*`` skips HTTP inside ``execute_reddit`` (like odds).
    """
    return bool(force or config.enabled)


def compose_run_action(
    nba_action: ScrapeAction,
    run_reddit: bool,
    run_contracts: bool = False,
    run_transactions: bool = False,
) -> str:
    parts: list[str] = []
    if nba_action in _NBA_RUN_ACTIONS:
        parts.append(nba_action)
    if run_contracts:
        parts.append("contracts")
    if run_transactions:
        parts.append("transactions")
    if run_reddit:
        parts.append("reddit")
    return "+".join(parts) if parts else nba_action


def _final_game_ids(games: list[dict]) -> list[str]:
    return [str(game["game_id"]) for game in games if game.get("game_id")]


def execute_scrape(
    action: ScrapeAction,
    config: PipelineConfig,
    *,
    alert: SyncAlert | None = None,
) -> tuple[int, str]:
    """Run the scrape implied by ``action``. Returns (rows_or_games, detail)."""
    collector = alert if alert is not None else SyncAlert(action)
    if action == "daily":
        games = collector.try_run("todays_games", scrape_todays_games, rows=len)
        daily_season = current_season()
        n_standings = collector.try_run(
            "standings",
            lambda: scrape_standings(daily_season),
            season=daily_season,
        )
        n_injuries = collector.try_run("injuries", scrape_injuries)
        # scrape_odds returns 0 when unkeyed, which would otherwise record a
        # healthy-looking success and hide "odds have not run for a week".
        if missing_odds_env_names():
            collector.record_skipped("odds", reason="ODDS_API_KEY unset; no HTTP attempted")
            n_odds = 0
        else:
            n_odds = collector.try_run("odds", scrape_odds)
        standings_count = 0 if n_standings is None else n_standings
        injuries_count = 0 if n_injuries is None else n_injuries
        odds_count = 0 if n_odds is None else n_odds
        snapshot_count = standings_count + injuries_count + odds_count
        extra = f"standings: {standings_count}; injuries: {injuries_count}; odds: {odds_count}."
        if not games:
            # Record the game-dependent steps rather than omitting them: an
            # absent row is indistinguishable from a step that silently stopped
            # existing, and off-days are the common case.
            for game_step in ("player_game_logs", "play_by_play"):
                collector.record_skipped(game_step, reason="No completed games today")
            collector.raise_if_failed()
            return (
                snapshot_count,
                f"No completed games today; {extra}",
            )
        game_ids = _final_game_ids(games)
        count = collector.try_run("player_game_logs", lambda: scrape_logs_for_games(games))
        n_pbp = collector.try_run(
            "play_by_play",
            lambda: scrape_play_by_play(game_ids=game_ids),
        )
        log_count = 0 if count is None else count
        pbp_count = 0 if n_pbp is None else n_pbp
        collector.raise_if_failed()
        return (
            log_count + snapshot_count + pbp_count,
            f"Upserted logs for {len(games)} game(s); {log_count} player log rows; "
            f"pbp: {pbp_count}; {extra}",
        )
    if action == "season":
        season = config.target_season
        assert season is not None
        n_games = collector.try_run("games", lambda: scrape_games(season), season=season)
        n_logs = collector.try_run(
            "player_game_logs",
            lambda: scrape_player_game_logs(season, active_only=False),
            season=season,
        )
        n_standings = collector.try_run(
            "standings",
            lambda: scrape_standings(season),
            season=season,
        )
        games_count = 0 if n_games is None else n_games
        log_count = 0 if n_logs is None else n_logs
        standings_count = 0 if n_standings is None else n_standings
        collector.raise_if_failed()
        return (
            games_count + log_count + standings_count,
            f"Season {season}: {games_count} games, {log_count} log rows, "
            f"{standings_count} standings.",
        )
    return (0, f"No scrape executed for action={action}.")


def execute_reddit(alert: SyncAlert | None = None) -> int | None:
    """Daily r/nba posts (hot + top for the day) and top-N comments per post.

    Not team subs. Missing ``REDDIT_*`` skips HTTP and returns 0 (same
    pattern as odds).
    """
    collector = alert if alert is not None else SyncAlert("reddit")
    if missing_reddit_env_names():
        logger.info("REDDIT_* unset; skipping reddit scrape")
        collector.record_skipped("reddit", reason="REDDIT_* unset; no HTTP attempted")
        return 0
    return collector.try_run(
        "reddit",
        lambda: scrape_reddit(
            subreddit=DAILY_REDDIT_SUBREDDIT,
            limit=DAILY_REDDIT_LIMIT,
            time_filter=DAILY_REDDIT_TIME_FILTER,
            comments_per_post=DAILY_REDDIT_COMMENTS_PER_POST,
        ),
    )


def _contract_rows(result: tuple[int, int]) -> int:
    """Contract rows plus payroll rows, so the step reports one total."""
    return sum(result)


def execute_contracts(alert: SyncAlert | None = None) -> tuple[int, int] | None:
    """Remaining-year player contracts and the team payroll rollup."""
    collector = alert if alert is not None else SyncAlert("contracts")
    return collector.try_run("contracts", scrape_contracts, rows=_contract_rows)


def _transaction_rows(result: tuple[int, int]) -> int:
    """Transactions only. Participants are a child grain, not a second count."""
    return result[0]


def execute_transactions(alert: SyncAlert | None = None) -> tuple[int, int] | None:
    """Current-season transactions log and its participants."""
    collector = alert if alert is not None else SyncAlert("transactions")
    return collector.try_run("transactions", scrape_transactions, rows=_transaction_rows)


def start_run(session: Session, *, triggered_by: str, scrape_action: str) -> int:
    run_id = session.execute(
        INSERT_PIPELINE_RUN,
        {"triggered_by": triggered_by, "scrape_action": scrape_action},
    ).scalar_one()
    return int(run_id)


def finish_run(
    session: Session,
    run_id: int,
    *,
    status: str,
    scrape_exit: int | None = None,
    dbt_exit: int | None = None,
    detail: str | None = None,
    reddit_ran: bool = False,
    reddit_exit: int | None = None,
) -> None:
    session.execute(
        UPDATE_PIPELINE_RUN,
        {
            "run_id": run_id,
            "status": status,
            "scrape_exit": scrape_exit,
            "dbt_exit": dbt_exit,
            "detail": detail,
            "reddit_ran": reddit_ran,
            "reddit_exit": reddit_exit,
        },
    )


def mark_scrape_success(session: Session, *, scrape_date: date | None = None) -> None:
    session.execute(
        UPDATE_PIPELINE_SUCCESS,
        {"scrape_date": scrape_date or date.today()},
    )


# Sources that always return rows whenever they run at all. Zero from one of
# these is either "not published yet" or a parser silently matching nothing;
# a single run cannot tell which, so it is recorded as 'below' and only a
# streak of them alerts. Absent sources are 'not_checked' because zero is a
# legitimate answer for them: todays_games on an off-day, transactions at the
# start of a new season page, or a backfill step with nothing new.
EXPECTS_ROWS = frozenset(
    {
        "contracts",
        "injuries",
        "odds",
        "play_by_play",
        "player_game_logs",
        "reddit",
        "standings",
    }
)


def expectation_for(step: StepOutcome) -> str:
    """'met' / 'below' for a successful step with a known row count, else 'not_checked'."""
    if step.status != "success" or step.rows is None or step.step not in EXPECTS_ROWS:
        return "not_checked"
    return "met" if step.rows > 0 else "below"


def record_source_runs(
    session: Session,
    run_id: int,
    steps: Sequence[StepOutcome],
    *,
    attempt: int = 1,
) -> None:
    """Persist one row per source for this run.

    Best-effort: per-source history must never be the reason a scrape that
    otherwise succeeded gets reported as failed.
    """
    for step in steps:
        session.execute(
            INSERT_SOURCE_RUN,
            {
                "run_id": run_id,
                "source_name": step.step,
                "status": step.status,
                "expectation": expectation_for(step),
                "rows_written": step.rows,
                "season": step.season,
                "attempt": attempt,
                "error_type": step.error_type,
                "error_detail": step.error_detail,
                "started_at": step.started_at,
                "finished_at": step.finished_at,
            },
        )


def find_unhealthy_streaks(
    session: Session,
    run_id: int,
    *,
    threshold: int,
) -> list[SourceStreak]:
    rows = session.execute(
        SELECT_UNHEALTHY_SOURCE_STREAKS,
        {"run_id": run_id, "threshold": threshold},
    ).mappings()
    return [
        SourceStreak(
            source_name=row["source_name"],
            streak=int(row["streak"]),
            failed_runs=int(row["failed_runs"]),
            below_runs=int(row["below_runs"]),
            latest_error_type=row["latest_error_type"],
            latest_error_detail=row["latest_error_detail"],
        )
        for row in rows
    ]


def run_pipeline_scrape(
    *,
    force: bool = False,
    triggered_by: str | None = None,
    today: date | None = None,
) -> dict[str, Any]:
    """Gate + scrape. Does not run dbt (orchestrator / Make target does)."""
    day = today or date.today()
    by = triggered_by or ("force" if force else "manual")

    with get_session() as session:
        config = load_config(session)
        nba_action, detail = decide_action(config, force=force, today=day)
        run_reddit = should_run_reddit(config, force=force)
        run_contracts = should_run_contracts(config, force=force)
        run_transactions = should_run_transactions(config, force=force)
        action = compose_run_action(nba_action, run_reddit, run_contracts, run_transactions)
        run_id = start_run(session, triggered_by=by, scrape_action=action)

    nba_runs = nba_action in _NBA_RUN_ACTIONS
    if not nba_runs and not run_reddit and not run_contracts and not run_transactions:
        with get_session() as session:
            finish_run(
                session,
                run_id,
                status="skipped",
                scrape_exit=0,
                detail=detail,
            )
        return {
            "run_id": run_id,
            "status": "skipped",
            "action": action,
            "detail": detail,
            "scrape_exit": 0,
            "reddit_ran": False,
            "reddit_exit": None,
        }

    scrape_exit = 0
    scrape_detail = detail
    status = "success"
    streaks: list[SourceStreak] = []
    reddit_ran = False
    reddit_exit: int | None = None
    alert = SyncAlert("pipeline")
    parts: list[str] = []
    try:
        if nba_runs:
            try:
                _count, nba_detail = execute_scrape(nba_action, config, alert=alert)
                parts.append(nba_detail)
            except SyncFailedError:
                parts.append(detail)
        elif run_reddit or run_contracts or run_transactions:
            parts.append(detail)
        if run_contracts:
            contracts = execute_contracts(alert)
            if contracts is not None:
                n_contracts, n_payroll = contracts
                parts.append(f"contracts: {n_contracts}; payroll: {n_payroll}.")
        if run_transactions:
            transactions = execute_transactions(alert)
            if transactions is not None:
                n_transactions, n_participants = transactions
                parts.append(f"transactions: {n_transactions}; participants: {n_participants}.")
        if run_reddit:
            reddit_ran = True
            n_reddit = execute_reddit(alert)
            reddit_exit = 0 if n_reddit is not None else 1
            if n_reddit is not None:
                parts.append(f"reddit: {n_reddit} r/{DAILY_REDDIT_SUBREDDIT} posts.")
        alert.raise_if_failed()
        scrape_detail = " ".join(part for part in parts if part) or detail
    except Exception as exc:  # noqa: BLE001 — surface to source.pipeline_runs
        scrape_exit = 1
        status = "failed"
        scrape_detail = f"{' '.join(part for part in parts if part) or detail} Error: {exc}"
        if not alert.failures:
            alert.record(action, exc)

    try:
        with get_session() as session:
            if status == "success":
                mark_scrape_success(session, scrape_date=day)
            finish_run(
                session,
                run_id,
                status=status,
                scrape_exit=scrape_exit,
                detail=scrape_detail,
                reddit_ran=reddit_ran,
                reddit_exit=reddit_exit,
            )
        # Separate session: per-source history is observability, and must not
        # be able to roll back or fail the run bookkeeping above.
        try:
            with get_session() as session:
                record_source_runs(session, run_id, alert.steps)
        except Exception:
            logger.exception("Failed to record per-source run history for run_id=%s", run_id)
        try:
            with get_session() as session:
                streaks = find_unhealthy_streaks(
                    session, run_id, threshold=settings.source_alert_streak
                )
        except Exception:
            logger.exception("Failed to read per-source streaks for run_id=%s", run_id)
    finally:
        # Still one post per sync: a failed sync folds the streaks into its
        # failure alert, and a successful one posts only when a streak exists.
        if status == "failed":
            alert.notify(extra_lines=format_streak_lines(streaks))
        elif streaks:
            post_webhook_text(format_degraded_text(alert.sync_name, streaks))

    return {
        "run_id": run_id,
        "status": status,
        "action": action,
        "detail": scrape_detail,
        "scrape_exit": scrape_exit,
        "reddit_ran": reddit_ran,
        "reddit_exit": reddit_exit,
    }


def record_dbt_only_run(
    dbt_exit: int, *, detail: str | None = None, failed_nodes: list[str] | None = None
) -> int:
    """Log a dbt run that had no scrape attached, returning the new run_id.

    `make dbt` and `make prod-dbt` run dbt directly rather than through
    refresh-daily, so there is no run row to mark. Recording one keeps the
    admin view honest: a fixed failure clears on the next successful build
    instead of showing the last refresh's exit code indefinitely.
    """
    with get_session() as session:
        run_id = int(
            session.execute(
                INSERT_DBT_ONLY_RUN,
                {
                    "triggered_by": "dbt",
                    "dbt_exit": dbt_exit,
                    "detail": detail,
                    "failed_nodes": failed_nodes,
                },
            ).scalar_one()
        )
        session.commit()
    return run_id


def update_run_dbt_exit(
    run_id: int,
    dbt_exit: int,
    *,
    detail: str | None = None,
    failed_nodes: list[str] | None = None,
) -> None:
    with get_session() as session:
        session.execute(
            UPDATE_PIPELINE_RUN_DBT_EXIT,
            {
                "run_id": run_id,
                "dbt_exit": dbt_exit,
                "detail": detail,
                "failed_nodes": failed_nodes,
            },
        )


def update_run_ml_exit(run_id: int, ml_exit: int, *, detail: str | None = None) -> None:
    with get_session() as session:
        session.execute(
            UPDATE_PIPELINE_RUN_ML_EXIT,
            {"run_id": run_id, "ml_exit": ml_exit, "detail": detail},
        )
