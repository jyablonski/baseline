"""Optional BRef play-by-play ingest for completed games."""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from uuid import UUID

from bs4 import BeautifulSoup, Comment, Tag
from identity import BREF_PROVIDER, ensure_player, resolve_team_id, seed_team_catalog
from sqlalchemy import select

from db import get_session, upsert_rows
from models import Game, GameExternalId, PlayByPlay, Player, Team
from scrapers import BREF_BASE_URL, bref_get, current_season, repair_mojibake, to_int, to_str

logger = logging.getLogger(__name__)


class NoFinalGamesError(RuntimeError):
    """Raised when there are no completed games to enrich."""


@dataclass(frozen=True)
class GameReference:
    game_id: UUID
    season: str
    home_bref_abbreviation: str | None = None
    away_bref_abbreviation: str | None = None


def play_by_play_url(external_id: str) -> str:
    return f"{BREF_BASE_URL}/boxscores/pbp/{external_id}.html"


def _find_table(soup: BeautifulSoup) -> Tag | None:
    table = soup.find("table", id="pbp")
    if isinstance(table, Tag):
        return table
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        if 'id="pbp"' not in comment and "id='pbp'" not in comment:  # ty: ignore[unsupported-operator]
            continue
        nested = BeautifulSoup(str(comment), "html.parser")
        table = nested.find("table", id="pbp")
        if isinstance(table, Tag):
            return table
    return None


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


def _linked_identity(row: Tag) -> tuple[list[tuple[str, str]], str | None]:
    """Linked players in document order, plus any linked team.

    BRef always writes the primary actor first ("X makes 2-pt layup (assist by
    Y)", "Turnover by X (steal by Y)", "Shooting foul by X (drawn by Y)", "X
    enters the game for Y"), so index 0 is the player the event is credited to
    and index 1 is the assister / stealer / blocker / fouled / subbed-out player.
    Taking the last link instead would credit the wrong player on every one of
    those events.
    """
    players: list[tuple[str, str]] = []
    team_abbreviation: str | None = None
    for link in row.find_all("a"):
        href = str(link.get("href") or "")  # ty: ignore[unresolved-attribute]
        player = re.search(r"/players/[a-z]/([a-z0-9]+)\.html", href, re.IGNORECASE)
        if player:
            name = link.get_text(" ", strip=True)
            if name:
                players.append((player.group(1).lower(), name))
        team = re.search(r"/teams/([A-Z]{3})/", href, re.IGNORECASE)
        if team:
            team_abbreviation = team.group(1).upper()
    return players, team_abbreviation


def _live_score(value: str | None) -> tuple[int | None, int | None]:
    match = re.fullmatch(r"\s*(\d+)\s*-\s*(\d+)\s*", value or "")
    if not match:
        return None, None
    away, home = (int(part) for part in match.groups())
    return home, away


def parse_play_by_play_html(
    html: str,
    *,
    game_id: UUID,
    season: str,
    home_bref_abbreviation: str | None = None,
    away_bref_abbreviation: str | None = None,
) -> list[dict[str, Any]]:
    table = _find_table(BeautifulSoup(html, "html.parser"))
    if table is None:
        return []
    rows: list[dict[str, Any]] = []
    period: int | None = None
    for number, row in enumerate(table.find_all("tr"), start=1):
        if not isinstance(row, Tag):
            continue
        if "thead" in (row.get("class") or []):
            match = re.fullmatch(r"q(\d+)", str(row.get("id") or ""))
            period = int(match.group(1)) if match else period
            continue
        cells = row.find_all(["th", "td"], recursive=False)
        live_layout = not any(cell.get("data-stat") for cell in cells)  # ty: ignore[unresolved-attribute]
        team: str | None = None
        if live_layout:
            if not cells or cells[0].get_text(" ", strip=True).casefold() == "time":
                continue
            candidates: list[tuple[Tag, str | None]] = []
            if len(cells) >= 6:
                candidates = [
                    (cells[1], away_bref_abbreviation),
                    (cells[5], home_bref_abbreviation),
                ]  # ty: ignore[invalid-assignment]
            elif len(cells) >= 2:
                candidates = [(cells[1], None)]  # ty: ignore[invalid-assignment]
            descriptions = [cell.get_text(" ", strip=True) for cell, _ in candidates]
            description = " | ".join(text for text in descriptions if text)
            for cell, candidate_team in candidates:
                if cell.get_text(" ", strip=True) and candidate_team:
                    team = candidate_team
                    break
            score_home, score_away = _live_score(
                cells[3].get_text(" ", strip=True) if len(cells) >= 4 else None
            )
            clock = cells[0].get_text(" ", strip=True) or None
        else:
            description = " | ".join(
                text for text in (_text(row, "a1"), _text(row, "a2"), _text(row, "a3")) if text
            )
            score_home = to_int(_text(row, "home_score"))
            score_away = to_int(_text(row, "away_score"))
            clock = _text(row, "time", "clock")

        if not description:
            continue
        linked_players, linked_team = _linked_identity(row)
        team = linked_team or team
        player_external_id, player_name = linked_players[0] if linked_players else (None, None)
        secondary_external_id, secondary_name = (
            linked_players[1] if len(linked_players) > 1 else (None, None)
        )
        rows.append(
            {
                "game_id": game_id,
                "season": season,
                "action_number": number,
                "action_id": number,
                "period": period if live_layout else to_int(_text(row, "quarter", "period")),
                "clock": clock,
                "score_home": score_home,
                "score_away": score_away,
                "team_bref_abbreviation": team,
                "player_external_id": player_external_id,
                "player_name": player_name,
                "secondary_player_external_id": secondary_external_id,
                "secondary_player_name": secondary_name,
                "action_type": None,
                "sub_type": None,
                "description": description,
                "extras": None,
            }
        )
    return rows


def map_play_by_play_action(
    raw: dict[str, Any], *, game_id: UUID, season: str, scraped_at: datetime
) -> dict[str, Any] | None:
    action_number = to_int(raw.get("action_number"))
    if action_number is None:
        return None
    return {
        "game_id": game_id,
        "season": season,
        "action_number": action_number,
        "action_id": to_int(raw.get("action_id")) or action_number,
        "period": to_int(raw.get("period")),
        "clock": to_str(raw.get("clock")),
        "score_home": to_int(raw.get("score_home")),
        "score_away": to_int(raw.get("score_away")),
        "team_id": raw.get("team_id"),
        "player_id": raw.get("player_id"),
        "secondary_player_id": raw.get("secondary_player_id"),
        "action_type": to_str(raw.get("action_type")),
        "sub_type": to_str(raw.get("sub_type")),
        "description": to_str(raw.get("description")),
        "extras": raw.get("extras"),
        "scraped_at": scraped_at,
    }


def _snapshot_games(session: Any, games: Sequence[Game]) -> list[GameReference]:
    team_ids = {
        team_id
        for game in games
        for team_id in (getattr(game, "home_team_id", None), getattr(game, "away_team_id", None))
        if team_id is not None
    }
    teams = {}
    if team_ids:
        teams = {
            row.team_id: row.abbreviation
            for row in session.query(Team).filter(Team.team_id.in_(team_ids)).all()
        }
    return [
        GameReference(
            game_id=game.game_id,
            season=game.season,
            home_bref_abbreviation=teams.get(getattr(game, "home_team_id", None)),
            away_bref_abbreviation=teams.get(getattr(game, "away_team_id", None)),
        )
        for game in games
    ]


def _final_games_for_season(season: str) -> list[GameReference]:
    with get_session() as session:
        games = (
            session.query(Game)
            .filter(Game.season == season, Game.status == "Final")
            .order_by(Game.game_date, Game.game_id)
            .all()
        )
        return _snapshot_games(session, games)


def games_missing_play_by_play(today: date | None = None) -> list[str]:
    """Final games of the current season with no play-by-play events yet.

    Keyed on missing events rather than missing box scores: BRef can publish
    the box score before the play-by-play page, and a game that already has
    logs would otherwise never be offered for play-by-play again.
    """
    target = today or date.today()
    has_events = select(PlayByPlay.game_id).where(PlayByPlay.game_id == Game.game_id).exists()
    with get_session() as session:
        rows = session.scalars(
            select(Game.game_id)
            .where(
                Game.season == current_season(target),
                Game.status == "Final",
                Game.game_date <= target,
                ~has_events,
            )
            .order_by(Game.game_date, Game.game_id)
        ).all()
    return [str(game_id) for game_id in rows]


def scrape_play_by_play(
    season: str | None = None,
    *,
    game_ids: Sequence[UUID | str] | None = None,
    refresh: bool = False,
    fetch_actions: Callable[[str], list[dict[str, Any]]] | None = None,
) -> int:
    target = season or current_season()
    with get_session() as session:
        queried_games = (
            _final_games_for_season(target)
            if game_ids is None
            else session.query(Game)
            .filter(Game.game_id.in_(list(game_ids)), Game.status == "Final")
            .all()
        )
        games = queried_games if game_ids is None else _snapshot_games(session, queried_games)  # ty: ignore[invalid-argument-type]
        if not games:
            if game_ids is not None and not game_ids:
                return 0
            raise NoFinalGamesError(
                f"No Final games in source.games for {target}; run scrape-games first."
            )
        external_rows = session.scalars(
            select(GameExternalId).where(
                GameExternalId.provider == BREF_PROVIDER,
                GameExternalId.game_id.in_([game.game_id for game in games]),
            )
        ).all()
        external_ids = {row.game_id: row.external_id for row in external_rows}
        existing_game_ids: set[UUID] = (
            set()
            if refresh
            else set(
                session.scalars(
                    select(PlayByPlay.game_id)
                    .where(PlayByPlay.game_id.in_([game.game_id for game in games]))
                    .distinct()
                ).all()
            )
        )

    def fetch(external_id: str, game: GameReference) -> list[dict[str, Any]]:
        if fetch_actions is not None:
            return fetch_actions(external_id)
        return parse_play_by_play_html(
            bref_get(play_by_play_url(external_id)),
            game_id=UUID(int=0),
            season=game.season,
            home_bref_abbreviation=game.home_bref_abbreviation,
            away_bref_abbreviation=game.away_bref_abbreviation,
        )

    total = 0
    stamp = datetime.now()
    total_games = len(games)
    checkpoint = max(1, total_games // 10)
    completed = 0
    skipped = 0
    failed = 0
    logger.info("Starting play-by-play scrape: %s game(s)", total_games)
    with get_session() as session:
        seed_team_catalog(session, scraped_at=stamp)
        for index, game in enumerate(games, start=1):
            if game.game_id in existing_game_ids:
                skipped += 1
                if index == 1 or index == total_games or index % checkpoint == 0:
                    logger.info(
                        "Play-by-play progress: %s/%s (%.0f%%); events=%s; skipped=%s; failed=%s; game=%s",
                        index,
                        total_games,
                        index / total_games * 100 if total_games else 100,
                        total,
                        skipped,
                        failed,
                        game.game_id,
                    )
                continue
            external_id = external_ids.get(game.game_id)
            if not external_id:
                failed += 1
                continue
            try:
                raw_rows = fetch(external_id, game)  # ty: ignore[invalid-argument-type]
            except Exception:
                failed += 1
                logger.exception("BRef play-by-play scrape failed for %s", external_id)
                if index == 1 or index == total_games or index % checkpoint == 0:
                    logger.info(
                        "Play-by-play progress: %s/%s (%.0f%%); events=%s; skipped=%s; failed=%s; game=%s",
                        index,
                        total_games,
                        index / total_games * 100 if total_games else 100,
                        total,
                        skipped,
                        failed,
                        external_id,
                    )
                continue
            mapped: list[dict[str, Any]] = []
            try:
                for raw in raw_rows:
                    raw["game_id"] = game.game_id
                    raw["season"] = game.season
                    team_id = resolve_team_id(session, raw.pop("team_bref_abbreviation", "") or "")
                    if team_id is not None:
                        raw["team_id"] = team_id
                    player_external_id = raw.pop("player_external_id", None)
                    player_name = raw.pop("player_name", None)
                    if player_external_id and player_name:
                        raw["player_id"] = ensure_player(
                            session,
                            provider=BREF_PROVIDER,
                            external_id=player_external_id,
                            full_name=player_name,
                            source_url=play_by_play_url(external_id),
                            team_id=team_id,
                            is_active=True,
                        )
                    secondary_external_id = raw.pop("secondary_player_external_id", None)
                    secondary_name = raw.pop("secondary_player_name", None)
                    if secondary_external_id and secondary_name:
                        # No team_id: the second player is often the opponent
                        # (stealer, blocker, fouled), so team must not be inferred here.
                        raw["secondary_player_id"] = ensure_player(
                            session,
                            provider=BREF_PROVIDER,
                            external_id=secondary_external_id,
                            full_name=secondary_name,
                            source_url=play_by_play_url(external_id),
                            is_active=True,
                        )
                    row = map_play_by_play_action(
                        raw, game_id=game.game_id, season=game.season, scraped_at=stamp
                    )
                    if row:
                        mapped.append(row)
                total += upsert_rows(
                    session, PlayByPlay, mapped, ["game_id", "action_number", "action_id"]
                )
                completed += 1
            except Exception:
                failed += 1
                session.rollback()
                seed_team_catalog(session, scraped_at=stamp)
                logger.exception("PBP mapping/upsert failed for %s", external_id)
            if index == 1 or index == total_games or index % checkpoint == 0:
                logger.info(
                    "Play-by-play progress: %s/%s (%.0f%%); events=%s; skipped=%s; failed=%s; game=%s",
                    index,
                    total_games,
                    index / total_games * 100 if total_games else 100,
                    total,
                    skipped,
                    failed,
                    external_id,
                )
        logger.info(
            "Completed play-by-play scrape: %s/%s games loaded; %s events upserted; %s skipped; %s failed",
            completed,
            total_games,
            total,
            skipped,
            failed,
        )
    return total


def repair_encoded_text() -> tuple[int, int]:
    """Repair player names and action descriptions stored as latin-1-decoded UTF-8.

    Rows ingested before the fetch layer pinned UTF-8 hold mojibake (JokiÄ‡).
    This is a pure string round-trip, so it does not need any BRef traffic;
    rows that are already clean are left untouched.
    """
    players_fixed = 0
    actions_fixed = 0
    with get_session() as session:
        for player in session.query(Player).all():
            repaired = repair_mojibake(player.full_name or "")
            if repaired and repaired != player.full_name:
                player.full_name = repaired
                first, last = (repaired.split(" ", 1) + [""])[:2]
                player.first_name, player.last_name = first, last or None  # ty: ignore[invalid-assignment]
                players_fixed += 1
        for action in session.query(PlayByPlay).filter(PlayByPlay.description.isnot(None)).all():
            repaired = repair_mojibake(action.description or "")
            if repaired != action.description:
                action.description = repaired
                actions_fixed += 1
    logger.info(
        "Encoding repair: %s player name(s), %s play-by-play description(s)",
        players_fixed,
        actions_fixed,
    )
    return players_fixed, actions_fixed


__all__ = [
    "GameReference",
    "NoFinalGamesError",
    "games_missing_play_by_play",
    "map_play_by_play_action",
    "parse_play_by_play_html",
    "play_by_play_url",
    "repair_encoded_text",
    "scrape_play_by_play",
]
