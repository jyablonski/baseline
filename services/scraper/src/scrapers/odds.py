"""Forward-looking NBA moneylines/spreads from The Odds API.

Requires ``ODDS_API_KEY``. Unset or empty skips HTTP and returns 0 (same
pattern as ``SLACK_WEBHOOK_URL``). Does not scrape bookmaker HTML.
Historical odds backfill is out of scope, but history accrues from here on:
each game keeps the last line captured before tip-off.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode
from uuid import UUID

import requests
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from config import settings
from db import get_session, upsert_rows
from models import Game, GameOdds, Team
from queries.snapshots import DELETE_STALE_GAME_ODDS

logger = logging.getLogger(__name__)

ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports/basketball_nba/odds"
ODDS_REQUEST_TIMEOUT = 30
ODDS_REGIONS = "us"
ODDS_MARKETS = "h2h,spreads"


class OddsHTTPError(RuntimeError):
    def __init__(self, status: int, url: str) -> None:
        self.status = int(status)
        self.url = url
        super().__init__(f"The Odds API HTTP {status} for {url}")


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, (KeyboardInterrupt, SystemExit, ValueError)):
        return False
    return not (isinstance(exc, OddsHTTPError) and 400 <= exc.status < 500 and exc.status != 429)


def american_implied_wp(price: int | None) -> float | None:
    """American moneyline → implied win probability (includes vig)."""
    if price is None:
        return None
    if price > 0:
        return 100.0 / (price + 100.0)
    if price < 0:
        abs_price = abs(price)
        return abs_price / (abs_price + 100.0)
    return None


def de_vig_pair(
    home_implied: float | None, away_implied: float | None
) -> tuple[float | None, float | None]:
    if home_implied is None or away_implied is None:
        return None, None
    total = home_implied + away_implied
    if total <= 0:
        return None, None
    return home_implied / total, away_implied / total


def _to_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except TypeError, ValueError:
        return None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def parse_commence_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is not None:
        return parsed.replace(tzinfo=None)
    return parsed


def _normalize_team_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


TEAM_NAME_ALIASES: dict[str, str] = {
    "los angeles clippers": "la clippers",
    "la clippers": "la clippers",
    "los angeles lakers": "los angeles lakers",
    "la lakers": "los angeles lakers",
}


def _team_key(name: str) -> str:
    normalized = _normalize_team_name(name)
    return TEAM_NAME_ALIASES.get(normalized, normalized)


def _outcome_map(outcomes: list[Any], *, home_name: str, away_name: str) -> dict[str, Any]:
    by_name: dict[str, dict[str, Any]] = {}
    for outcome in outcomes:
        if not isinstance(outcome, dict):
            continue
        name = str(outcome.get("name") or "")
        if name:
            by_name[_team_key(name)] = outcome
    return {
        "home": by_name.get(_team_key(home_name)),
        "away": by_name.get(_team_key(away_name)),
    }


def parse_odds_events(payload: Any) -> list[dict[str, Any]]:
    """Flatten The Odds API event list into source.game_odds rows (no scraped_at)."""
    if not isinstance(payload, list):
        return []
    rows: list[dict[str, Any]] = []
    for event in payload:
        if not isinstance(event, dict):
            continue
        event_id = str(event.get("id") or "").strip()
        home_name = str(event.get("home_team") or "").strip()
        away_name = str(event.get("away_team") or "").strip()
        commence = parse_commence_time(event.get("commence_time"))
        if not event_id or not home_name or not away_name or commence is None:
            continue
        for book in event.get("bookmakers") or []:
            if not isinstance(book, dict):
                continue
            bookmaker = str(book.get("key") or book.get("title") or "").strip()
            if not bookmaker:
                continue
            for market in book.get("markets") or []:
                if not isinstance(market, dict):
                    continue
                market_key = str(market.get("key") or "").strip()
                if market_key not in {"h2h", "spreads"}:
                    continue
                sides = _outcome_map(
                    list(market.get("outcomes") or []),
                    home_name=home_name,
                    away_name=away_name,
                )
                home_out = sides["home"]
                away_out = sides["away"]
                home_price = _to_int((home_out or {}).get("price"))
                away_price = _to_int((away_out or {}).get("price"))
                home_implied = american_implied_wp(home_price)
                away_implied = american_implied_wp(away_price)
                home_market, away_market = de_vig_pair(home_implied, away_implied)
                spread_home = (
                    _to_float((home_out or {}).get("point")) if market_key == "spreads" else None
                )
                rows.append(
                    {
                        "odds_event_id": event_id,
                        "commence_time": commence,
                        "home_team_name": home_name,
                        "away_team_name": away_name,
                        "game_id": None,
                        "bookmaker": bookmaker,
                        "market": market_key,
                        "home_price": home_price,
                        "away_price": away_price,
                        "home_implied_wp": home_implied,
                        "away_implied_wp": away_implied,
                        "home_market_wp": home_market,
                        "away_market_wp": away_market,
                        "spread_home": spread_home,
                    }
                )
    return rows


def _load_team_and_game_lookup(session: Any) -> tuple[dict[str, UUID], list[Any]]:
    teams = session.query(Team).all()
    by_name: dict[str, UUID] = {}
    for team in teams:
        by_name[_team_key(team.full_name)] = team.team_id
        by_name[_team_key(f"{team.city} {team.nickname}")] = team.team_id
        by_name[_team_key(team.abbreviation)] = team.team_id
    games = session.query(Game).all()
    return by_name, games


def match_odds_game_id(
    row: dict[str, Any],
    *,
    teams_by_name: dict[str, UUID],
    games: list[Any],
) -> UUID | None:
    home_id = teams_by_name.get(_team_key(str(row.get("home_team_name") or "")))
    away_id = teams_by_name.get(_team_key(str(row.get("away_team_name") or "")))
    commence = row.get("commence_time")
    if home_id is None or away_id is None or not isinstance(commence, datetime):
        return None
    game_date = commence.date()
    matches = [
        game
        for game in games
        if game.home_team_id == home_id
        and game.away_team_id == away_id
        and game.game_date == game_date
    ]
    if len(matches) == 1:
        return matches[0].game_id
    return None


@retry(
    retry=retry_if_exception(_is_retryable),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    stop=stop_after_attempt(4),
    reraise=True,
)
def odds_get(
    api_key: str,
    *,
    get: Callable[..., Any] | None = None,
) -> Any:
    params = {
        "apiKey": api_key,
        "regions": ODDS_REGIONS,
        "markets": ODDS_MARKETS,
        "oddsFormat": "american",
    }
    url = f"{ODDS_API_BASE}?{urlencode(params)}"
    http_get = get or requests.get
    response = http_get(ODDS_API_BASE, params=params, timeout=ODDS_REQUEST_TIMEOUT)
    status = getattr(response, "status_code", None)
    if status is not None and int(status) >= 400:
        raise OddsHTTPError(int(status), url)
    return response.json()


def scrape_odds(
    *,
    api_key: str | None = None,
    fetch_events: Callable[[str], Any] | None = None,
    now: datetime | None = None,
) -> int:
    """Upsert the current upcoming odds slate. Returns 0 and skips HTTP if no key.

    Rows already stored for started games are left alone: they hold the last
    pregame line and are the history ``fct_game_upsets`` is built from.
    """
    key = api_key if api_key is not None else settings.odds_api_key
    if not key:
        logger.info("ODDS_API_KEY unset; skipping odds scrape")
        return 0

    payload = fetch_events(key) if fetch_events is not None else odds_get(key)
    # commence_time is naive UTC (see parse_commence_time).
    now_utc = now or datetime.now(UTC).replace(tzinfo=None)
    # The feed also carries in-play events at live prices; upserting those
    # would overwrite the pregame line on the same (event, book, market) key.
    rows = [row for row in parse_odds_events(payload) if row["commence_time"] > now_utc]
    scraped_at = datetime.now()
    with get_session() as session:
        teams_by_name, games = _load_team_and_game_lookup(session)
        for row in rows:
            row["game_id"] = match_odds_game_id(row, teams_by_name=teams_by_name, games=games)
            row["scraped_at"] = scraped_at
        written = upsert_rows(
            session,
            GameOdds,
            rows,
            ["odds_event_id", "bookmaker", "market"],
        )
        session.execute(
            DELETE_STALE_GAME_ODDS,
            {"scraped_at": scraped_at, "now_utc": now_utc},
        )
        session.commit()
    logger.info("Upserted %s pregame odds rows from The Odds API", written)
    return written


__all__ = [
    "ODDS_API_BASE",
    "OddsHTTPError",
    "american_implied_wp",
    "de_vig_pair",
    "match_odds_game_id",
    "odds_get",
    "parse_commence_time",
    "parse_odds_events",
    "scrape_odds",
]
