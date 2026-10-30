"""Record who promoted the champion model, and when.

Revision ID: 0027_model_promotion
Revises: 0026_user_timezone
Create Date: 2026-10-30

is_champion is now set from /admin rather than re-applied from an environment
variable on every ML run, so the row is the only record of the choice. Both
columns stay null for a champion that predates this.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0027_model_promotion"
down_revision: str | Sequence[str] | None = "0026_user_timezone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE source.model_artifacts
            ADD COLUMN promoted_at TIMESTAMPTZ,
            ADD COLUMN promoted_by VARCHAR(100)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE source.model_artifacts
            DROP COLUMN promoted_by,
            DROP COLUMN promoted_at
        """
    )
