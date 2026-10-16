from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from queries.injuries import LIST_GAME_INJURIES, LIST_INJURIES


class InjuriesRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_injuries(self, *, team_id: UUID | None, notable: bool | None) -> list[dict]:
        rows = self.db.execute(LIST_INJURIES, {"team_id": team_id, "notable": notable})
        return [dict(row._mapping) for row in rows]

    def list_game_injuries(self, game_id: UUID) -> list[dict]:
        rows = self.db.execute(LIST_GAME_INJURIES, {"game_id": game_id})
        return [dict(row._mapping) for row in rows]
