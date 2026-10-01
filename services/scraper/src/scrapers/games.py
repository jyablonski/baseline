"""Scrape BRef schedule pages into canonical game identities."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date, datetime, time
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Comment, Tag
from identity import (
    BREF_PROVIDER,
    IdentityResolutionError,
    resolve_game,
    resolve_team_id,
    seed_team_catalog,
)
from sqlalchemy import func

from db import get_session
from models import Game, Team
from scrapers import (
    BREF_BASE_URL,
    bref_get,
    current_season,
    parse_game_date,
    season_start_year,
    to_int,
)

logger = logging.getLogger(__name__)


def schedule_url(season: str) -> str:
    return f"{BREF_BASE_URL}/leagues/NBA_{season_start_year(season) + 1}_games.html"


def _find_schedule_tables(soup: BeautifulSoup) -> list[Tag]:
    tables = [
        table
        for table in soup.find_all("table", id=re.compile(r"schedule"))
        if isinstance(table, Tag)
    ]
    if tables:
        return tables
    found: list[Tag] = []
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "schedule" not in comment:  # ty: ignore[unsupported-operator]
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        found.extend(
            table
            for table in nested.find_all("table", id=re.compile(r"schedule"))
            if isinstance(table, Tag)
        )
    return found


def _cell(row: Tag, *stats: str) -> Tag | None:
    for stat in stats:
        cell = row.find(["th", "td"], attrs={"data-stat": stat})
        if isinstance(cell, Tag):
            return cell
    return None


def _cell_text(row: Tag, *stats: str) -> str | None:
    cell = _cell(row, *stats)
    if not isinstance(cell, Tag):
        return None
    value = cell.get("csk") or cell.get_text(" ", strip=True)
    return str(value).strip() or None


def _schedule_page_urls(html: str, season: str, base_url: str) -> list[str]:
    """Return the season schedule URL followed by BRef's linked month pages."""
    schedule_prefix = f"NBA_{season_start_year(season) + 1}_games-"
    month_pattern = re.compile(rf"/{re.escape(schedule_prefix)}[a-z]+\.html$")
    urls = [base_url]
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("a", href=True):
        url = urljoin(base_url, str(link["href"]))  # ty: ignore[not-subscriptable]
        if month_pattern.search(url) and url not in urls:
            urls.append(url)
    return urls


def _game_date_text(row: Tag) -> str | None:
    cell = _cell(row, "date_game")
    if not isinstance(cell, Tag):
        return None
    csk = str(cell.get("csk") or "").strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", csk):
        return csk
    return cell.get_text(" ", strip=True) or None


def _game_start_time_et(row: Tag) -> time | None:
    value = _cell_text(row, "game_start_time")
    if not value:
        return None
    text = value.strip().lower().replace(" ", "").replace(".", "")
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?([ap])m?", text)
    if match:
        twelve_hour = int(match.group(1))
        minute = int(match.group(2) or 0)
        if 1 <= twelve_hour <= 12 and minute < 60:
            hour = twelve_hour % 12 + (12 if match.group(3) == "p" else 0)
            return time(hour, minute)
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
    if match:
        hour, minute = int(match.group(1)), int(match.group(2))
        if hour < 24 and minute < 60:
            return time(hour, minute)
    return None


def _team_code(row: Tag, stat: str) -> str | None:
    cell = _cell(row, stat)
    if not isinstance(cell, Tag):
        return None
    link = cell.find("a", href=re.compile(r"/teams/[A-Z]{3}/"))
    if not isinstance(link, Tag):
        return None
    match = re.search(r"/teams/([A-Z]{3})/", str(link.get("href") or ""), re.IGNORECASE)
    return match.group(1).upper() if match else None


def _boxscore_key(row: Tag) -> str | None:
    cell = _cell(row, "box_score_text")
    if not isinstance(cell, Tag):
        return None
    link = cell.find("a", href=re.compile(r"/boxscores/[^/]+\.html"))
    if not isinstance(link, Tag):
        return None
    match = re.search(r"/boxscores/([^/]+)\.html", str(link.get("href") or ""), re.IGNORECASE)
    return match.group(1) if match else None


def _season_type_for_row(
    game_date: date,
    remark: str | None,
    *,
    first_play_in_date: date | None,
    source_url: str,
    arena: str | None = None,
    cup_final_date: date | None = None,
) -> str:
    normalized_remark = (remark or "").casefold().replace("-", " ")
    normalized_arena = " ".join((arena or "").casefold().replace("-", " ").split())
    # BRef marks both NBA Cup group games and knockout games as "NBA Cup".
    # The championship is the latest neutral-site NBA Cup game and is the one
    # Cup game excluded from the 82-game Regular Season standings.
    if (
        "cup" in normalized_remark
        and normalized_arena == "t mobile arena"
        and cup_final_date == game_date
    ):
        return "Cup"
    if "play in" in normalized_remark:
        return "PlayIn"
    if first_play_in_date is not None and game_date >= first_play_in_date:
        return "Playoffs"
    if re.search(r"_games-(?:may|june)\.html$", source_url):
        return "Playoffs"
    return "Regular Season"


def parse_schedule_html(html: str, *, season: str, source_url: str) -> list[dict[str, Any]]:
    """Parse schedule rows and classify regular season, Cup, play-in, and playoffs."""
    soup = BeautifulSoup(html, "html.parser")
    parsed_rows: list[tuple[Tag, date, str, str, str | None]] = []
    first_play_in_date: date | None = None
    for table in _find_schedule_tables(soup):
        for row in table.select("tbody tr"):
            if not isinstance(row, Tag) or "thead" in (row.get("class") or []):
                continue
            raw_date = _game_date_text(row)
            visitor = _team_code(row, "visitor_team_name")
            home = _team_code(row, "home_team_name")
            if not raw_date or not visitor or not home:
                continue
            try:
                game_date = parse_game_date(raw_date)
            except ValueError:
                continue
            remark = _cell_text(row, "game_remarks")
            normalized_remark = (remark or "").casefold().replace("-", " ")
            if "play in" in normalized_remark:
                first_play_in_date = (
                    min(first_play_in_date, game_date) if first_play_in_date else game_date
                )
            parsed_rows.append((row, game_date, visitor, home, remark))

    cup_neutral_dates = [
        game_date
        for row, game_date, _visitor, _home, remark in parsed_rows
        if "cup" in (remark or "").casefold()
        and " ".join((_cell_text(row, "arena_name") or "").casefold().replace("-", " ").split())
        == "t mobile arena"
    ]
    cup_final_date = max(cup_neutral_dates) if cup_neutral_dates else None

    rows: list[dict[str, Any]] = []
    seen: set[tuple[date, str, str]] = set()
    for row, game_date, visitor, home, remark in parsed_rows:
        key = (game_date, home, visitor)
        if key in seen:
            continue
        seen.add(key)
        home_score = to_int(_cell_text(row, "home_pts"))
        away_score = to_int(_cell_text(row, "visitor_pts"))
        external_id = _boxscore_key(row)
        arena = _cell_text(row, "arena_name")
        rows.append(
            {
                "provider": BREF_PROVIDER,
                "external_id": external_id or "",
                "source_url": source_url,
                "season": season,
                "season_type": _season_type_for_row(
                    game_date,
                    remark,
                    arena=arena,
                    first_play_in_date=first_play_in_date,
                    source_url=source_url,
                    cup_final_date=cup_final_date,
                ),
                "game_date": game_date,
                "start_time_et": _game_start_time_et(row),
                "home_bref_abbreviation": home,
                "away_bref_abbreviation": visitor,
                "home_score": home_score,
                "away_score": away_score,
                "arena": arena,
                "status": "Final"
                if home_score is not None and away_score is not None
                else "Scheduled",
            }
        )
    return rows


def _season_schedule_url(season: str) -> str:
    return schedule_url(season)


def scrape_games(season: str, *, fetch_html: Callable[[str], str] | None = None) -> int:
    url = _season_schedule_url(season)
    fetch = fetch_html or bref_get
    first_html = fetch(url)
    records: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for page_url in _schedule_page_urls(first_html, season, url):
        html = first_html if page_url == url else fetch(page_url)
        for record in parse_schedule_html(html, season=season, source_url=page_url):
            key = (
                (BREF_PROVIDER, record["external_id"])
                if record["external_id"]
                else (
                    record["game_date"],
                    record["home_bref_abbreviation"],
                    record["away_bref_abbreviation"],
                )
            )
            if key in seen:
                continue
            seen.add(key)
            records.append(record)
    stamp = datetime.now()
    written = 0
    with get_session() as session:
        seed_team_catalog(session, scraped_at=stamp)
        for record in records:
            home_team_id = resolve_team_id(session, record["home_bref_abbreviation"])
            away_team_id = resolve_team_id(session, record["away_bref_abbreviation"])
            if home_team_id is None or away_team_id is None:
                logger.error("Skipping game with unresolved team: %s", record)
                continue
            try:
                resolve_game(
                    session,
                    provider=BREF_PROVIDER,
                    external_id=record["external_id"],
                    season=record["season"],
                    season_type=record["season_type"],
                    game_date=record["game_date"],
                    home_team_id=home_team_id,
                    away_team_id=away_team_id,
                    source_url=record["source_url"],
                    values={
                        "home_score": record["home_score"],
                        "away_score": record["away_score"],
                        "arena": record["arena"],
                        "status": record["status"],
                        "start_time_et": record["start_time_et"],
                        "scraped_at": stamp,
                    },
                )
            except IdentityResolutionError:
                logger.exception("Skipping unresolved game identity %s", record)
                continue
            written += 1
    logger.info("Upserted %s BRef games for %s", written, season)
    return written


def _is_final_status(status: object) -> bool:
    return str(status or "").lower() == "final"


def _ensure_teams() -> None:
    with get_session() as session:
        count = session.query(func.count(Team.team_id)).scalar() or 0
    if count == 0:
        from scrapers.teams import scrape_teams

        scrape_teams()


def scrape_todays_games(today: date | None = None, *, days_ahead: int = 7) -> list[dict]:
    """Refresh the current season schedule and return Final games in the horizon."""
    del days_ahead
    target = today or date.today()
    _ensure_teams()
    scrape_games(current_season(target))
    with get_session() as session:
        rows = session.query(Game).filter(Game.game_date == target, Game.status == "Final").all()
        return [
            {
                "game_id": row.game_id,
                "season": row.season,
                "season_type": row.season_type,
                "game_date": row.game_date,
                "status": row.status,
            }
            for row in rows
        ]


__all__ = [
    "_is_final_status",
    "parse_schedule_html",
    "schedule_url",
    "scrape_games",
    "scrape_todays_games",
]
