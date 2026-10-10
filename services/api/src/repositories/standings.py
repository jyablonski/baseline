from __future__ import annotations

from datetime import date
from uuid import UUID

from baseline_analytics.standings_rank import apply_derived_ranks
from sqlalchemy.orm import Session

from queries.standings import LIST_STANDINGS, LIST_STANDINGS_COUNT, TEAM_STANDING


class StandingsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_standings(
        self,
        *,
        season: str | None,
        conference: str | None,
        as_of: date | None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "season": season,
            "conference": conference,
            "as_of": as_of,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_STANDINGS_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_STANDINGS, params)
        return int(total), apply_derived_ranks([dict(row._mapping) for row in rows])

    def get_team_standing(self, team_id: UUID, season: str | None = None) -> dict | None:
        row = (
            self.db.execute(
                TEAM_STANDING,
                {
                    "team_id": team_id,
                    "season": season,
                    "conference": None,
                    "as_of": None,
                },
            )
            .mappings()
            .first()
        )
        return dict(row) if row is not None else None
