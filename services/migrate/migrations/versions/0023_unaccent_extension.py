"""Enable unaccent so dbt can fold diacritics out of player names.

Revision ID: 0023_unaccent_extension
Revises: 0022_game_predictions_grain
Create Date: 2026-10-05
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0023_unaccent_extension"
down_revision: str | Sequence[str] | None = "0022_game_predictions_grain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade() -> None:
    # Left installed: dbt models built on it would fail until rebuilt without it.
    pass
