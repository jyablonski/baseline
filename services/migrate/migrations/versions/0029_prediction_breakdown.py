"""Store why each Elo prediction came out the way it did.

Revision ID: 0029_prediction_breakdown
Revises: 0028_game_log_rebound_split
Create Date: 2026-11-10

`breakdown` splits a pregame win probability into parts (team strength, home
court, and for Elo v2 / v3 the learned layer) in points of spread, plus the
model's settings on that run. Null for rows written before this column, for
backfilled replays and for logit, which is not split.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0029_prediction_breakdown"
down_revision: str | Sequence[str] | None = "0028_game_log_rebound_split"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE source.game_predictions ADD COLUMN breakdown JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE source.game_predictions DROP COLUMN breakdown")
