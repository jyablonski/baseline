"""Parse Basketball-Reference current injury report HTML.

HTTP-free so unit tests can use fixtures. This is a current snapshot, not a
historical ledger. Team labels on the report are city / franchise names or
abbreviations (BRK/CHO/PHO).
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from bs4 import BeautifulSoup, Comment, Tag

from scrapers.contracts_parse import (
    PLAYER_HREF_RE,
    normalize_player_name,
)

INJURIES_URL = "https://www.basketball-reference.com/friv/injuries.fcgi"

# BRef injury "Team" cell is often a city / short franchise label.
BREF_TEAM_LABELS: dict[str, str] = {
    "atlanta": "ATL",
    "atlanta hawks": "ATL",
    "atl": "ATL",
    "boston": "BOS",
    "boston celtics": "BOS",
    "bos": "BOS",
    "brooklyn": "BRK",
    "brooklyn nets": "BRK",
    "brk": "BRK",
    "bkn": "BRK",
    "charlotte": "CHO",
    "charlotte hornets": "CHO",
    "cho": "CHO",
    "cha": "CHO",
    "chicago": "CHI",
    "chicago bulls": "CHI",
    "chi": "CHI",
    "cleveland": "CLE",
    "cleveland cavaliers": "CLE",
    "cle": "CLE",
    "dallas": "DAL",
    "dallas mavericks": "DAL",
    "dal": "DAL",
    "denver": "DEN",
    "denver nuggets": "DEN",
    "den": "DEN",
    "detroit": "DET",
    "detroit pistons": "DET",
    "det": "DET",
    "golden state": "GSW",
    "golden state warriors": "GSW",
    "gsw": "GSW",
    "houston": "HOU",
    "houston rockets": "HOU",
    "hou": "HOU",
    "indiana": "IND",
    "indiana pacers": "IND",
    "ind": "IND",
    "la clippers": "LAC",
    "los angeles clippers": "LAC",
    "lac": "LAC",
    "la lakers": "LAL",
    "los angeles lakers": "LAL",
    "lal": "LAL",
    "memphis": "MEM",
    "memphis grizzlies": "MEM",
    "mem": "MEM",
    "miami": "MIA",
    "miami heat": "MIA",
    "mia": "MIA",
    "milwaukee": "MIL",
    "milwaukee bucks": "MIL",
    "mil": "MIL",
    "minnesota": "MIN",
    "minnesota timberwolves": "MIN",
    "min": "MIN",
    "new orleans": "NOP",
    "new orleans pelicans": "NOP",
    "nop": "NOP",
    "new york": "NYK",
    "new york knicks": "NYK",
    "nyk": "NYK",
    "oklahoma city": "OKC",
    "oklahoma city thunder": "OKC",
    "okc": "OKC",
    "orlando": "ORL",
    "orlando magic": "ORL",
    "orl": "ORL",
    "philadelphia": "PHI",
    "philadelphia 76ers": "PHI",
    "phi": "PHI",
    "phoenix": "PHO",
    "phoenix suns": "PHO",
    "pho": "PHO",
    "phx": "PHO",
    "portland": "POR",
    "portland trail blazers": "POR",
    "por": "POR",
    "sacramento": "SAC",
    "sacramento kings": "SAC",
    "sac": "SAC",
    "san antonio": "SAS",
    "san antonio spurs": "SAS",
    "sas": "SAS",
    "toronto": "TOR",
    "toronto raptors": "TOR",
    "tor": "TOR",
    "utah": "UTA",
    "utah jazz": "UTA",
    "uta": "UTA",
    "washington": "WAS",
    "washington wizards": "WAS",
    "was": "WAS",
}

_UPDATE_DATE_FORMATS = (
    "%Y-%m-%d",
    "%a, %b %d, %Y",
    "%b %d, %Y",
    "%B %d, %Y",
    "%m/%d/%Y",
)


def parse_update_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    for fmt in _UPDATE_DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def bref_team_from_label(label: str) -> str | None:
    token = " ".join(label.strip().lower().split())
    if not token:
        return None
    return BREF_TEAM_LABELS.get(token)


def _find_injuries_table(soup: BeautifulSoup) -> Tag | None:
    table = soup.find("table", id="injuries")
    if isinstance(table, Tag):
        return table
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "id=" not in comment or "injuries" not in comment:  # ty: ignore[unsupported-operator]
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        found = nested.find("table", id="injuries")
        if isinstance(found, Tag):
            return found
    return None


def _player_slug_and_name(player_cell: Tag) -> tuple[str | None, str | None]:
    link = player_cell.find("a")
    name = player_cell.get_text(strip=True) or None
    slug = None
    if isinstance(link, Tag):
        href = str(link.get("href") or "")
        match = PLAYER_HREF_RE.search(href)
        if match:
            slug = match.group(1).lower()
        if not name:
            name = link.get_text(strip=True) or None
    return slug, name


def _team_label(team_cell: Tag) -> str:
    link = team_cell.find("a")
    if isinstance(link, Tag):
        href = str(link.get("href") or "")
        team_match = re.search(r"/teams/([A-Z]{3})/", href, re.IGNORECASE)
        if team_match:
            return team_match.group(1).upper()
        text = link.get_text(strip=True)
        if text:
            return text
    return team_cell.get_text(strip=True)


def parse_injuries_html(html: str, *, source_url: str = INJURIES_URL) -> list[dict[str, Any]]:
    """Parse the current BRef injury report into one row per listed player."""
    soup = BeautifulSoup(html, "html.parser")
    table = _find_injuries_table(soup)
    if table is None:
        return []

    bodies = table.find_all("tbody") or [table]
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for body in bodies:
        if not isinstance(body, Tag):
            continue
        for row in body.find_all("tr"):
            if row.get("class") and "thead" in row.get("class", []):  # ty: ignore[unresolved-attribute]
                continue
            player_cell = row.find(["th", "td"], attrs={"data-stat": "player"})  # ty: ignore[unresolved-attribute]
            team_cell = row.find(["th", "td"], attrs={"data-stat": "team_name"})  # ty: ignore[unresolved-attribute]
            if not isinstance(team_cell, Tag):
                team_cell = row.find(["th", "td"], attrs={"data-stat": "team"})  # ty: ignore[unresolved-attribute]
            if not isinstance(player_cell, Tag):
                continue
            slug, name = _player_slug_and_name(player_cell)
            if not name or name.lower() == "player":
                continue
            team_label = _team_label(team_cell) if isinstance(team_cell, Tag) else ""
            bref = bref_team_from_label(team_label)
            if bref is None and team_label:
                token = team_label.strip().upper()
                bref = bref_team_from_label(token) or (
                    token if len(token) == 3 and token.isalpha() else None
                )
            if bref is None:
                continue
            update_cell = row.find(["th", "td"], attrs={"data-stat": "date_update"})  # ty: ignore[unresolved-attribute]
            update_raw = None
            if isinstance(update_cell, Tag):
                update_raw = update_cell.get("csk") or update_cell.get_text(strip=True)
            # BRef renamed this column from "injury" to "note" (Sep 2026); keep both.
            injury_cell = row.find(["th", "td"], attrs={"data-stat": "note"})  # ty: ignore[unresolved-attribute]
            if not isinstance(injury_cell, Tag):
                injury_cell = row.find(["th", "td"], attrs={"data-stat": "injury"})  # ty: ignore[unresolved-attribute]
            description = (
                injury_cell.get_text(" ", strip=True) if isinstance(injury_cell, Tag) else ""
            )
            if not description:
                continue
            normalized = normalize_player_name(name)
            key = (normalized, bref)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "player_name": name,
                    "player_name_normalized": normalized,
                    "bref_player_slug": slug,
                    "bref_team_abbreviation": bref,
                    "update_date": parse_update_date(update_raw),
                    "description": description,
                    "source_url": source_url,
                }
            )
    return rows
