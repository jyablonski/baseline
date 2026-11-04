"""Scrape current standings from Basketball-Reference league pages."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from bs4 import BeautifulSoup, Comment, Tag
from identity import resolve_team_id, seed_team_catalog

from db import get_session, upsert_rows
from models import Standing
from scrapers import BREF_BASE_URL, bref_get, season_start_year, to_float, to_int

logger = logging.getLogger(__name__)


def standings_url(season: str) -> str:
    return f"{BREF_BASE_URL}/leagues/NBA_{season_start_year(season) + 1}_standings.html"


def _tables(soup: BeautifulSoup) -> list[Tag]:
    direct = [
        table
        for table in soup.find_all("table", id=re.compile(r"standings"))
        if isinstance(table, Tag)
    ]
    if direct:
        return direct
    found: list[Tag] = []
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "standings" not in comment:
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        found.extend(
            table
            for table in nested.find_all("table", id=re.compile(r"standings"))
            if isinstance(table, Tag)
        )
    return found


def _cell(row: Tag, *stats: str) -> Tag | None:
    for stat in stats:
        cell = row.find(["th", "td"], attrs={"data-stat": stat})
        if isinstance(cell, Tag):
            return cell
    return None


def _text(row: Tag, *stats: str) -> str | None:
    cell = _cell(row, *stats)
    if not isinstance(cell, Tag):
        return None
    value = cell.get("csk") or cell.get_text(" ", strip=True)
    return str(value).strip() or None


def _team_code(row: Tag) -> str | None:
    cell = _cell(row, "team_name")
    link = cell.find("a", href=re.compile(r"/teams/[A-Z]{3}/")) if isinstance(cell, Tag) else None
    if not isinstance(link, Tag):
        return None
    match = re.search(r"/teams/([A-Z]{3})/", str(link.get("href") or ""), re.IGNORECASE)
    return match.group(1).upper() if match else None


def parse_standings_html(
    html: str, *, season: str, as_of_date: date, source_url: str
) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []
    for table in _tables(soup):
        table_id = str(table.get("id") or "").lower()
        if table_id.startswith("divs_standings_"):
            continue
        conference = (
            "East" if table_id.endswith("_e") else "West" if table_id.endswith("_w") else None
        )
        division = None
        for index, row in enumerate(table.select("tbody tr"), start=1):
            if not isinstance(row, Tag) or "thead" in (row.get("class") or []):
                continue
            bref = _team_code(row)
            if bref is None:
                continue
            rows.append(
                {
                    "bref_team_abbreviation": bref,
                    "season": season,
                    "season_type": "Regular Season",
                    "as_of_date": as_of_date,
                    "conference": conference,
                    "division": division,
                    "conference_rank": to_int(_text(row, "ranker", "rank")) or index,
                    "division_rank": None,
                    "wins": to_int(_text(row, "wins")),
                    "losses": to_int(_text(row, "losses")),
                    "win_pct": to_float(_text(row, "win_loss_pct")),
                    "games_back": to_float(_text(row, "gb")),
                    "conf_games_back": None,
                    "streak": _text(row, "current_streak"),
                    "last_10": _text(row, "last_10"),
                    "source_url": source_url,
                }
            )
    return rows


def scrape_standings(season: str, *, fetch_html: Callable[[str], str] | None = None) -> int:
    url = standings_url(season)
    html = (fetch_html or bref_get)(url)
    parsed = parse_standings_html(html, season=season, as_of_date=date.today(), source_url=url)
    stamp = datetime.now()
    rows: list[dict[str, Any]] = []
    with get_session() as session:
        seed_team_catalog(session, scraped_at=stamp)
        for row in parsed:
            team_id = resolve_team_id(session, row.pop("bref_team_abbreviation"))
            if team_id is None:
                logger.warning("Skipping unresolved standings team")
                continue
            row["team_id"] = team_id
            row.pop("source_url", None)
            row["scraped_at"] = stamp
            rows.append(row)
        written = upsert_rows(session, Standing, rows, ["season", "season_type", "team_id"])
    logger.info("Upserted %s BRef standings rows for %s", written, season)
    return written


__all__ = ["parse_standings_html", "scrape_standings", "standings_url"]
