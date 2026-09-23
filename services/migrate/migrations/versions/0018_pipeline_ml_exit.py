"""Add source.pipeline_runs.ml_exit: the scoring step's outcome for a refresh.

Revision ID: 0018_pipeline_ml_exit
Revises: 0017_transactions
Create Date: 2026-09-22

refresh-daily.sh already records dbt_exit onto the scrape's run row, but an ml
failure left no trace beyond predictions quietly going stale. Covers
`ml score` plus the dbt copy into gold.fct_game_predictions, the same pair the
`make ml` target runs. Null means the stage never ran (skipped scrape, dbt
failed first, or a run from before this column existed).

Revision id is short on purpose: alembic_version.version_num is VARCHAR(32).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0018_pipeline_ml_exit"
down_revision: str | Sequence[str] | None = "0017_transactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE source.pipeline_runs ADD COLUMN ml_exit INTEGER")


def downgrade() -> None:
    op.execute("ALTER TABLE source.pipeline_runs DROP COLUMN ml_exit")
