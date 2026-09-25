"""Alembic env + upgrade-head checks.

Alembic owns source-schema tables only. It must not CREATE silver/gold
models (staging, intermediate, dims, facts) — dbt builds those.

Unit tests do not need Docker. Integration tests apply revisions to a
throwaway Postgres (Testcontainers).
"""

from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from testing.postgres_tc import docker_available, start_postgres_container

MIGRATE_DIR = Path(__file__).resolve().parents[1]

EXPECTED_SOURCE_TABLES = {
    "players",
    "teams",
    "games",
    "player_game_logs",
    "player_contracts",
    "team_payroll",
    "standings",
    "reddit_posts",
    "reddit_comments",
    "player_injuries",
    "player_injuries_history",
    "game_odds",
    "game_predictions",
    "model_artifacts",
    "model_evaluations",
    "play_by_play",
    "player_external_ids",
    "team_external_ids",
    "game_external_ids",
    "team_aliases",
    "identity_review_queue",
    "scrape_pipeline",
    "pipeline_runs",
    "scrape_source_runs",
    "admin_jobs",
    "host_snapshots",
    "transactions",
    "transaction_participants",
}


def _alembic_upgrade(database_url: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=MIGRATE_DIR,
        env=env,
        check=True,
    )


def _tables_in_schema(engine: Engine, schema: str) -> set[str]:
    with engine.connect() as conn:
        result = conn.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = :schema
                  AND table_type IN ('BASE TABLE', 'VIEW')
                """
            ),
            {"schema": schema},
        )
        return {row[0] for row in result}


def _revision_graph() -> dict[str, str | None]:
    """Map revision id -> down_revision by reading the versions directory.

    Deliberately not via Alembic's ScriptDirectory so this stays usable from
    unit tests with no config or database.
    """
    versions = MIGRATE_DIR / "migrations" / "versions"
    revisions: dict[str, str | None] = {}
    for path in sorted(versions.glob("*.py")):
        text_body = path.read_text(encoding="utf-8")
        revision = re.search(r'^revision: str = "([^"]+)"', text_body, re.MULTILINE)
        down = re.search(
            r"^down_revision: str \| Sequence\[str\] \| None = (?:\"([^\"]+)\"|None)",
            text_body,
            re.MULTILINE,
        )
        assert revision is not None, f"{path.name} has no revision id"
        assert down is not None, f"{path.name} has no down_revision"
        revisions[revision.group(1)] = down.group(1)
    return revisions


def _head_revision() -> str:
    revisions = _revision_graph()
    heads = set(revisions) - {down for down in revisions.values() if down is not None}
    assert len(heads) == 1, f"expected exactly one head, found {sorted(heads)}"
    return heads.pop()


@pytest.mark.unit
def test_revision_chain_has_exactly_one_head() -> None:
    """Two revisions sharing a down_revision break `alembic upgrade head`.

    Cheap to do by accident whenever migrations are written on parallel
    branches, and otherwise only surfaces against a real database.
    """
    revisions = _revision_graph()
    assert revisions, "no Alembic revisions found"
    # alembic_version.version_num is VARCHAR(32).
    for revision_id in revisions:
        assert len(revision_id) <= 32, f"revision id too long: {revision_id}"

    parents = {down for down in revisions.values() if down is not None}
    heads = set(revisions) - parents
    assert len(heads) == 1, f"expected exactly one head, found {sorted(heads)}"

    bases = [rev for rev, down in revisions.items() if down is None]
    assert len(bases) == 1, f"expected exactly one base, found {sorted(bases)}"

    missing = parents - set(revisions)
    assert not missing, f"down_revision points at unknown revisions: {sorted(missing)}"


@pytest.mark.unit
def test_alembic_ini_and_env_load() -> None:
    ini = (MIGRATE_DIR / "alembic.ini").read_text(encoding="utf-8")
    assert "script_location = migrations" in ini
    env_py = (MIGRATE_DIR / "migrations" / "env.py").read_text(encoding="utf-8")
    assert "DATABASE_URL" in env_py
    assert "target_metadata = None" in env_py
    revision = (MIGRATE_DIR / "migrations" / "versions" / "0001_baseline_source.py").read_text(
        encoding="utf-8"
    )
    assert "CREATE TABLE source.players" in revision
    assert "CREATE TABLE source.scrape_pipeline" in revision
    assert "CREATE TABLE source.pipeline_runs" in revision
    lowered = revision.lower()
    assert "create table silver." not in lowered
    assert "create table gold." not in lowered
    assert "create view silver." not in lowered
    assert "create view gold." not in lowered
    assert "stg_" not in lowered
    assert "int_" not in lowered
    assert "dim_" not in lowered
    assert "fct_" not in lowered

    standings = (MIGRATE_DIR / "migrations" / "versions" / "0002_source_standings.py").read_text(
        encoding="utf-8"
    )
    assert 'revision: str = "0002_source_standings"' in standings
    assert "CREATE TABLE source.standings" in standings
    assert "UNIQUE (season, season_type, team_id)" in standings
    standings_lowered = standings.lower()
    assert "create table silver." not in standings_lowered
    assert "create table gold." not in standings_lowered
    assert "create view silver." not in standings_lowered
    assert "create view gold." not in standings_lowered
    assert "stg_" not in standings_lowered
    assert "int_" not in standings_lowered
    assert "dim_" not in standings_lowered
    assert "fct_" not in standings_lowered

    reddit = (MIGRATE_DIR / "migrations" / "versions" / "0003_source_reddit_posts.py").read_text(
        encoding="utf-8"
    )
    assert 'revision: str = "0003_source_reddit_posts"' in reddit
    assert "CREATE TABLE source.reddit_posts" in reddit
    assert "reddit_id" in reddit
    reddit_lowered = reddit.lower()
    assert "create table silver." not in reddit_lowered
    assert "create table gold." not in reddit_lowered
    assert "create view silver." not in reddit_lowered
    assert "create view gold." not in reddit_lowered
    assert "stg_" not in reddit_lowered
    assert "int_" not in reddit_lowered
    assert "dim_" not in reddit_lowered
    assert "fct_" not in reddit_lowered

    ml_ingest = (MIGRATE_DIR / "migrations" / "versions" / "0004_source_ml_ingest.py").read_text(
        encoding="utf-8"
    )
    assert 'revision: str = "0004_source_ml_ingest"' in ml_ingest
    assert "CREATE TABLE source.player_injuries" in ml_ingest
    assert "CREATE TABLE source.game_odds" in ml_ingest
    assert "CREATE TABLE source.game_predictions" in ml_ingest
    assert "player_id               UUID" in ml_ingest
    assert "team_id                 UUID" in ml_ingest
    assert "UNIQUE (odds_event_id, bookmaker, market)" in ml_ingest
    assert "UNIQUE (game_id, as_of, model_version)" in ml_ingest
    ml_lowered = ml_ingest.lower()
    assert "create table silver." not in ml_lowered
    assert "create table gold." not in ml_lowered
    assert "create view silver." not in ml_lowered
    assert "create view gold." not in ml_lowered
    assert "stg_" not in ml_lowered
    assert "int_" not in ml_lowered
    assert "dim_" not in ml_lowered
    assert "fct_" not in ml_lowered

    pbp = (MIGRATE_DIR / "migrations" / "versions" / "0005_source_play_by_play.py").read_text(
        encoding="utf-8"
    )
    assert 'revision: str = "0005_source_play_by_play"' in pbp
    assert "CREATE TABLE source.play_by_play" in pbp
    assert "UNIQUE (game_id, action_number, action_id)" in pbp
    pbp_lowered = pbp.lower()
    assert "create table silver." not in pbp_lowered
    assert "create table gold." not in pbp_lowered
    assert "create view silver." not in pbp_lowered
    assert "create view gold." not in pbp_lowered
    assert "stg_" not in pbp_lowered
    assert "int_" not in pbp_lowered
    assert "dim_" not in pbp_lowered
    assert "fct_" not in pbp_lowered

    reddit_gate = (
        MIGRATE_DIR / "migrations" / "versions" / "0006_source_pipeline_reddit.py"
    ).read_text(encoding="utf-8")
    assert 'revision: str = "0006_source_pipeline_reddit"' in reddit_gate
    assert "0005_source_play_by_play" in reddit_gate
    assert "scrape_reddit" in reddit_gate
    assert "reddit_ran" in reddit_gate
    assert "reddit_exit" in reddit_gate
    reddit_gate_lowered = reddit_gate.lower()
    assert "create table silver." not in reddit_gate_lowered
    assert "create table gold." not in reddit_gate_lowered
    assert "create view silver." not in reddit_gate_lowered
    assert "create view gold." not in reddit_gate_lowered
    assert "stg_" not in reddit_gate_lowered
    assert "int_" not in reddit_gate_lowered
    assert "dim_" not in reddit_gate_lowered
    assert "fct_" not in reddit_gate_lowered

    pbp_action_id = (
        MIGRATE_DIR / "migrations" / "versions" / "0007_source_pbp_action_id.py"
    ).read_text(encoding="utf-8")
    assert 'revision: str = "0007_source_pbp_action_id"' in pbp_action_id
    assert "0006_source_pipeline_reddit" in pbp_action_id
    assert "pass" in pbp_action_id
    assert "provider-independent" in pbp_action_id
    pbp_action_id_lowered = pbp_action_id.lower()
    assert "create table silver." not in pbp_action_id_lowered
    assert "create table gold." not in pbp_action_id_lowered
    assert "create view silver." not in pbp_action_id_lowered
    assert "create view gold." not in pbp_action_id_lowered
    assert "stg_" not in pbp_action_id_lowered
    assert "int_" not in pbp_action_id_lowered
    assert "dim_" not in pbp_action_id_lowered
    assert "fct_" not in pbp_action_id_lowered

    drop_reddit_flag = (
        MIGRATE_DIR / "migrations" / "versions" / "0008_drop_scrape_reddit.py"
    ).read_text(encoding="utf-8")
    assert 'revision: str = "0008_drop_scrape_reddit"' in drop_reddit_flag
    assert "0007_source_pbp_action_id" in drop_reddit_flag
    assert "DROP COLUMN IF EXISTS scrape_reddit" in drop_reddit_flag
    drop_reddit_lowered = drop_reddit_flag.lower()
    assert "create table silver." not in drop_reddit_lowered
    assert "create table gold." not in drop_reddit_lowered
    assert "create view silver." not in drop_reddit_lowered
    assert "create view gold." not in drop_reddit_lowered
    assert "stg_" not in drop_reddit_lowered
    assert "int_" not in drop_reddit_lowered
    assert "dim_" not in drop_reddit_lowered
    assert "fct_" not in drop_reddit_lowered

    reddit_comments = (
        MIGRATE_DIR / "migrations" / "versions" / "0009_source_reddit_comments.py"
    ).read_text(encoding="utf-8")
    assert 'revision: str = "0009_source_reddit_comments"' in reddit_comments
    assert "0008_drop_scrape_reddit" in reddit_comments
    assert "CREATE TABLE source.reddit_comments" in reddit_comments
    assert "post_reddit_id" in reddit_comments
    assert "REFERENCES source.reddit_posts(reddit_id)" in reddit_comments
    reddit_comments_lowered = reddit_comments.lower()
    assert "create table silver." not in reddit_comments_lowered
    assert "create table gold." not in reddit_comments_lowered
    assert "create view silver." not in reddit_comments_lowered
    assert "create view gold." not in reddit_comments_lowered
    assert "stg_" not in reddit_comments_lowered
    assert "int_" not in reddit_comments_lowered
    assert "dim_" not in reddit_comments_lowered
    assert "fct_" not in reddit_comments_lowered

    for path in (MIGRATE_DIR / "migrations" / "versions").glob("*.py"):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("revision:"):
                revision_id = line.split("=", 1)[1].strip().strip('"').strip("'")
                assert len(revision_id) <= 32, (
                    f"{path.name} revision id {revision_id!r} exceeds "
                    "alembic_version.version_num VARCHAR(32)"
                )
                break


@pytest.fixture(scope="module")
def migrated_engine() -> Iterator[Engine]:
    if not docker_available():
        pytest.skip("Docker is not available for Testcontainers Postgres")
    container, url = start_postgres_container()
    _alembic_upgrade(url)
    engine = create_engine(url, pool_pre_ping=True)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.mark.integration
def test_upgrade_head_creates_source_tables(migrated_engine: Engine) -> None:
    tables = _tables_in_schema(migrated_engine, "source")
    missing = EXPECTED_SOURCE_TABLES - tables
    assert not missing, f"missing source tables: {sorted(missing)}"
    with migrated_engine.connect() as conn:
        enabled, season_active = conn.execute(
            text("SELECT enabled, season_active FROM source.scrape_pipeline WHERE id = 1")
        ).one()
        assert enabled is False
        assert season_active is False
        columns = {
            row[0]
            for row in conn.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema = 'source'
                      AND table_name = 'scrape_pipeline'
                    """
                )
            )
        }
        assert "scrape_reddit" not in columns
        # Hand-maintained: the host crontab is not readable from the API, so this
        # is where an operator records it. Unset until somebody writes it.
        assert "daily_refresh_utc" in columns
        refresh = conn.execute(
            text("SELECT daily_refresh_utc FROM source.scrape_pipeline WHERE id = 1")
        ).scalar_one()
        assert refresh is None
        # The team badge is the author's flair, a different field from the
        # post's own link_flair_text that `flair` already holds.
        for table in ("reddit_posts", "reddit_comments"):
            has_flair = conn.execute(
                text(
                    """
                    SELECT count(*)
                    FROM information_schema.columns
                    WHERE table_schema = 'source'
                      AND table_name = :table
                      AND column_name = 'author_flair'
                    """
                ),
                {"table": table},
            ).scalar_one()
            assert has_flair == 1, table
        version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        # Computed, not hardcoded: a literal here silently rots every time a
        # revision is added, and CI runs only the unit subset so nothing catches it.
        assert version == _head_revision()


@pytest.mark.integration
def test_upgrade_head_does_not_create_dbt_models(migrated_engine: Engine) -> None:
    assert _tables_in_schema(migrated_engine, "silver") == set()
    assert _tables_in_schema(migrated_engine, "gold") == set()


@pytest.mark.integration
def test_upgrade_head_is_idempotent(migrated_engine: Engine) -> None:
    url = migrated_engine.url.render_as_string(hide_password=False)
    _alembic_upgrade(url)
    tables = _tables_in_schema(migrated_engine, "source")
    assert tables >= EXPECTED_SOURCE_TABLES
