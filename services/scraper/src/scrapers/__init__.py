"""Shared Basketball-Reference transport and parsing helpers."""

from __future__ import annotations

import time
from collections.abc import Callable
from contextlib import suppress
from datetime import date, datetime
from typing import Any

import requests
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

BREF_BASE_URL = "https://www.basketball-reference.com"
BREF_REQUEST_TIMEOUT = 60
# Basketball-Reference allows 20 requests a minute; 3s between request starts sat
# exactly on it. 4s (15/min) leaves headroom for clock skew and their own count.
BREF_REQUEST_DELAY_SECONDS = 4.0
BREF_PROVIDER = "basketball-reference"
BREF_HEADERS = {
    "User-Agent": "Baseline/1.0 (+https://baseline.jyablonski.dev; respectful research client)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{BREF_BASE_URL}/",
}

_last_bref_request_at = 0.0
# Set by the first 429. BRef answers a rate-limit breach with a block of up to an
# hour, and every request made during it can extend the block, so the rest of
# this process sends none. Each scrape is its own process, so the next run
# (hourly catch-up, or tomorrow's daily) tries again.
_bref_rate_limited_url: str | None = None


class BrefHTTPError(RuntimeError):
    def __init__(self, status: int, url: str, *, message: str | None = None) -> None:
        self.status = int(status)
        self.url = url
        super().__init__(message or f"Basketball-Reference HTTP {status} for {url}")


class BrefRateLimitedError(BrefHTTPError):
    """BRef returned 429 in this process; no further request is sent to it."""

    def __init__(self, url: str, *, first_url: str) -> None:
        super().__init__(
            429,
            url,
            message=(
                f"Basketball-Reference rate limit hit (first 429 for {first_url}); "
                f"skipped {url} for the rest of this run"
            ),
        )


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (KeyboardInterrupt, SystemExit, ValueError)):
        return False
    # A 429 is never retried: retrying inside the block only lengthens it.
    return not (isinstance(exc, BrefHTTPError) and 400 <= exc.status < 500)


def bref_rate_limit() -> None:
    """Serialize requests and keep a deliberately conservative site delay."""
    global _last_bref_request_at
    elapsed = time.monotonic() - _last_bref_request_at
    if elapsed < BREF_REQUEST_DELAY_SECONDS:
        time.sleep(BREF_REQUEST_DELAY_SECONDS - elapsed)
    _last_bref_request_at = time.monotonic()


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    reraise=True,
)
def bref_get(url: str, *, get: Callable[..., Any] | None = None) -> str:
    global _bref_rate_limited_url
    if _bref_rate_limited_url is not None:
        raise BrefRateLimitedError(url, first_url=_bref_rate_limited_url)
    bref_rate_limit()
    response = (get or requests.get)(url, headers=BREF_HEADERS, timeout=BREF_REQUEST_TIMEOUT)
    status = getattr(response, "status_code", None)
    if status is not None and int(status) == 429:
        _bref_rate_limited_url = url
        raise BrefRateLimitedError(url, first_url=url)
    if status is not None and int(status) >= 400:
        raise BrefHTTPError(int(status), url)
    # BRef pages are UTF-8 but do not always declare a charset; requests then falls
    # back to latin-1 per RFC 2616 and mangles accented names (Jokic -> JokiÄ‡).
    content_type = str(getattr(response, "headers", None) or {}).lower()
    if "charset=" not in content_type:
        with suppress(AttributeError):
            response.encoding = "utf-8"
    return str(response.text)


def current_season(today: date | None = None) -> str:
    today = today or date.today()
    return season_from_start_year(today.year if today.month >= 10 else today.year - 1)


def season_from_start_year(year: int | str) -> str:
    year = int(year)
    return f"{year}-{str(year + 1)[-2:]}"


def season_start_year(season: str) -> int:
    return int(season.split("-", 1)[0])


def generate_seasons(start: str, end: str) -> list[str]:
    first = season_start_year(start)
    last = season_start_year(end)
    if last < first:
        raise ValueError(f"Season range is reversed: {start} -> {end}")
    return [season_from_start_year(year) for year in range(first, last + 1)]


def parse_seasons(value: str | None) -> list[str]:
    if value is None or not value.strip():
        return [current_season()]
    seasons = [part.strip() for part in value.split(",") if part.strip()]
    return seasons or [current_season()]


def parse_game_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    for fmt in ("%Y-%m-%d", "%a, %b %d, %Y", "%b %d, %Y", "%B %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized game date: {value!r}")


def parse_minutes(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    if ":" in text:
        minutes, _, seconds = text.partition(":")
        try:
            return int(minutes) + int(seconds) / 60.0
        except ValueError:
            return None
    try:
        return float(text)
    except ValueError:
        return None


def to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except TypeError, ValueError:
        return None


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def repair_mojibake(value: str) -> str:
    """Undo UTF-8 bytes that were decoded as latin-1 (JokiÄ‡ -> Jokic with acute).

    Round-trips only when the string is fully latin-1 encodable *and* valid UTF-8
    when re-decoded, so correctly decoded text and plain ASCII pass through as-is.
    """
    try:
        return value.encode("latin-1").decode("utf-8")
    except UnicodeEncodeError, UnicodeDecodeError:
        return value


def to_str(value: Any) -> str | None:
    if value is None:
        return None
    text = repair_mojibake(str(value)).strip()
    return text or None


def row_get(row: dict[str, Any], *names: str) -> Any:
    lookup = {str(key).lower(): value for key, value in row.items()}
    for name in names:
        if name.lower() in lookup:
            return lookup[name.lower()]
    return None


def dataset_rows(payload: dict[str, Any], *preferred: str) -> list[dict[str, Any]]:
    for name in preferred:
        rows = payload.get(name)
        if isinstance(rows, list):
            return rows
    return [rows for rows in payload.values() if isinstance(rows, dict)]


def parse_matchup_sides(matchup: str) -> tuple[str | None, str | None]:
    text = (matchup or "").strip()
    if " @ " in text:
        away, home = text.split("@", 1)
        return home.strip().split()[0].upper(), away.strip().split()[0].upper()
    if " vs. " in text:
        home, away = text.split(" vs. ", 1)
        return home.strip().split()[0].upper(), away.strip().split()[0].upper()
    return None, None


__all__ = [
    "BREF_BASE_URL",
    "BREF_HEADERS",
    "BREF_PROVIDER",
    "BREF_REQUEST_TIMEOUT",
    "BREF_REQUEST_DELAY_SECONDS",
    "BrefHTTPError",
    "bref_get",
    "repair_mojibake",
    "bref_rate_limit",
    "current_season",
    "dataset_rows",
    "generate_seasons",
    "parse_game_date",
    "parse_matchup_sides",
    "parse_minutes",
    "parse_seasons",
    "row_get",
    "season_from_start_year",
    "season_start_year",
    "to_float",
    "to_int",
    "to_str",
]
