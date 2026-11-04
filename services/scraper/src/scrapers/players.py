"""Discover and maintain the durable player registry from BRef rosters."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any

from bs4 import BeautifulSoup, Comment, Tag
from identity import (
    BREF_PROVIDER,
    ensure_player,
    is_abbreviated_player_name,
    seed_team_catalog,
)
from sqlalchemy import select

from db import get_session
from models import Player, PlayerExternalId
from scrapers import BREF_BASE_URL, bref_get, current_season, season_start_year, to_int
from scrapers.contracts_parse import PLAYER_HREF_RE, normalize_player_name

logger = logging.getLogger(__name__)

ROSTER_TABLE_ID = "roster"
PLAYER_DIRECTORY_TABLE_ID = "players"


def team_roster_url(bref_abbreviation: str, season: str | None = None) -> str:
    year = season_start_year(season or current_season())
    return f"{BREF_BASE_URL}/teams/{bref_abbreviation.upper()}/{year}.html"


def player_directory_url(letter: str) -> str:
    normalized = letter.strip().lower()
    if len(normalized) != 1 or not normalized.isalpha():
        raise ValueError("BRef player directory letter must be one alphabetic character")
    return f"{BREF_BASE_URL}/players/{normalized}/"


def player_profile_url(external_id: str) -> str:
    slug = external_id.strip().lower()
    if not re.fullmatch(r"[a-z0-9]+", slug):
        raise ValueError("BRef player profile key must be alphanumeric")
    return f"{BREF_BASE_URL}/players/{slug[0]}/{slug}.html"


def _find_roster_table(soup: BeautifulSoup) -> Tag | None:
    table = soup.find("table", id=ROSTER_TABLE_ID)
    if isinstance(table, Tag):
        return table
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if 'id="roster"' not in comment and "id='roster'" not in comment:
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        table = nested.find("table", id=ROSTER_TABLE_ID)
        if isinstance(table, Tag):
            return table
    return None


def _find_player_directory_table(soup: BeautifulSoup) -> Tag | None:
    table = soup.find("table", id=PLAYER_DIRECTORY_TABLE_ID)
    if isinstance(table, Tag):
        return table
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if f'id="{PLAYER_DIRECTORY_TABLE_ID}"' not in comment and (
            f"id='{PLAYER_DIRECTORY_TABLE_ID}'" not in comment
        ):
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        table = nested.find("table", id=PLAYER_DIRECTORY_TABLE_ID)
        if isinstance(table, Tag):
            return table
    return None


def _cell_text(row: Tag, stat: str) -> str | None:
    cell = row.find(["th", "td"], attrs={"data-stat": stat})
    if not isinstance(cell, Tag):
        return None
    return cell.get_text(" ", strip=True) or None


def _player_cell(row: Tag) -> tuple[str | None, str | None]:
    cell = row.find(["th", "td"], attrs={"data-stat": "player"})
    if not isinstance(cell, Tag):
        return None, None
    link = cell.find("a")
    if not isinstance(link, Tag):
        return None, cell.get_text(" ", strip=True) or None
    href = str(link.get("href") or "")
    match = PLAYER_HREF_RE.search(href)
    return (match.group(1).lower() if match else None), link.get_text(" ", strip=True) or None


def _parse_years(value: str | None) -> tuple[int | None, int | None]:
    years = [int(item) for item in re.findall(r"\b(\d{4})\b", value or "")]
    if not years:
        return None, None
    return min(years), max(years)


def parse_roster_html(html: str, *, team_id: Any, source_url: str) -> list[dict[str, Any]]:
    """Parse BRef's roster table into provider-keyed player records."""
    soup = BeautifulSoup(html, "html.parser")
    table = _find_roster_table(soup)
    if table is None:
        return []
    rows: list[dict[str, Any]] = []
    for row in table.select("tbody tr"):
        if not isinstance(row, Tag) or "thead" in (row.get("class") or []):
            continue
        slug, name = _player_cell(row)
        if not slug or not name or name.lower() == "player":
            continue
        first, _, last = name.partition(" ")
        from_year, to_year = _parse_years(_cell_text(row, "years"))
        rows.append(
            {
                "provider": BREF_PROVIDER,
                "external_id": slug,
                "source_url": source_url,
                "first_name": first,
                "last_name": last or first,
                "full_name": name,
                "player_name_normalized": normalize_player_name(name),
                "is_active": True,
                "jersey_number": _cell_text(row, "number"),
                "position": _cell_text(row, "pos"),
                "height": _cell_text(row, "height"),
                "weight": to_int(_cell_text(row, "weight")),
                "birth_date": _parse_birth_date(_cell_text(row, "birth_date")),
                "from_year": from_year,
                "to_year": to_year,
                "team_id": team_id,
            }
        )
    return rows


def parse_player_directory_html(html: str) -> dict[str, str]:
    """Parse one BRef alphabet directory into ``player slug -> full name``."""
    soup = BeautifulSoup(html, "html.parser")
    table = _find_player_directory_table(soup)
    if table is None:
        return {}
    names: dict[str, str] = {}
    for row in table.select("tbody tr"):
        if not isinstance(row, Tag) or "thead" in (row.get("class") or []):
            continue
        slug, name = _player_cell(row)
        if slug and name and name.lower() != "player":
            names[slug] = name
    return names


def parse_player_profile_html(html: str) -> str | None:
    """Read the canonical display name from a BRef player profile."""
    soup = BeautifulSoup(html, "html.parser")
    heading = soup.find("h1")
    if not isinstance(heading, Tag):
        return None
    name = heading.get_text(" ", strip=True)
    return name or None


def _parse_birth_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def scrape_players(
    *,
    season: str | None = None,
    fetch_html: Callable[[str], str] | None = None,
) -> int:
    """Load current rosters from Basketball-Reference team pages."""
    target_season = season or current_season()
    fetch = fetch_html or bref_get
    scraped_at = datetime.now()
    # Keep the HTTP phase outside the transaction while preserving deterministic order.
    from catalog.teams import TEAM_CATALOG

    all_rows: list[dict[str, Any]] = []
    for entry in TEAM_CATALOG:
        url = team_roster_url(entry.bref_abbreviation, target_season)
        try:
            all_rows.extend(parse_roster_html(fetch(url), team_id=entry.team_id, source_url=url))
        except Exception:
            logger.exception("BRef roster scrape failed for %s", url)

    directory_names: dict[str, str] = {}
    for letter in sorted({row["external_id"][0] for row in all_rows if row.get("external_id")}):
        url = player_directory_url(letter)
        try:
            directory_names.update(parse_player_directory_html(fetch(url)))
        except Exception:
            logger.exception("BRef player directory scrape failed for %s", url)

    existing_names: dict[str, str] = {}
    existing_abbreviated: set[str] = set()
    with get_session() as session:
        crosswalks = session.scalars(
            select(PlayerExternalId).where(PlayerExternalId.provider == BREF_PROVIDER)
        ).all()
        for crosswalk in crosswalks:
            external_id = str(crosswalk.external_id)
            player = session.get(Player, crosswalk.player_id) if crosswalk is not None else None
            name = getattr(player, "full_name", None)
            if not isinstance(name, str) or not name:
                continue
            if is_abbreviated_player_name(name):
                existing_abbreviated.add(external_id)
            else:
                existing_names[external_id] = name

    unresolved_slugs: set[str] = set(existing_abbreviated - directory_names.keys())
    for row in all_rows:
        external_id = row["external_id"]
        full_name = directory_names.get(external_id) or existing_names.get(external_id)
        if not full_name:
            unresolved_slugs.add(external_id)
            continue
        first, _, last = full_name.partition(" ")
        row.update(
            {
                "first_name": first,
                "last_name": last or first,
                "full_name": full_name,
                "player_name_normalized": normalize_player_name(full_name),
            }
        )

    profile_names: dict[str, str] = {}
    for external_id in sorted(unresolved_slugs):
        url = player_profile_url(external_id)
        try:
            full_name = parse_player_profile_html(fetch(url))
        except Exception:
            logger.exception("BRef player profile scrape failed for %s", url)
            continue
        if full_name:
            profile_names[external_id] = full_name
    for row in all_rows:
        full_name = profile_names.get(row["external_id"])
        if full_name:
            first, _, last = full_name.partition(" ")
            row.update(
                {
                    "first_name": first,
                    "last_name": last or first,
                    "full_name": full_name,
                    "player_name_normalized": normalize_player_name(full_name),
                }
            )

    roster_external_ids = {row["external_id"] for row in all_rows}
    existing_resolved = sum(
        1
        for external_id in existing_abbreviated
        if external_id not in roster_external_ids
        and (external_id in directory_names or external_id in profile_names)
    )
    logger.info(
        "Resolved player names: %s from directory, %s from profiles, %s from existing records",
        sum(1 for row in all_rows if row["external_id"] in directory_names),
        len(profile_names),
        existing_resolved,
    )

    written = 0
    with get_session() as session:
        seed_team_catalog(session, scraped_at=scraped_at)
        for external_id in existing_abbreviated:
            if external_id in roster_external_ids:
                continue
            full_name = directory_names.get(external_id) or profile_names.get(external_id)
            if not full_name:
                continue
            crosswalk = session.get(PlayerExternalId, (BREF_PROVIDER, external_id))
            player = session.get(Player, crosswalk.player_id) if crosswalk is not None else None
            if player is None:
                continue
            first, _, last = full_name.partition(" ")
            player.first_name = first
            player.last_name = last or first
            player.full_name = full_name
            player.scraped_at = scraped_at
        for row in all_rows:
            player_id = ensure_player(
                session,
                provider=row.pop("provider"),
                external_id=row.pop("external_id"),
                full_name=row.pop("full_name"),
                source_url=row.pop("source_url"),
                team_id=row.pop("team_id"),
                is_active=row.pop("is_active"),
                metadata={
                    key: value
                    for key, value in row.items()
                    if key not in {"first_name", "last_name"}
                },
            )
            player = session.get(Player, player_id)
            if player is None:
                continue
            for key, value in row.items():
                if hasattr(player, key) and value is not None:
                    setattr(player, key, value)
            player.scraped_at = scraped_at
            written += 1
    logger.info("Upserted %s BRef roster players for %s", written, target_season)
    return written


__all__ = [
    "parse_player_directory_html",
    "parse_player_profile_html",
    "parse_roster_html",
    "player_directory_url",
    "player_profile_url",
    "scrape_players",
    "team_roster_url",
]
