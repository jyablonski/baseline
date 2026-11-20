from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from queries.feedback import (
    COUNT_FEEDBACK,
    COUNT_FEEDBACK_FROM_IP_LAST_HOUR,
    COUNT_FEEDBACK_TODAY,
    INSERT_FEEDBACK,
    LIST_FEEDBACK,
    LOCK_FEEDBACK_LIMITS,
    SET_FEEDBACK_RESOLVED,
)


class FeedbackRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def lock_limits(self) -> None:
        """Serialise the limit checks and the insert; released when the transaction ends."""
        self.db.execute(LOCK_FEEDBACK_LIMITS)

    def count_from_ip_last_hour(self, ip_hash: str) -> int:
        return int(
            self.db.execute(COUNT_FEEDBACK_FROM_IP_LAST_HOUR, {"ip_hash": ip_hash}).scalar() or 0
        )

    def count_today(self) -> int:
        return int(self.db.execute(COUNT_FEEDBACK_TODAY).scalar() or 0)

    def insert(
        self,
        *,
        kind: str,
        message: str,
        reply_email: str | None,
        page_path: str | None,
        user_id: UUID | None,
        ip_hash: str,
    ) -> dict:
        row = (
            self.db.execute(
                INSERT_FEEDBACK,
                {
                    "kind": kind,
                    "message": message,
                    "reply_email": reply_email,
                    "page_path": page_path,
                    "user_id": user_id,
                    "ip_hash": ip_hash,
                },
            )
            .mappings()
            .one()
        )
        self.db.commit()
        return dict(row)

    def list_feedback(
        self, *, include_resolved: bool, limit: int, offset: int
    ) -> tuple[list[dict], int]:
        params = {"include_resolved": include_resolved}
        rows = (
            self.db.execute(LIST_FEEDBACK, {**params, "limit": limit, "offset": offset})
            .mappings()
            .all()
        )
        total = self.db.execute(COUNT_FEEDBACK, params).scalar() or 0
        return [dict(row) for row in rows], int(total)

    def set_resolved(self, feedback_id: UUID, *, resolved: bool) -> dict | None:
        row = (
            self.db.execute(
                SET_FEEDBACK_RESOLVED, {"feedback_id": feedback_id, "resolved": resolved}
            )
            .mappings()
            .one_or_none()
        )
        self.db.commit()
        return dict(row) if row is not None else None
