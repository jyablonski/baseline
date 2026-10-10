"""Add user accounts, chat usage, picks, and feature flags.

Revision ID: 0025_user_accounts
Revises: 0024_game_broadcasts
Create Date: 2026-10-09

These are written by the API, not scraped, but live in source with the other
Alembic-owned tables. None of them is a dbt source or a Cube model.

users holds no email. (provider, provider_subject) is the provider's stable
account id, which identifies an account without being something to protect.

chat_usage is both the quota counter and the audit log. A row is inserted as
'pending' before any model call and settled afterwards; the partial unique
index allows one pending row per user, which is what stops a second request
from spending the last slot while the first is still running.

picks stores the pick and the moneyline it was taken at, never a grade.
Results come from gold at read time, so a corrected final score regrades
every pick without a backfill. stake is optional and has no cash value. There
is no balance to draw it from: an account starts at nothing and the only
figure kept is the net of what its settled stakes won and lost.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0025_user_accounts"
down_revision: str | Sequence[str] | None = "0024_game_broadcasts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE source.users (
            user_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider            VARCHAR(32) NOT NULL,
            provider_subject    VARCHAR(255) NOT NULL,
            display_name        VARCHAR(100),
            status              VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT users_provider_subject_key UNIQUE (provider, provider_subject),
            CONSTRAINT users_provider_check CHECK (provider IN ('github', 'google')),
            CONSTRAINT users_status_check CHECK (status IN ('active', 'blocked'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE source.chat_usage (
            usage_id        BIGSERIAL PRIMARY KEY,
            user_id         UUID NOT NULL REFERENCES source.users(user_id) ON DELETE CASCADE,
            asked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            usage_day       DATE NOT NULL,
            outcome         VARCHAR(20) NOT NULL DEFAULT 'pending',
            backend         VARCHAR(20),
            model           VARCHAR(100),
            input_tokens    INTEGER NOT NULL DEFAULT 0,
            output_tokens   INTEGER NOT NULL DEFAULT 0,
            tool_rounds     INTEGER NOT NULL DEFAULT 0,
            latency_ms      INTEGER,
            CONSTRAINT chat_usage_outcome_check
                CHECK (outcome IN ('pending', 'answered', 'refused', 'errored'))
        )
        """
    )
    op.execute("CREATE INDEX idx_chat_usage_user_day ON source.chat_usage (user_id, usage_day)")
    op.execute("CREATE INDEX idx_chat_usage_day ON source.chat_usage (usage_day)")
    op.execute(
        """
        CREATE UNIQUE INDEX chat_usage_single_pending
            ON source.chat_usage (user_id)
            WHERE outcome = 'pending'
        """
    )
    op.execute(
        """
        CREATE TABLE source.picks (
            pick_id         BIGSERIAL PRIMARY KEY,
            user_id         UUID NOT NULL REFERENCES source.users(user_id) ON DELETE CASCADE,
            game_id         UUID NOT NULL,
            picked_team_id  UUID NOT NULL,
            stake           INTEGER,
            moneyline       INTEGER,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT picks_user_game_key UNIQUE (user_id, game_id),
            CONSTRAINT picks_stake_check CHECK (stake IS NULL OR stake > 0),
            CONSTRAINT picks_stake_needs_price_check CHECK (stake IS NULL OR moneyline IS NOT NULL)
        )
        """
    )
    op.execute("CREATE INDEX idx_picks_game ON source.picks (game_id)")
    op.execute(
        """
        CREATE TABLE source.feature_flags (
            flag_key        VARCHAR(50) PRIMARY KEY,
            enabled         BOOLEAN NOT NULL,
            description     TEXT NOT NULL,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by      VARCHAR(100)
        )
        """
    )
    op.execute(
        """
        INSERT INTO source.feature_flags (flag_key, enabled, description) VALUES
            ('chatbot', TRUE, 'Signed-in chat at /chat. Off leaves the public rules-based /ask running.'),
            ('picks', TRUE, 'Signed-in game picks, with optional stakes, on /schedule and /picks.')
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS source.feature_flags")
    op.execute("DROP TABLE IF EXISTS source.picks")
    op.execute("DROP TABLE IF EXISTS source.chat_usage")
    op.execute("DROP TABLE IF EXISTS source.users")
