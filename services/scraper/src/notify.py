"""Optional Slack Incoming Webhook alerts for scrape sync failures.

One POST per sync (pipeline / scrape-daily / scrape-all), never per step.
refresh-daily.sh adds one more per failed dbt or ml stage; a scrape failure
stops the refresh before either runs, so the two never stack.
Unset or empty ``SLACK_WEBHOOK_URL`` skips HTTP and never fails the scrape.

``SyncAlert`` also collects a per-step outcome for every source it wraps, so
``source.scrape_source_runs`` can attribute a failure to one source instead
of one status for the whole sync. Collection only: this module never touches
the database, the caller that owns the session persists ``steps``.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, TypeVar

import requests

from config import settings

logger = logging.getLogger(__name__)

WEBHOOK_TIMEOUT_SECONDS = 8
_MESSAGE_LIMIT = 200
_MAX_FAILURES_IN_MESSAGE = 15

T = TypeVar("T")


@dataclass(frozen=True)
class StepFailure:
    step: str
    error_type: str
    message: str
    season: str | None = None

    @classmethod
    def from_exception(
        cls,
        step: str,
        exc: BaseException,
        *,
        season: str | None = None,
    ) -> StepFailure:
        return cls(
            step=step,
            error_type=type(exc).__name__,
            message=_truncate_error_message(exc),
            season=season,
        )


@dataclass(frozen=True)
class StepOutcome:
    """One source's result within a sync. Mirrors source.scrape_source_runs."""

    step: str
    status: str  # success | failed | skipped
    started_at: datetime
    finished_at: datetime
    rows: int | None = None
    season: str | None = None
    error_type: str | None = None
    error_detail: str | None = None


def infer_rows(result: Any) -> int | None:
    """Best-effort row count from whatever a scrape step happened to return.

    Steps are inconsistent by history: some return a count, some the rows
    themselves, and contracts returns a (contracts, payroll) pair. Callers
    with something better can pass ``rows=`` to ``try_run``.
    """
    if isinstance(result, bool) or result is None:
        return None
    if isinstance(result, int):
        return result
    if isinstance(result, (list, tuple, set)):
        if result and all(isinstance(item, int) and not isinstance(item, bool) for item in result):
            return sum(result)
        return len(result)
    return None


class SyncFailedError(RuntimeError):
    """One or more scrape steps failed during a sync."""

    def __init__(self, failures: Sequence[StepFailure]) -> None:
        self.failures = list(failures)
        first = self.failures[0]
        super().__init__(
            f"{len(self.failures)} scrape step(s) failed; "
            f"first={first.step}: {first.error_type}: {first.message}"
        )


def _truncate_error_message(exc: BaseException) -> str:
    raw = re.sub(r"<[^>]+>", " ", str(exc))
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) > _MESSAGE_LIMIT:
        return raw[: _MESSAGE_LIMIT - 3] + "..."
    return raw


def _resolve_webhook_url(webhook_url: str | None) -> str | None:
    raw = settings.slack_webhook_url if webhook_url is None else webhook_url
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped or None


def format_sync_failure_text(sync_name: str, failures: Sequence[StepFailure]) -> str:
    lines = [f"NBA scrape failed: {sync_name} ({len(failures)} step(s))"]
    shown = failures[:_MAX_FAILURES_IN_MESSAGE]
    for item in shown:
        where = f"{item.step} ({item.season})" if item.season else item.step
        detail = f"{item.error_type}: {item.message}" if item.message else item.error_type
        lines.append(f"- {where}: {detail}")
    extra = len(failures) - len(shown)
    if extra:
        lines.append(f"- ...and {extra} more")
    return "\n".join(lines)


def post_webhook_text(text: str, *, webhook_url: str | None = None) -> None:
    """POST one Incoming Webhook message. No-op when the URL is unset.

    Never raises: an alert that cannot be delivered must not change the exit
    status of the job it is reporting on.
    """
    url = _resolve_webhook_url(webhook_url)
    if not url:
        return
    try:
        response = requests.post(
            url,
            json={"text": text},
            timeout=WEBHOOK_TIMEOUT_SECONDS,
        )
        if response.status_code >= 400:
            logger.warning(
                "Slack webhook returned HTTP %s; the reported failure still stands",
                response.status_code,
            )
    except Exception:
        logger.warning(
            "Slack webhook POST failed; the reported failure still stands",
            exc_info=True,
        )


def notify_sync_failures(
    failures: Sequence[StepFailure],
    *,
    sync_name: str,
    webhook_url: str | None = None,
    extra_lines: Sequence[str] = (),
) -> None:
    """POST one Incoming Webhook summary. No-op when URL is unset or no failures."""
    if not failures:
        return
    text = format_sync_failure_text(sync_name, failures)
    if extra_lines:
        text = "\n".join([text, *extra_lines])
    post_webhook_text(text, webhook_url=webhook_url)


@dataclass(frozen=True)
class SourceStreak:
    """A source whose latest attempted runs have all been unhealthy."""

    source_name: str
    streak: int
    failed_runs: int
    below_runs: int
    latest_error_type: str | None = None
    latest_error_detail: str | None = None


def format_streak_lines(streaks: Sequence[SourceStreak]) -> list[str]:
    """One line per source. Wording separates "erroring" from "empty".

    A single empty run is usually "not published yet"; by the time a streak
    reaches the alert threshold the likelier cause is a parser that silently
    stopped matching, so that is what the line says.
    """
    lines: list[str] = []
    for item in streaks:
        if item.below_runs and not item.failed_runs:
            lines.append(
                f"- {item.source_name}: {item.streak} runs in a row returned no rows "
                "(past the not-yet-published window; check the parser)"
            )
            continue
        detail = item.latest_error_type or "error"
        if item.latest_error_detail:
            detail = f"{detail}: {item.latest_error_detail}"
        lines.append(
            f"- {item.source_name}: unhealthy {item.streak} runs in a row; latest {detail}"
        )
    return lines


def format_degraded_text(sync_name: str, streaks: Sequence[SourceStreak]) -> str:
    header = f"NBA scrape degraded: {sync_name} succeeded but {len(streaks)} source(s) keep failing"
    return "\n".join([header, *format_streak_lines(streaks)])


def format_stage_failure_text(
    stage: str,
    exit_code: int,
    *,
    run_id: int | None = None,
    detail: str | None = None,
) -> str:
    where = f" (run_id={run_id})" if run_id is not None else ""
    text = f"NBA refresh failed: {stage} exited {exit_code}{where}"
    if detail:
        text = f"{text}\n- {detail}"
    return text


@dataclass
class SyncAlert:
    """Collects step failures during one scrape sync and posts at most once.

    Also collects a ``StepOutcome`` per wrapped step for per-source run
    history. ``failures`` stays the Slack input and is unchanged.
    """

    sync_name: str
    failures: list[StepFailure] = field(default_factory=list)
    steps: list[StepOutcome] = field(default_factory=list)

    def record(
        self,
        step: str,
        exc: BaseException,
        *,
        season: str | None = None,
    ) -> None:
        self.failures.append(StepFailure.from_exception(step, exc, season=season))

    def record_skipped(self, step: str, *, reason: str, season: str | None = None) -> None:
        """A step that was deliberately not attempted (missing key, gated off).

        Distinct from success-with-zero-rows on purpose: it is what makes
        "odds have not run for a week" visible rather than looking healthy.
        """
        now = datetime.now()
        self.steps.append(
            StepOutcome(
                step=step,
                status="skipped",
                started_at=now,
                finished_at=now,
                season=season,
                error_detail=reason,
            )
        )

    def try_run(
        self,
        step: str,
        fn: Callable[[], T],
        *,
        season: str | None = None,
        rows: Callable[[T], int | None] | None = None,
    ) -> T | None:
        started_at = datetime.now()
        try:
            result = fn()
        except Exception as exc:
            where = f"{step} ({season})" if season else step
            logger.exception("Scrape step %s failed", where)
            self.record(step, exc, season=season)
            self.steps.append(
                StepOutcome(
                    step=step,
                    status="failed",
                    started_at=started_at,
                    finished_at=datetime.now(),
                    season=season,
                    error_type=type(exc).__name__,
                    error_detail=_truncate_error_message(exc),
                )
            )
            return None
        self.steps.append(
            StepOutcome(
                step=step,
                status="success",
                started_at=started_at,
                finished_at=datetime.now(),
                rows=rows(result) if rows is not None else infer_rows(result),
                season=season,
            )
        )
        return result

    def raise_if_failed(self) -> None:
        if self.failures:
            raise SyncFailedError(self.failures)

    def notify(
        self,
        *,
        webhook_url: str | None = None,
        extra_lines: Sequence[str] = (),
    ) -> None:
        notify_sync_failures(
            self.failures,
            sync_name=self.sync_name,
            webhook_url=webhook_url,
            extra_lines=extra_lines,
        )
