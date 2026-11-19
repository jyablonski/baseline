"""Canonical identity allocation and provider crosswalk helpers."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Any

from catalog.teams import TEAM_CATALOG, normalize_team_alias, team_by_alias
from sqlalchemy import select
from sqlalchemy.orm import Session

from models import (
    Game,
    GameExternalId,
    IdentityReviewQueue,
    Player,
    PlayerExternalId,
    Team,
    TeamAlias,
    TeamExternalId,
)

BREF_PROVIDER = "basketball-reference"
ODDS_PROVIDER = "the-odds-api"


class IdentityResolutionError(RuntimeError):
    """Raised when a provider row cannot be linked without guessing."""


def _pending_external_id(
    session: Session,
    model: type,
    provider: str,
    external_id: str,
) -> Any | None:
    for candidate in getattr(session, "new", ()):
        if (
            isinstance(candidate, model)
            and candidate.provider == provider
            and candidate.external_id == external_id
        ):
            return candidate
    return None


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return str(value)


def _record_issue(
    session: Session,
    *,
    entity_type: str,
    provider: str,
    external_id: str,
    reason: str,
    candidate_name: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    existing = session.scalar(
        select(IdentityReviewQueue).where(
            IdentityReviewQueue.entity_type == entity_type,
            IdentityReviewQueue.provider == provider,
            IdentityReviewQueue.external_id == external_id,
        )
    )
    if existing is None:
        session.add(
            IdentityReviewQueue(
                entity_type=entity_type,
                provider=provider,
                external_id=external_id,
                reason=reason,
                candidate_name=candidate_name,
                metadata_json=_json_safe(metadata),
            )
        )
    else:
        existing.reason = reason
        existing.candidate_name = candidate_name
        existing.metadata_json = _json_safe(metadata)
        existing.updated_at = datetime.now()


def _upsert_player_external_id(
    session: Session,
    *,
    player_id: uuid.UUID,
    provider: str,
    external_id: str,
    source_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    row = _pending_external_id(session, PlayerExternalId, provider, external_id) or session.get(
        PlayerExternalId, (provider, external_id)
    )
    now = datetime.now()
    if row is None:
        session.add(
            PlayerExternalId(
                player_id=player_id,
                provider=provider,
                external_id=external_id,
                source_url=source_url,
                first_seen_at=now,
                last_seen_at=now,
                metadata_json=_json_safe(metadata),
            )
        )
        return
    if row.player_id != player_id:
        raise IdentityResolutionError(
            f"{provider} player key {external_id!r} is already mapped to another player"
        )
    row.source_url = source_url or row.source_url
    row.last_seen_at = now
    if metadata:
        row.metadata_json = {**(row.metadata_json or {}), **_json_safe(metadata)}


def _upsert_team_external_id(
    session: Session,
    *,
    team_id: uuid.UUID,
    external_id: str,
    source_url: str | None = None,
    valid_from: date | None = None,
    valid_to: date | None = None,
) -> None:
    row = _pending_external_id(session, TeamExternalId, BREF_PROVIDER, external_id) or session.get(
        TeamExternalId, (BREF_PROVIDER, external_id)
    )
    if row is None:
        session.add(
            TeamExternalId(
                team_id=team_id,
                provider=BREF_PROVIDER,
                external_id=external_id,
                source_url=source_url,
                valid_from=valid_from,
                valid_to=valid_to,
            )
        )
        return
    if row.team_id != team_id:
        raise IdentityResolutionError(
            f"{BREF_PROVIDER} team key {external_id!r} is already mapped to another team"
        )
    row.source_url = source_url or row.source_url
    row.valid_from = valid_from or row.valid_from
    row.valid_to = valid_to or row.valid_to


def _upsert_game_external_id(
    session: Session,
    *,
    game_id: uuid.UUID,
    provider: str,
    external_id: str,
    source_url: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    row = _pending_external_id(session, GameExternalId, provider, external_id) or session.get(
        GameExternalId, (provider, external_id)
    )
    now = datetime.now()
    if row is None:
        session.add(
            GameExternalId(
                game_id=game_id,
                provider=provider,
                external_id=external_id,
                source_url=source_url,
                first_seen_at=now,
                last_seen_at=now,
                metadata_json=_json_safe(metadata),
            )
        )
        return
    if row.game_id != game_id:
        raise IdentityResolutionError(
            f"{provider} game key {external_id!r} is already mapped to another game"
        )
    row.source_url = source_url or row.source_url
    row.last_seen_at = now
    if metadata:
        row.metadata_json = {**(row.metadata_json or {}), **_json_safe(metadata)}


def seed_team_catalog(session: Session, *, scraped_at: datetime | None = None) -> int:
    """Load the explicit catalog and BRef crosswalk exactly once per run."""
    stamp = scraped_at or datetime.now()
    for entry in TEAM_CATALOG:
        team = session.get(Team, entry.team_id)
        values = {
            "canonical_slug": entry.canonical_slug,
            "abbreviation": entry.abbreviation,
            "full_name": entry.full_name,
            "city": entry.city,
            "nickname": entry.nickname,
            "conference": entry.conference,
            "division": entry.division,
            "scraped_at": stamp,
        }
        if team is None:
            session.add(Team(team_id=entry.team_id, **values))
        else:
            for key, value in values.items():
                setattr(team, key, value)
        _upsert_team_external_id(
            session, team_id=entry.team_id, external_id=entry.bref_abbreviation
        )
        aliases = {
            normalize_team_alias(alias)
            for alias in (
                entry.abbreviation,
                entry.bref_abbreviation,
                entry.canonical_slug,
                entry.full_name,
                *entry.aliases,
            )
        }
        for normalized in aliases:
            existing = session.scalar(
                select(TeamAlias).where(
                    TeamAlias.provider == "catalog", TeamAlias.alias == normalized
                )
            )
            if existing is None:
                session.add(TeamAlias(team_id=entry.team_id, provider="catalog", alias=normalized))
            elif existing.team_id != entry.team_id:
                raise IdentityResolutionError(
                    f"team catalog alias {normalized!r} maps to two teams"
                )
    session.flush()
    return len(TEAM_CATALOG)


def resolve_team_id(session: Session, value: str) -> uuid.UUID | None:
    entry = team_by_alias(value)
    if entry is not None:
        return entry.team_id
    external = session.get(TeamExternalId, (BREF_PROVIDER, value.strip().upper()))
    return external.team_id if external is not None else None


def resolve_player_id(
    session: Session,
    *,
    provider: str,
    external_id: str,
) -> uuid.UUID | None:
    """Look up a player by provider key without creating or mutating one.

    ``ensure_player`` is the write path and creates a player it has not seen,
    which is wrong for callers that merely *reference* one: a transactions log
    names players who are on no roster.
    """
    external_id = external_id.strip().lower()
    row = _pending_external_id(session, PlayerExternalId, provider, external_id) or session.get(
        PlayerExternalId, (provider, external_id)
    )
    return row.player_id if row is not None else None


def _split_player_name(name: str) -> tuple[str, str]:
    parts = " ".join(name.split()).strip().split(" ")
    if len(parts) < 2:
        return parts[0] if parts else "Unknown", ""
    return parts[0], " ".join(parts[1:])


_ABBREVIATED_FIRST_NAME_RE = re.compile(r"[A-Za-z]\.")


def is_abbreviated_player_name(name: str) -> bool:
    first = " ".join(name.split()).split(" ", 1)[0]
    return bool(_ABBREVIATED_FIRST_NAME_RE.fullmatch(first))


def _preferred_player_name(existing: str, incoming: str) -> str:
    existing = " ".join(existing.split()).strip()
    incoming = " ".join(incoming.split()).strip()
    if not incoming:
        return existing
    if (
        existing
        and is_abbreviated_player_name(incoming)
        and not is_abbreviated_player_name(existing)
    ):
        return existing
    return incoming


def ensure_player(
    session: Session,
    *,
    provider: str,
    external_id: str,
    full_name: str,
    source_url: str | None = None,
    team_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
    from_roster: bool = False,
) -> uuid.UUID:
    """Resolve a player by a provider key or create a new registry row.

    A provider key is mandatory for automatic creation. Names are retained as
    display metadata and are never used as a silent identity fallback.

    Only the roster scrape passes ``from_roster``, which moves the player to
    ``team_id`` and marks him active: a current roster is the one page that
    says who plays where today. Every other page names a team that may not be
    his (a contracts page keeps players it waived and still pays, a
    play-by-play row can sit in the opponent's column, a backfilled box score
    is an old team), so without ``from_roster`` ``team_id`` only fills an empty
    team, and a new player starts inactive until a roster lists him.
    """
    external_id = external_id.strip().lower()
    existing = _pending_external_id(
        session, PlayerExternalId, provider, external_id
    ) or session.get(PlayerExternalId, (provider, external_id))
    if existing is not None:
        player = session.get(Player, existing.player_id)
        if player is None:
            raise IdentityResolutionError(f"orphaned player crosswalk for {provider}:{external_id}")
        canonical_name = _preferred_player_name(player.full_name, full_name)
        player.full_name = canonical_name
        first, last = _split_player_name(canonical_name)
        player.first_name, player.last_name = first, last
        if team_id is not None and (from_roster or player.team_id is None):
            player.team_id = team_id
        if from_roster:
            player.is_active = True
        player.scraped_at = datetime.now()
        _upsert_player_external_id(
            session,
            player_id=player.player_id,
            provider=provider,
            external_id=external_id,
            source_url=source_url,
            metadata=metadata,
        )
        return player.player_id
    if not external_id or not full_name.strip():
        _record_issue(
            session,
            entity_type="player",
            provider=provider,
            external_id=external_id or "missing",
            reason="missing provider key or player name",
            candidate_name=full_name,
        )
        raise IdentityResolutionError("cannot create a player without a provider key and name")
    first, last = _split_player_name(full_name)
    player_id = uuid.uuid4()
    session.add(
        Player(
            player_id=player_id,
            first_name=first,
            last_name=last,
            full_name=full_name,
            is_active=from_roster,
            team_id=team_id,
        )
    )
    session.flush()
    _upsert_player_external_id(
        session,
        player_id=player_id,
        provider=provider,
        external_id=external_id,
        source_url=source_url,
        metadata=metadata,
    )
    return player_id


def resolve_game(
    session: Session,
    *,
    provider: str,
    external_id: str,
    season: str,
    season_type: str,
    game_date: date,
    home_team_id: uuid.UUID,
    away_team_id: uuid.UUID,
    source_url: str | None = None,
    values: dict[str, Any] | None = None,
) -> uuid.UUID:
    """Resolve by provider key, then by a unique schedule candidate."""
    external_id = external_id.strip()
    mapped = session.get(GameExternalId, (provider, external_id)) if external_id else None
    if mapped is not None:
        game = session.get(Game, mapped.game_id)
        if game is None:
            raise IdentityResolutionError(f"orphaned game crosswalk for {provider}:{external_id}")
        for key, value in (values or {}).items():
            setattr(game, key, value)
        game.season, game.season_type, game.game_date = season, season_type, game_date
        game.home_team_id, game.away_team_id = home_team_id, away_team_id
        game.scraped_at = datetime.now()
        _upsert_game_external_id(
            session,
            game_id=game.game_id,
            provider=provider,
            external_id=external_id,
            source_url=source_url,
        )
        return game.game_id

    candidates = session.scalars(
        select(Game).where(
            Game.season == season,
            Game.season_type == season_type,
            Game.game_date == game_date,
            Game.home_team_id == home_team_id,
            Game.away_team_id == away_team_id,
        )
    ).all()
    if len(candidates) > 1:
        _record_issue(
            session,
            entity_type="game",
            provider=provider,
            external_id=external_id,
            reason="ambiguous schedule candidate",
            metadata={"season": season, "game_date": game_date.isoformat()},
        )
        raise IdentityResolutionError(f"ambiguous game candidate for {provider}:{external_id}")
    game_id = candidates[0].game_id if candidates else uuid.uuid4()
    if not candidates:
        game_values = {
            "season": season,
            "season_type": season_type,
            "game_date": game_date,
            "home_team_id": home_team_id,
            "away_team_id": away_team_id,
            "status": "Scheduled",
        }
        game_values.update(values or {})
        session.add(Game(game_id=game_id, **game_values))
    else:
        game = candidates[0]
        for key, value in (values or {}).items():
            setattr(game, key, value)
    session.flush()
    if external_id:
        _upsert_game_external_id(
            session,
            game_id=game_id,
            provider=provider,
            external_id=external_id,
            source_url=source_url,
        )
    return game_id


__all__ = [
    "BREF_PROVIDER",
    "ODDS_PROVIDER",
    "IdentityResolutionError",
    "ensure_player",
    "is_abbreviated_player_name",
    "resolve_game",
    "resolve_player_id",
    "resolve_team_id",
    "seed_team_catalog",
]
