"""Store reports sent from the /feedback form.

Revision ID: 0031_feedback
Revises: 0030_user_follows
Create Date: 2026-11-19

Anyone may send one, signed in or not, so the table holds no raw IP address:
`ip_hash` is an HMAC of it, kept only so the API can count how often one
address has sent in the last hour. `user_id` is set when the sender was signed
in and is nulled, not cascaded, when the account is deleted: the report itself
is about the site, not the person.

The `feedback` flag is the kill switch if spam gets past the guards.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0031_feedback"
down_revision: str | Sequence[str] | None = "0030_user_follows"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE source.feedback (
            feedback_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind         VARCHAR(8) NOT NULL,
            message      TEXT NOT NULL,
            reply_email  VARCHAR(254),
            page_path    VARCHAR(512),
            user_id      UUID REFERENCES source.users(user_id) ON DELETE SET NULL,
            ip_hash      CHAR(64) NOT NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            resolved_at  TIMESTAMPTZ,
            CONSTRAINT feedback_kind_check CHECK (kind IN ('data', 'bug', 'idea', 'other'))
        )
        """
    )
    op.execute("CREATE INDEX feedback_ip_recent ON source.feedback (ip_hash, created_at)")
    op.execute(
        """
        INSERT INTO source.feature_flags (flag_key, enabled, description) VALUES
            ('feedback', TRUE, 'The public /feedback form. Off shows the contact email instead.')
        ON CONFLICT (flag_key) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute("DELETE FROM source.feature_flags WHERE flag_key = 'feedback'")
    op.execute("DROP TABLE IF EXISTS source.feedback")
