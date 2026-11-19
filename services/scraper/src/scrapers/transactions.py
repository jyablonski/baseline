"""Scrape the Basketball-Reference season transactions log into source.

Grain is one row per transaction, keyed by sha256(date|description) — see
``transactions_parse.transaction_key``. Participants are a child table because
a single trade names several players and teams.

Be polite: BRef rate-limits aggressively. Runs whenever the pipeline is
``enabled`` — not behind ``season_active``, because free agency, buyouts, and
summer trades all land while the season gate is shut.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from identity import BREF_PROVIDER, resolve_player_id, resolve_team_id, seed_team_catalog

from db import get_session, upsert_rows
from models import Transaction, TransactionParticipant
from scrapers import BREF_BASE_URL, bref_get, current_season, season_start_year
from scrapers.transactions_parse import parse_transactions_html, transactions_url

logger = logging.getLogger(__name__)


def scrape_transactions(
    season: str | None = None,
    *,
    fetch_html: Callable[[str], str] | None = None,
) -> tuple[int, int]:
    """Upsert one season's transactions and their participants.

    Returns ``(transaction_rows, participant_rows)``.
    """
    target_season = season or current_season()
    # BRef names the page for the season's ending year: 2025-26 -> NBA_2026.
    url = transactions_url(season_start_year(target_season) + 1, BREF_BASE_URL)
    fetch = fetch_html or bref_get
    html = fetch(url)
    scraped_at = datetime.now()
    parsed = parse_transactions_html(html, season=target_season, source_url=url)
    if not parsed:
        logger.warning("No transactions parsed from %s", url)
        return (0, 0)

    with get_session() as session:
        seed_team_catalog(session, scraped_at=scraped_at)

        transaction_rows: list[dict[str, Any]] = []
        participant_rows: list[dict[str, Any]] = []
        for row in parsed:
            transaction_rows.append(
                {
                    "transaction_key": row["transaction_key"],
                    "transaction_date": row["transaction_date"],
                    "season": row["season"],
                    "description": row["description"],
                    "source_url": row["source_url"],
                    "scraped_at": scraped_at,
                }
            )
            for participant in row["participants"]:
                resolved = _resolve_participant(session, participant)
                if resolved is None:
                    continue
                participant_rows.append(
                    {
                        "transaction_key": row["transaction_key"],
                        "scraped_at": scraped_at,
                        **resolved,
                    }
                )

        # Parents first: participants carry the FK back to transactions.
        written_transactions = upsert_rows(
            session, Transaction, transaction_rows, ["transaction_key"]
        )
        written_participants = upsert_rows(
            session,
            TransactionParticipant,
            participant_rows,
            ["transaction_key", "participant_type", "bref_slug", "direction"],
        )

    logger.info(
        "Upserted %s transactions and %s participants for %s",
        written_transactions,
        written_participants,
        target_season,
    )
    return (written_transactions, written_participants)


def _resolve_participant(
    session: Any,
    participant: dict[str, Any],
) -> dict[str, Any] | None:
    """Attach a canonical id, or skip the row if the identity will not resolve.

    Resolve-only on purpose. ``ensure_player`` would create a player from a log
    entry such as "waived X" — transactions reference players, they do not
    define rosters. A player unseen by ``scrape-players`` is skipped here and
    picked up on a later run once the roster scrape knows about them.

    Skipping rather than raising matches injuries.py: an unknown slug is a data
    gap, not a reason to fail a run that collected everything else.
    """
    base = {
        "participant_type": participant["participant_type"],
        "direction": participant["direction"],
        "bref_slug": participant["bref_slug"],
        "display_name": participant["display_name"],
        "player_id": None,
        "team_id": None,
    }

    if participant["participant_type"] == "team":
        team_id = resolve_team_id(session, participant["bref_slug"])
        if team_id is None:
            logger.warning("Skipping unresolved transaction team: %s", participant)
            return None
        base["team_id"] = team_id
        return base

    player_id = resolve_player_id(
        session,
        provider=BREF_PROVIDER,
        external_id=participant["bref_slug"],
    )
    if player_id is None:
        logger.warning("Skipping unresolved transaction player: %s", participant)
        return None
    base["player_id"] = player_id
    return base
