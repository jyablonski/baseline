"""Add offensive / defensive rebounds and personal fouls to player game logs.

Revision ID: 0028_game_log_rebound_split
Revises: 0027_model_promotion
Create Date: 2026-11-03

Team ratings need possessions (FGA - OREB + TOV + 0.44 * FTA), which the total
rebound column cannot give. Existing rows stay null until the next scrape-all,
which refetches any game whose logs lack the split.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_game_log_rebound_split"
down_revision: str | Sequence[str] | None = "0027_model_promotion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE source.player_game_logs
            ADD COLUMN orb INTEGER,
            ADD COLUMN drb INTEGER,
            ADD COLUMN pf INTEGER
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE source.player_game_logs
            DROP COLUMN pf,
            DROP COLUMN drb,
            DROP COLUMN orb
        """
    )
