from __future__ import annotations

from sqlalchemy.orm import Session

from queries.account import FLAG_ENABLED, LIST_FLAGS, SET_FLAG


class FlagsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_flags(self) -> list[dict]:
        return [dict(row) for row in self.db.execute(LIST_FLAGS).mappings().all()]

    def is_enabled(self, flag_key: str) -> bool:
        """Fails closed: a flag with no row is off, not on."""
        enabled = self.db.execute(FLAG_ENABLED, {"flag_key": flag_key}).scalar()
        return bool(enabled)

    def set_flag(self, flag_key: str, *, enabled: bool, updated_by: str) -> dict | None:
        row = (
            self.db.execute(
                SET_FLAG,
                {"flag_key": flag_key, "enabled": enabled, "updated_by": updated_by},
            )
            .mappings()
            .one_or_none()
        )
        self.db.commit()
        return dict(row) if row is not None else None
