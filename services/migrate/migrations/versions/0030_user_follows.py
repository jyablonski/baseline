"""Let an account follow teams (and later players).

Revision ID: 0030_user_follows
Revises: 0029_prediction_breakdown
Create Date: 2026-11-14

One row per account and followed thing. `entity_id` is a Baseline UUID
(`dim_teams.team_id`, later `dim_players.player_id`); those survive a dbt
rebuild, so it needs no foreign key into gold, which a migration could not
reference anyway. The API checks the id exists before writing it.

`position` is the order the account chose (Account › Teams you follow), which
the header's team shortcuts follow. A new follow goes last.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0030_user_follows"
down_revision: str | Sequence[str] | None = "0029_prediction_breakdown"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE source.user_follows (
            user_id      UUID NOT NULL REFERENCES source.users(user_id) ON DELETE CASCADE,
            entity_type  VARCHAR(8) NOT NULL,
            entity_id    UUID NOT NULL,
            position     SMALLINT NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, entity_type, entity_id),
            CONSTRAINT user_follows_entity_type_check CHECK (entity_type IN ('team', 'player'))
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS source.user_follows")
