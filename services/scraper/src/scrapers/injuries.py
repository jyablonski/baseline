"""Scrape the current Basketball-Reference injury report into source.player_injuries.

This is a forward-looking snapshot (who is listed today), not a historical
ledger. Each run upserts the current set and deletes rows that left the report.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime

from identity import BREF_PROVIDER, ensure_player, resolve_team_id, seed_team_catalog

from db import get_session, upsert_rows
from models import PlayerInjury, PlayerInjuryHistory
from queries.snapshots import DELETE_STALE_PLAYER_INJURIES
from scrapers import bref_get
from scrapers.injuries_parse import INJURIES_URL, parse_injuries_html

logger = logging.getLogger(__name__)


def scrape_injuries(*, fetch_html: Callable[[str], str] | None = None) -> int:
    """Replace the current injury snapshot. Returns upserted row count."""
    fetch = fetch_html or bref_get
    html = fetch(INJURIES_URL)
    scraped_at = datetime.now()
    rows = parse_injuries_html(html, source_url=INJURIES_URL)

    with get_session() as session:
        seed_team_catalog(session, scraped_at=scraped_at)
        canonical_rows = []
        for row in rows:
            team_id = resolve_team_id(session, row["bref_team_abbreviation"])
            if team_id is None or not row.get("bref_player_slug"):
                logger.warning("Skipping unresolved injury identity: %s", row)
                continue
            player_id = ensure_player(
                session,
                provider=BREF_PROVIDER,
                external_id=row["bref_player_slug"],
                full_name=row["player_name"],
                source_url=row["source_url"],
                team_id=team_id,
            )
            canonical_rows.append(
                {
                    "player_id": player_id,
                    "team_id": team_id,
                    "player_name": row["player_name"],
                    "player_name_normalized": row["player_name_normalized"],
                    "update_date": row["update_date"],
                    "description": row["description"],
                    "source_url": row["source_url"],
                    "scraped_at": scraped_at,
                }
            )
        written = upsert_rows(
            session,
            PlayerInjury,
            canonical_rows,
            ["player_id", "team_id"],
        )
        history_rows = [
            {
                **row,
                "snapshot_date": scraped_at.date(),
            }
            for row in canonical_rows
        ]
        upsert_rows(
            session,
            PlayerInjuryHistory,
            history_rows,
            ["player_id", "team_id", "snapshot_date"],
        )
        session.execute(DELETE_STALE_PLAYER_INJURIES, {"scraped_at": scraped_at})
        session.commit()
    logger.info("Upserted %s current injury rows from %s", written, INJURIES_URL)
    return written


__all__ = ["INJURIES_URL", "scrape_injuries"]
