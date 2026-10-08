"""Add national broadcast listings from ESPN's scoreboard.

Revision ID: 0024_game_broadcasts
Revises: 0023_unaccent_extension
Create Date: 2026-10-07
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0024_game_broadcasts"
down_revision: str | Sequence[str] | None = "0023_unaccent_extension"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE source.game_broadcasts (
            espn_event_id       VARCHAR(32) PRIMARY KEY,
            commence_time       TIMESTAMP NOT NULL,
            home_team_name      VARCHAR(100) NOT NULL,
            away_team_name      VARCHAR(100) NOT NULL,
            game_id             UUID REFERENCES source.games(game_id),
            national_tv         VARCHAR(200),
            scraped_at          TIMESTAMP NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX idx_game_broadcasts_game_id ON source.game_broadcasts(game_id)")


def downgrade() -> None:
    op.execute("DROP TABLE source.game_broadcasts")
