"""SQL for the persisted ML artifact registry."""

from __future__ import annotations

from sqlalchemy import text

SELECT_MODEL_ARTIFACT = text(
    """
    SELECT model_version, model_name, artifact, trained_at, is_champion
    FROM source.model_artifacts
    WHERE model_version = :model_version
    """
)

UPDATE_MODEL_CHAMPION = text(
    """
    UPDATE source.model_artifacts
    SET is_champion = FALSE
    """
)

SET_MODEL_CHAMPION = text(
    """
    UPDATE source.model_artifacts
    SET is_champion = TRUE
    WHERE model_version = :model_version
    """
)

UPSERT_MODEL_ARTIFACT = text(
    """
    INSERT INTO source.model_artifacts (
        model_version,
        model_name,
        artifact,
        trained_at
    )
    VALUES (
        :model_version,
        :model_name,
        CAST(:artifact AS jsonb),
        :trained_at
    )
    ON CONFLICT (model_version) DO UPDATE SET
        model_name = EXCLUDED.model_name,
        artifact = EXCLUDED.artifact,
        trained_at = EXCLUDED.trained_at
    """
)

# Leaves an existing row (and its champion flag) untouched.
REGISTER_MODEL = text(
    """
    INSERT INTO source.model_artifacts (
        model_version,
        model_name,
        artifact,
        trained_at
    )
    VALUES (
        :model_version,
        :model_name,
        CAST(:artifact AS jsonb),
        :trained_at
    )
    ON CONFLICT (model_version) DO NOTHING
    """
)
