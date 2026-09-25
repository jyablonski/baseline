"""Add source.pipeline_runs.dbt_failed_nodes: which models/tests broke a dbt build.

Revision ID: 0019_dbt_failed_nodes
Revises: 0018_pipeline_ml_exit
Create Date: 2026-09-25

dbt_exit says a build failed, not what failed; that lived only in the cron log.
scripts/dbt-build.sh parses the "Failure in test x" / "Error in model y" lines
out of dbt's output and records them here as "<resource_type> <name>", so
/admin can name the broken nodes. Null when dbt passed or never ran; an empty
array means dbt failed before reporting any node (parse or connection error).

Revision id is short on purpose: alembic_version.version_num is VARCHAR(32).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0019_dbt_failed_nodes"
down_revision: str | Sequence[str] | None = "0018_pipeline_ml_exit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE source.pipeline_runs ADD COLUMN dbt_failed_nodes TEXT[]")


def downgrade() -> None:
    op.execute("ALTER TABLE source.pipeline_runs DROP COLUMN dbt_failed_nodes")
