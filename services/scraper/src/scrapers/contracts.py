"""Scrape remaining NBA player contracts from Basketball-Reference.

Current source is team payroll HTML at ``https://www.basketball-reference.com/contracts/{TEAM}.html``
(remaining multi-year salaries, not a historical paid-salary ledger).

Be polite: BRef rate-limits aggressively. Runs whenever the pipeline is
``enabled`` — not behind ``season_active``, because free agency, trades, and
extensions move payroll while the season gate is shut.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime
from typing import Any

from identity import BREF_PROVIDER, ensure_player, resolve_team_id, seed_team_catalog

from db import get_session, upsert_rows
from models import PlayerContract, TeamPayroll
from queries.snapshots import DELETE_STALE_PLAYER_CONTRACTS
from scrapers import BREF_BASE_URL, bref_get
from scrapers.contracts_parse import (
    BREF_TEAM_ABBREVIATIONS,
    parse_contracts_html,
    parse_team_list,
)

logger = logging.getLogger(__name__)


def team_contracts_url(bref_team_abbreviation: str) -> str:
    return f"{BREF_BASE_URL}/contracts/{bref_team_abbreviation.upper()}.html"


def scrape_contracts(
    teams: str | None = None,
    *,
    fetch_html: Callable[[str], str] | None = None,
) -> tuple[int, int]:
    """Upsert remaining contracts for one or more teams.

    Returns ``(player_contract_rows, team_payroll_rows)``.
    """
    team_list = parse_team_list(teams)
    fetch = fetch_html or bref_get
    scraped_at = datetime.now()
    player_rows: list[dict] = []
    payroll_rows: list[dict] = []

    for bref_abbr in team_list:
        url = team_contracts_url(bref_abbr)
        html = fetch(url)
        parsed_players, parsed_payroll = parse_contracts_html(
            html,
            bref_team_abbreviation=bref_abbr,
            source_url=url,
        )
        for row in parsed_players:
            row["scraped_at"] = scraped_at
        for row in parsed_payroll:
            row["scraped_at"] = scraped_at
        player_rows.extend(parsed_players)
        payroll_rows.extend(parsed_payroll)
        logger.info(
            "Parsed %s player-season rows and %s payroll rows from %s",
            len(parsed_players),
            len(parsed_payroll),
            url,
        )

    with get_session() as session:
        seed_team_catalog(session, scraped_at=scraped_at)
        canonical_players: list[dict[str, Any]] = []
        for row in player_rows:
            team_id = resolve_team_id(session, row["bref_team_abbreviation"])
            if team_id is None:
                logger.error("Unknown BRef team abbreviation %s", row["bref_team_abbreviation"])
                continue
            player_id = ensure_player(
                session,
                provider=BREF_PROVIDER,
                external_id=row["bref_player_slug"],
                full_name=row["player_name"],
                source_url=row["source_url"],
                team_id=team_id,
                is_active=True,
            )
            canonical_players.append(
                {
                    "player_id": player_id,
                    "team_id": team_id,
                    "player_name": row["player_name"],
                    "player_name_normalized": row["player_name_normalized"],
                    "season": row["season"],
                    "salary": row["salary"],
                    "is_fully_guaranteed": row["is_fully_guaranteed"],
                    "remaining_guaranteed": row["remaining_guaranteed"],
                    "player_age": row["player_age"],
                    "source_url": row["source_url"],
                    "scraped_at": scraped_at,
                }
            )
        canonical_payroll: list[dict[str, Any]] = []
        for row in payroll_rows:
            team_id = resolve_team_id(session, row["bref_team_abbreviation"])
            if team_id is None:
                continue
            canonical_payroll.append(
                {
                    "team_id": team_id,
                    "season": row["season"],
                    "total_salary": row["total_salary"],
                    "remaining_guaranteed": row["remaining_guaranteed"],
                    "source_url": row["source_url"],
                    "scraped_at": scraped_at,
                }
            )
        n_players = upsert_rows(
            session, PlayerContract, canonical_players, ["player_id", "team_id", "season"]
        )
        n_payroll = upsert_rows(session, TeamPayroll, canonical_payroll, ["team_id", "season"])
        # Only for teams whose page produced rows: an empty parse is a broken
        # page or parser, not a team that released its whole roster.
        for team_id in {row["team_id"] for row in canonical_players}:
            session.execute(
                DELETE_STALE_PLAYER_CONTRACTS,
                {"team_id": team_id, "scraped_at": scraped_at},
            )
        session.commit()
    logger.info(
        "Upserted %s player contracts and %s team payroll rows (teams=%s)",
        n_players,
        n_payroll,
        ",".join(team_list),
    )
    return n_players, n_payroll


__all__ = [
    "BREF_TEAM_ABBREVIATIONS",
    "bref_get",
    "scrape_contracts",
    "team_contracts_url",
]
