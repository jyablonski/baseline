"""Add source.host_snapshots: VM and container health for the /admin page.

Revision ID: 0020_host_snapshots
Revises: 0019_dbt_failed_nodes
Create Date: 2026-09-25

Per-container memory and inbound connection counts need `docker stats` /
`docker exec`, i.e. the Docker socket, which the API must never have. So the
host-side admin job runner (cron, every minute) runs scripts/host-snapshot.py
and inserts one row here; the API only reads the latest. The payload is JSONB
because it is a point-in-time report whose shape follows the collector, not
something queried relationally. The runner prunes rows older than 7 days.

Revision id is short on purpose: alembic_version.version_num is VARCHAR(32).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0020_host_snapshots"
down_revision: str | Sequence[str] | None = "0019_dbt_failed_nodes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE source.host_snapshots (
            snapshot_id     BIGSERIAL PRIMARY KEY,
            captured_at     TIMESTAMP NOT NULL DEFAULT NOW(),
            payload         JSONB NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_host_snapshots_captured ON source.host_snapshots (captured_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS source.host_snapshots")
