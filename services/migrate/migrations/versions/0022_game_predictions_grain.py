"""Keep one prediction per game and model version, overwritten in place.

Revision ID: 0022_game_predictions_grain
Revises: 0021_game_start_time_et
Create Date: 2026-10-05

The daily score run used to append a row per game per run. Only the latest
pregame row was ever read, so collapse to that row and key on it.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0022_game_predictions_grain"
down_revision: str | Sequence[str] | None = "0021_game_start_time_et"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Survivor is the row gold already shows: the latest one stamped on or
    # before game day. A later row is never graded, so it only wins when a game
    # has nothing else.
    op.execute(
        """
        WITH ranked_predictions AS (
            SELECT
                game_predictions.id,
                row_number() OVER (
                    PARTITION BY
                        game_predictions.game_id,
                        game_predictions.model_version
                    ORDER BY
                        (game_predictions.as_of::date <= games.game_date) DESC,
                        game_predictions.as_of DESC,
                        game_predictions.id DESC
                ) AS prediction_rank
            FROM source.game_predictions
            INNER JOIN source.games
                ON game_predictions.game_id = games.game_id
        )
        DELETE FROM source.game_predictions
        USING ranked_predictions
        WHERE
            game_predictions.id = ranked_predictions.id
            AND ranked_predictions.prediction_rank > 1
        """
    )
    op.execute(
        """
        ALTER TABLE source.game_predictions
            DROP CONSTRAINT game_predictions_game_id_as_of_model_version_key
        """
    )
    op.execute(
        """
        ALTER TABLE source.game_predictions
            ADD CONSTRAINT game_predictions_game_id_model_version_key
            UNIQUE (game_id, model_version)
        """
    )


def downgrade() -> None:
    # The collapsed history is not restored.
    op.execute(
        """
        ALTER TABLE source.game_predictions
            DROP CONSTRAINT game_predictions_game_id_model_version_key
        """
    )
    op.execute(
        """
        ALTER TABLE source.game_predictions
            ADD CONSTRAINT game_predictions_game_id_as_of_model_version_key
            UNIQUE (game_id, as_of, model_version)
        """
    )
