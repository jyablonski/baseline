"""Store Basketball-Reference game start times in Eastern Time.

Revision ID: 0021_game_start_time_et
Revises: 0020_host_snapshots
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0021_game_start_time_et"
down_revision: str | Sequence[str] | None = "0020_host_snapshots"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE source.games ADD COLUMN start_time_et TIME")


def downgrade() -> None:
    op.execute("ALTER TABLE source.games DROP COLUMN start_time_et")
