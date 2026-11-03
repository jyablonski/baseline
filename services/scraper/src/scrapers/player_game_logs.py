"""Scrape player box-score rows from Basketball-Reference game pages."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from bs4 import BeautifulSoup, Comment, Tag
from catalog.teams import team_by_alias
from identity import BREF_PROVIDER, ensure_player, resolve_team_id, seed_team_catalog
from sqlalchemy import select

from db import get_session, upsert_rows
from models import Game, GameExternalId, Player, PlayerGameLog, Team
from scrapers import BREF_BASE_URL, bref_get, parse_minutes, to_float, to_int

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GameReference:
    game_id: UUID
    season: str
    game_date: Any
    home_team_id: UUID
    away_team_id: UUID
    home_score: int | None
    away_score: int | None
    status: str


def boxscore_url(external_id: str) -> str:
    return f"{BREF_BASE_URL}/boxscores/{external_id}.html"


def _tables(soup: BeautifulSoup) -> list[Tag]:
    direct = [
        table
        for table in soup.find_all("table")
        if isinstance(table, Tag) and _is_game_basic_table(table)
    ]
    if direct:
        return direct
    found: list[Tag] = []
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if "box-score" not in comment:  # ty: ignore[unsupported-operator]
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        found.extend(
            table
            for table in nested.find_all("table")
            if isinstance(table, Tag) and _is_game_basic_table(table)
        )
    return found


def _is_game_basic_table(table: Tag) -> bool:
    table_id = str(table.get("id") or "")
    return bool(
        re.fullmatch(r"box-[A-Z]{3}-game-basic", table_id, re.IGNORECASE)
        or re.fullmatch(r"box-score-[A-Z]{3}", table_id, re.IGNORECASE)
    )


def _cell(row: Tag, stat: str) -> Tag | None:
    cell = row.find(["th", "td"], attrs={"data-stat": stat})
    return cell if isinstance(cell, Tag) else None


def _text(row: Tag, stat: str) -> str | None:
    cell = _cell(row, stat)
    if not isinstance(cell, Tag):
        return None
    value = cell.get("csk") or cell.get_text(" ", strip=True)
    return str(value).strip() or None


def _visible_text(row: Tag, stat: str) -> str | None:
    cell = _cell(row, stat)
    if not isinstance(cell, Tag):
        return None
    return cell.get_text(" ", strip=True) or None


def _team_code(table: Tag) -> str | None:
    link = table.find("a", href=re.compile(r"/teams/[A-Z]{3}/"))
    if not isinstance(link, Tag):
        match = re.search(
            r"box-(?:score-)?([A-Z]{3})(?:-|$)", str(table.get("id") or ""), re.IGNORECASE
        )
        return match.group(1).upper() if match else None
    match = re.search(r"/teams/([A-Z]{3})/", str(link.get("href") or ""), re.IGNORECASE)
    return match.group(1).upper() if match else None


def _player(row: Tag) -> tuple[str | None, str | None]:
    cell = _cell(row, "player")
    link = (
        cell.find("a", href=re.compile(r"/players/[a-z]/[a-z0-9]+\.html", re.IGNORECASE))
        if isinstance(cell, Tag)
        else None
    )
    if not isinstance(link, Tag):
        return None, None
    match = re.search(
        r"/players/[a-z]/([a-z0-9]+)\.html", str(link.get("href") or ""), re.IGNORECASE
    )
    return (match.group(1).lower() if match else None), link.get_text(" ", strip=True) or None


def _made(value: str | None) -> int | None:
    return to_int((value or "").split("-", 1)[0])


def _attempted(value: str | None) -> int | None:
    parts = (value or "").split("-", 1)
    return to_int(parts[1]) if len(parts) == 2 else None


def parse_boxscore_html(
    html: str, *, game_id: UUID, game_date: Any, season: str
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for table in _tables(BeautifulSoup(html, "html.parser")):
        team = _team_code(table)
        if team is None:
            continue
        for row in table.select("tbody tr"):
            if not isinstance(row, Tag) or "thead" in (row.get("class") or []):
                continue
            slug, name = _player(row)
            if not slug or not name or name.lower() in {"team totals", "reserves"}:
                continue
            rows.append(
                {
                    "provider": BREF_PROVIDER,
                    "external_id": slug,
                    "full_name": name,
                    "game_id": game_id,
                    "team_bref_abbreviation": team,
                    "game_date": game_date,
                    "season": season,
                    "matchup": team,
                    "wl": None,
                    "min": parse_minutes(_visible_text(row, "mp")),
                    "pts": to_int(_text(row, "pts")),
                    "reb": to_int(_text(row, "trb")),
                    "orb": to_int(_text(row, "orb")),
                    "drb": to_int(_text(row, "drb")),
                    "ast": to_int(_text(row, "ast")),
                    "stl": to_int(_text(row, "stl")),
                    "blk": to_int(_text(row, "blk")),
                    "tov": to_int(_text(row, "tov")),
                    "fgm": _made(_text(row, "fg")),
                    "fga": _attempted(_text(row, "fg")) or to_int(_text(row, "fga")),
                    "fg_pct": to_float(_text(row, "fg_pct")),
                    "fg3m": _made(_text(row, "fg3")),
                    "fg3a": _attempted(_text(row, "fg3")) or to_int(_text(row, "fg3a")),
                    "fg3_pct": to_float(_text(row, "fg3_pct")),
                    "ftm": _made(_text(row, "ft")),
                    "fta": _attempted(_text(row, "ft")) or to_int(_text(row, "fta")),
                    "ft_pct": to_float(_text(row, "ft_pct")),
                    "pf": to_int(_text(row, "pf")),
                    "plus_minus": to_int(_text(row, "plus_minus")),
                }
            )
    return rows


def _game_external_ids(session: Any, games: Sequence[Game]) -> dict[UUID, str]:
    game_ids = [game.game_id for game in games]
    if not game_ids:
        return {}
    rows = session.scalars(
        select(GameExternalId).where(
            GameExternalId.provider == BREF_PROVIDER, GameExternalId.game_id.in_(game_ids)
        )
    ).all()
    return {row.game_id: row.external_id for row in rows}


def _scrape_games(
    games: Sequence[GameReference],
    *,
    fetch_html: Callable[[str], str] | None = None,
    active_player_ids: set[UUID] | None = None,
) -> int:
    fetch = fetch_html or bref_get
    total = 0
    stamp = datetime.now()
    with get_session() as session:
        seed_team_catalog(session, scraped_at=stamp)
        external_ids = _game_external_ids(session, games)  # ty: ignore[invalid-argument-type]
        canonical_games = {game.game_id: game for game in games}
        total_games = len(external_ids)
        checkpoint = max(1, total_games // 10)
        completed = 0
        skipped = 0
        failed = 0
        existing_game_ids = set()
        if active_player_ids is None and external_ids:
            # A game counts as loaded only once its logs carry the rebound split,
            # so a season scraped before orb/drb existed is refetched by the next
            # scrape-all rather than skipped.
            existing_game_ids = set(
                session.scalars(
                    select(PlayerGameLog.game_id)
                    .where(
                        PlayerGameLog.game_id.in_(list(external_ids)),
                        PlayerGameLog.orb.is_not(None),
                    )
                    .distinct()
                ).all()
            )
        logger.info(
            "Starting player game-log scrape: %s game(s), %s already loaded",
            total_games,
            len(existing_game_ids),
        )
        for index, (game_id, external_id) in enumerate(external_ids.items(), start=1):
            if game_id in existing_game_ids:
                skipped += 1
                if index == 1 or index == total_games or index % checkpoint == 0:
                    logger.info(
                        "Player game-log progress: %s/%s (%.0f%%); rows=%s; skipped=%s; failed=%s; game=%s",
                        index,
                        total_games,
                        index / total_games * 100 if total_games else 100,
                        total,
                        skipped,
                        failed,
                        external_id,
                    )
                continue
            try:
                parsed = parse_boxscore_html(
                    fetch(boxscore_url(external_id)),
                    game_id=game_id,
                    game_date=canonical_games[game_id].game_date,
                    season=canonical_games[game_id].season,
                )
            except Exception:
                failed += 1
                logger.exception("BRef box score scrape failed for %s", external_id)
                if index == 1 or index == total_games or index % checkpoint == 0:
                    logger.info(
                        "Player game-log progress: %s/%s (%.0f%%); rows=%s; skipped=%s; failed=%s; game=%s",
                        index,
                        total_games,
                        index / total_games * 100 if total_games else 100,
                        total,
                        skipped,
                        failed,
                        external_id,
                    )
                continue
            teams = {
                team.team_id: team
                for team in session.query(Team)
                .filter(
                    Team.team_id.in_(
                        [
                            canonical_games[game_id].home_team_id,
                            canonical_games[game_id].away_team_id,
                        ]
                    )
                )
                .all()
            }
            game = canonical_games[game_id]
            rows: list[dict[str, Any]] = []
            for row in parsed:
                team_code = row.pop("team_bref_abbreviation")
                team_id = resolve_team_id(session, team_code)
                if team_id is None:
                    continue
                player_id = ensure_player(
                    session,
                    provider=row.pop("provider"),
                    external_id=row.pop("external_id"),
                    full_name=row.pop("full_name"),
                    source_url=boxscore_url(external_id),
                    team_id=team_id,
                    is_active=True,
                )
                if active_player_ids is not None and player_id not in active_player_ids:
                    continue
                row["player_id"] = player_id
                row["team_id"] = team_id
                team_entry = team_by_alias(team_code)
                if team_entry is None:
                    continue
                if team_id == game.home_team_id:
                    opponent = teams.get(game.away_team_id)
                    row["matchup"] = (
                        f"{team_entry.abbreviation} vs. {opponent.abbreviation if opponent else 'UNK'}"
                    )
                    row["wl"] = (
                        "W"
                        if game.home_score is not None
                        and game.away_score is not None
                        and game.home_score > game.away_score
                        else "L"
                    )
                else:
                    opponent = teams.get(game.home_team_id)
                    row["matchup"] = (
                        f"{team_entry.abbreviation} @ {opponent.abbreviation if opponent else 'UNK'}"
                    )
                    row["wl"] = (
                        "W"
                        if game.home_score is not None
                        and game.away_score is not None
                        and game.away_score > game.home_score
                        else "L"
                    )
                row["scraped_at"] = stamp
                rows.append(row)
            total += upsert_rows(session, PlayerGameLog, rows, ["player_id", "game_id"])
            completed += 1
            if index == 1 or index == total_games or index % checkpoint == 0:
                logger.info(
                    "Player game-log progress: %s/%s (%.0f%%); rows=%s; skipped=%s; failed=%s; game=%s",
                    index,
                    total_games,
                    index / total_games * 100 if total_games else 100,
                    total,
                    skipped,
                    failed,
                    external_id,
                )
        logger.info(
            "Completed player game-log scrape: %s/%s games parsed; %s rows upserted; %s skipped; %s failed",
            completed,
            total_games,
            total,
            skipped,
            failed,
        )
    return total


def _game_reference(game: Game) -> GameReference:
    return GameReference(
        game_id=game.game_id,
        season=game.season,
        game_date=game.game_date,
        home_team_id=game.home_team_id,
        away_team_id=game.away_team_id,
        home_score=game.home_score,
        away_score=game.away_score,
        status=game.status,
    )


def _final_games_for_season(season: str) -> list[GameReference]:
    with get_session() as session:
        games = (
            session.query(Game)
            .filter(Game.season == season, Game.status == "Final")
            .order_by(Game.game_date, Game.game_id)
            .all()
        )
        return [_game_reference(game) for game in games]


def scrape_player_game_logs(season: str, *, active_only: bool = False) -> int:
    active_player_ids = (
        set(_player_ids_for_season(season, active_only=True)) if active_only else None
    )
    return _scrape_games(_final_games_for_season(season), active_player_ids=active_player_ids)


def scrape_logs_for_games(
    games: list[dict], *, fetch_html: Callable[[str], str] | None = None
) -> int:
    ids = {UUID(str(game["game_id"])) for game in games if game.get("game_id")}
    if not ids:
        return 0
    with get_session() as session:
        rows = session.query(Game).filter(Game.game_id.in_(list(ids)), Game.status == "Final").all()
        references = [_game_reference(game) for game in rows]
    return _scrape_games(references, fetch_html=fetch_html)


def _ensure_reference_data(season: str) -> None:
    from scrapers.games import scrape_games
    from scrapers.players import scrape_players
    from scrapers.teams import scrape_teams

    scrape_teams()
    with get_session() as session:
        has_players = session.query(Player.player_id).first() is not None
        has_games = session.query(Game.game_id).filter(Game.season == season).first() is not None
    if not has_players:
        scrape_players(season=season)
    if not has_games:
        scrape_games(season)


def _player_ids_for_season(season: str, *, active_only: bool = False) -> list[UUID]:
    with get_session() as session:
        query = session.query(Player.player_id)
        if active_only:
            query = query.filter(Player.is_active.is_(True))
        return [row[0] for row in query.all()]


__all__ = [
    "_ensure_reference_data",
    "_player_ids_for_season",
    "boxscore_url",
    "parse_boxscore_html",
    "scrape_logs_for_games",
    "scrape_player_game_logs",
]
