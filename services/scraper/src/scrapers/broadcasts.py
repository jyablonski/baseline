"""National TV listings for the upcoming slate from ESPN's scoreboard JSON.

Basketball-Reference and The Odds API carry no broadcaster, so this is the one
field ESPN supplies. The endpoint is public and unkeyed but undocumented, and
it only answers for a single day: a date range returns HTTP 400.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import requests
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from db import get_session, upsert_rows
from models import GameBroadcast
from scrapers.odds import _load_team_and_game_lookup, match_odds_game_id, parse_commence_time

logger = logging.getLogger(__name__)

ESPN_SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
ESPN_REQUEST_TIMEOUT = 30
# Today plus two weeks, one request per day. A week was too short: the schedule
# page runs well past it, and before opening night a week ahead is all
# preseason, which matches no game. A game flexed in or out of a national
# window is corrected on a later day's run.
BROADCAST_DAYS_AHEAD = 14
# Radio is national too, but it is not somewhere to watch the game.
NATIONAL_MEDIA_TYPES = frozenset({"TV", "Streaming"})
NATIONAL_TV_MAX_LENGTH = 200
EASTERN = ZoneInfo("America/New_York")


class EspnHTTPError(RuntimeError):
    def __init__(self, status: int, url: str) -> None:
        self.status = int(status)
        self.url = url
        super().__init__(f"ESPN HTTP {status} for {url}")


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (KeyboardInterrupt, SystemExit, ValueError)):
        return False
    return not (isinstance(exc, EspnHTTPError) and 400 <= exc.status < 500 and exc.status != 429)


def national_networks(competition: dict[str, Any]) -> str | None:
    """National TV and streaming networks in feed order, comma-separated."""
    names: list[str] = []
    for broadcast in competition.get("geoBroadcasts") or []:
        if not isinstance(broadcast, dict):
            continue
        market = str((broadcast.get("market") or {}).get("type") or "")
        media_type = str((broadcast.get("type") or {}).get("shortName") or "")
        name = str((broadcast.get("media") or {}).get("shortName") or "").strip()
        if market != "National" or media_type not in NATIONAL_MEDIA_TYPES or not name:
            continue
        if name not in names:
            names.append(name)
    return ", ".join(names)[:NATIONAL_TV_MAX_LENGTH] or None


def parse_scoreboard(payload: Any) -> list[dict[str, Any]]:
    """Flatten one scoreboard day into source.game_broadcasts rows (no game_id)."""
    if not isinstance(payload, dict):
        return []
    rows: list[dict[str, Any]] = []
    for event in payload.get("events") or []:
        if not isinstance(event, dict):
            continue
        competitions = event.get("competitions") or []
        competition = competitions[0] if competitions else None
        if not isinstance(competition, dict):
            continue
        names: dict[str, str] = {}
        for competitor in competition.get("competitors") or []:
            if not isinstance(competitor, dict):
                continue
            side = str(competitor.get("homeAway") or "")
            names[side] = str((competitor.get("team") or {}).get("displayName") or "").strip()
        event_id = str(event.get("id") or "").strip()
        commence = parse_commence_time(event.get("date"))
        if not event_id or commence is None or not names.get("home") or not names.get("away"):
            continue
        rows.append(
            {
                "espn_event_id": event_id,
                "commence_time": commence,
                "home_team_name": names["home"],
                "away_team_name": names["away"],
                "game_id": None,
                "national_tv": national_networks(competition),
            }
        )
    return rows


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(4),
    reraise=True,
)
def espn_get(day: date, *, get: Callable[..., Any] | None = None) -> Any:
    params = {"dates": day.strftime("%Y%m%d")}
    http_get = get or requests.get
    response = http_get(ESPN_SCOREBOARD_URL, params=params, timeout=ESPN_REQUEST_TIMEOUT)
    status = getattr(response, "status_code", None)
    if status is not None and int(status) >= 400:
        raise EspnHTTPError(int(status), f"{ESPN_SCOREBOARD_URL}?dates={params['dates']}")
    return response.json()


def scrape_broadcasts(
    *,
    fetch_day: Callable[[date], Any] | None = None,
    today: date | None = None,
    days_ahead: int = BROADCAST_DAYS_AHEAD,
) -> int:
    """Upsert national TV listings for today and the days ahead. Returns events written."""
    fetch = fetch_day or espn_get
    start = today or datetime.now(EASTERN).date()
    rows: list[dict[str, Any]] = []
    for offset in range(days_ahead + 1):
        rows.extend(parse_scoreboard(fetch(start + timedelta(days=offset))))
    # One row per event: a repeat across two days' responses would break the upsert.
    rows = list({row["espn_event_id"]: row for row in rows}.values())
    scraped_at = datetime.now()
    with get_session() as session:
        teams_by_name, games = _load_team_and_game_lookup(session)
        for row in rows:
            row["game_id"] = match_odds_game_id(row, teams_by_name=teams_by_name, games=games)
            row["scraped_at"] = scraped_at
        written = upsert_rows(session, GameBroadcast, rows, ["espn_event_id"])
    national = sum(1 for row in rows if row["national_tv"])
    logger.info("Upserted %s ESPN events (%s on national TV)", written, national)
    return written


__all__ = [
    "ESPN_SCOREBOARD_URL",
    "EspnHTTPError",
    "espn_get",
    "national_networks",
    "parse_scoreboard",
    "scrape_broadcasts",
]
