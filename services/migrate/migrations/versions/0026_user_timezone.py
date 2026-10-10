"""Add an optional display time zone to accounts.

Revision ID: 0026_user_timezone
Revises: 0025_user_accounts
Create Date: 2026-10-10

Null means the site default, Eastern. The value is an IANA name from the fixed
list the API accepts; it only changes how game times are drawn for that user.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0026_user_timezone"
down_revision: str | Sequence[str] | None = "0025_user_accounts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE source.users ADD COLUMN timezone VARCHAR(64)")


def downgrade() -> None:
    op.execute("ALTER TABLE source.users DROP COLUMN timezone")
