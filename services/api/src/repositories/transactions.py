from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from queries.transactions import (
    LIST_TRANSACTIONS,
    LIST_TRANSACTIONS_COUNT,
)


class TransactionsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_transactions(
        self,
        *,
        season: str | None,
        search: str | None,
        team_abbreviation: str | None,
        player_id: UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "season": season,
            # ILIKE needs the wildcards here, not in the SQL, so an unset
            # search stays NULL and short-circuits the filter.
            "search": f"%{search}%" if search else None,
            "team_abbreviation": team_abbreviation,
            "player_id": player_id,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_TRANSACTIONS_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_TRANSACTIONS, params)
        return int(total), [dict(row._mapping) for row in rows]
