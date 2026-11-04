"""Parse Basketball-Reference team payroll HTML into player-season rows.

Basketball-Reference publishes remaining multi-year
contracts at ``/contracts/{TEAM}.html``. Tables may be live HTML or wrapped
in comments; this module is HTTP-free so unit tests can use fixtures.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from typing import Any

from bs4 import BeautifulSoup, Comment, Tag

SEASON_HEADER_RE = re.compile(r"^\d{4}-\d{2}$")
PLAYER_HREF_RE = re.compile(r"/players/[a-z]/([a-z0-9]+)\.html", re.IGNORECASE)
SUFFIX_RE = re.compile(r"\b(jr\.?|sr\.?|iii|ii|iv)\b", re.IGNORECASE)
NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")

TEAM_CODE_ALIASES: dict[str, str] = {"BKN": "BRK", "CHA": "CHO", "PHX": "PHO"}

BREF_TEAM_ABBREVIATIONS: tuple[str, ...] = (
    "ATL",
    "BOS",
    "BRK",
    "CHO",
    "CHI",
    "CLE",
    "DAL",
    "DEN",
    "DET",
    "GSW",
    "HOU",
    "IND",
    "LAC",
    "LAL",
    "MEM",
    "MIA",
    "MIL",
    "MIN",
    "NOP",
    "NYK",
    "OKC",
    "ORL",
    "PHI",
    "PHO",
    "POR",
    "SAC",
    "SAS",
    "TOR",
    "UTA",
    "WAS",
)


def normalize_player_name(name: str) -> str:
    """ASCII-fold, strip Jr/Sr/III-style suffixes, collapse punctuation."""
    decomposed = unicodedata.normalize("NFKD", name)
    ascii_name = decomposed.encode("ascii", "ignore").decode("ascii")
    without_suffix = SUFFIX_RE.sub(" ", ascii_name.lower())
    spaced = NON_ALNUM_RE.sub(" ", without_suffix)
    return " ".join(spaced.split())


def bref_team_abbreviation(nba_or_bref: str) -> str:
    token = nba_or_bref.strip().upper()
    return TEAM_CODE_ALIASES.get(token, token)


def parse_team_list(value: str | None) -> list[str]:
    """Parse comma-separated NBA or BRef abbreviations. None -> all 30 teams."""
    if value is None or not value.strip():
        return list(BREF_TEAM_ABBREVIATIONS)
    seen: list[str] = []
    unknown: list[str] = []
    for part in value.split(","):
        token = part.strip()
        if not token:
            continue
        bref = bref_team_abbreviation(token)
        if bref not in BREF_TEAM_ABBREVIATIONS:
            unknown.append(token)
            continue
        if bref not in seen:
            seen.append(bref)
    if unknown:
        raise ValueError(
            "Unknown team abbreviation(s): "
            + ", ".join(unknown)
            + ". Use NBA (BKN/CHA/PHX) or Basketball-Reference (BRK/CHO/PHO) codes."
        )
    if not seen:
        raise ValueError("No team abbreviations provided.")
    return seen


def parse_salary_text(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    digits = re.sub(r"[^0-9-]", "", text)
    if not digits or digits == "-":
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _cell_salary(cell: Tag | None) -> tuple[int | None, bool]:
    """Return (amount, is_fully_guaranteed). Italic ``<em>`` means not fully guaranteed."""
    if cell is None:
        return None, True
    csk = cell.get("csk")
    amount = parse_salary_text(csk) if csk not in (None, "") else parse_salary_text(cell.get_text())
    is_fully_guaranteed = cell.find("em") is None
    return amount, is_fully_guaranteed


def _find_contracts_table(soup: BeautifulSoup) -> Tag | None:
    table = soup.find("table", id="contracts")
    if isinstance(table, Tag):
        return table
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "id=" not in comment or "contracts" not in comment:
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        found = nested.find("table", id="contracts")
        if isinstance(found, Tag):
            return found
    return None


def _header_row(table: Tag) -> Tag | None:
    thead = table.find("thead")
    rows: Iterable[Tag] = thead.find_all("tr") if isinstance(thead, Tag) else table.find_all("tr")
    for row in rows:
        if row.find("th", attrs={"data-stat": "player"}):
            seasons = [
                cell.get_text(strip=True)
                for cell in row.find_all(["th", "td"])
                if SEASON_HEADER_RE.match(cell.get_text(strip=True) or "")
            ]
            if seasons:
                return row
    return None


def _season_columns(header_row: Tag) -> list[tuple[str, str]]:
    """Return (data-stat, season) for year columns like 2026-27."""
    columns: list[tuple[str, str]] = []
    for cell in header_row.find_all(["th", "td"]):
        label = cell.get_text(strip=True)
        if not SEASON_HEADER_RE.match(label):
            continue
        stat = cell.get("data-stat")
        if not stat:
            continue
        columns.append((str(stat), label))
    return columns


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
    if slug is None:
        csk = player_cell.get("csk")
        if csk:
            slug = str(csk).strip().lower() or None
    return slug, name


def parse_contracts_html(
    html: str,
    *,
    bref_team_abbreviation: str,
    source_url: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Parse a team payroll page into player-season rows and team-season totals."""
    bref = bref_team_abbreviation.strip().upper()
    soup = BeautifulSoup(html, "html.parser")
    table = _find_contracts_table(soup)
    if table is None:
        return [], []

    header = _header_row(table)
    if header is None:
        return [], []
    season_columns = _season_columns(header)
    if not season_columns:
        return [], []

    player_rows: list[dict[str, Any]] = []
    payroll_rows: list[dict[str, Any]] = []

    bodies = table.find_all("tbody") or [table]
    for body in bodies:
        if not isinstance(body, Tag):
            continue
        for row in body.find_all("tr"):
            if "thead" in (row.get("class") or []):
                continue
            player_cell = row.find(["th", "td"], attrs={"data-stat": "player"})
            if not isinstance(player_cell, Tag):
                continue
            label = player_cell.get_text(strip=True)
            if not label or label.lower() == "player":
                continue
            slug, name = _player_slug_and_name(player_cell)
            if not slug or not name or name.lower() == "team totals":
                continue
            age_cell = row.find(["th", "td"], attrs={"data-stat": "age_today"})
            player_age = parse_salary_text(
                age_cell.get_text() if isinstance(age_cell, Tag) else None
            )
            guaranteed_cell = row.find(["th", "td"], attrs={"data-stat": "remain_gtd"})
            remaining_guaranteed, _ = _cell_salary(
                guaranteed_cell if isinstance(guaranteed_cell, Tag) else None
            )
            for stat, season in season_columns:
                cell = row.find(["th", "td"], attrs={"data-stat": stat})
                salary, is_fully_guaranteed = _cell_salary(cell if isinstance(cell, Tag) else None)
                if salary is None:
                    continue
                player_rows.append(
                    {
                        "bref_player_slug": slug,
                        "player_name": name,
                        "player_name_normalized": normalize_player_name(name),
                        "bref_team_abbreviation": bref,
                        "season": season,
                        "salary": salary,
                        "is_fully_guaranteed": is_fully_guaranteed,
                        "remaining_guaranteed": remaining_guaranteed,
                        "player_age": player_age,
                        "source_url": source_url,
                    }
                )

    footer = table.find("tfoot")
    footer_rows = footer.find_all("tr") if isinstance(footer, Tag) else []
    for row in footer_rows:
        player_cell = row.find(["th", "td"], attrs={"data-stat": "player"})
        if not isinstance(player_cell, Tag):
            continue
        if player_cell.get_text(strip=True).lower() != "team totals":
            continue
        guaranteed_cell = row.find(["th", "td"], attrs={"data-stat": "remain_gtd"})
        remaining_guaranteed, _ = _cell_salary(
            guaranteed_cell if isinstance(guaranteed_cell, Tag) else None
        )
        for stat, season in season_columns:
            cell = row.find(["th", "td"], attrs={"data-stat": stat})
            total_salary, _ = _cell_salary(cell if isinstance(cell, Tag) else None)
            if total_salary is None:
                continue
            payroll_rows.append(
                {
                    "bref_team_abbreviation": bref,
                    "season": season,
                    "total_salary": total_salary,
                    "remaining_guaranteed": remaining_guaranteed,
                    "source_url": source_url,
                }
            )

    return player_rows, payroll_rows
