"""Testcontainers Postgres helpers and gold fixtures shared by the service test suites.

Importable because each service's pytest config puts the repo root on
`pythonpath`; nothing here is installed as a dependency.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_HERE = Path(__file__).resolve().parent
REPO_ROOT = _HERE.parent
# Compose bootstraps the empty schemas from db/; the gold schema and seed exist
# only for tests, so they live next to the helper that applies them.
INIT_SQL = REPO_ROOT / "db" / "init.sql"
GOLD_SCHEMA_SQL = _HERE / "analytics_integration.sql"
GOLD_SEED_SQL = _HERE / "analytics_integration_seed.sql"
MIGRATE_DIR = REPO_ROOT / "services" / "migrate"
POSTGRES_USER = "nba_user"
POSTGRES_PASSWORD = "nba_pass"
POSTGRES_DB = "nba"


def docker_available() -> bool:
    """Return True when the Docker daemon responds to a ping."""
    try:
        import docker

        client = docker.from_env()
        client.ping()
        client.close()
        return True
    except Exception:
        return False


def _strip_sql_comments(sql: str) -> str:
    """Remove -- line comments so semicolons inside comments are ignored."""
    lines: list[str] = []
    for line in sql.splitlines():
        in_single = False
        in_double = False
        out: list[str] = []
        i = 0
        while i < len(line):
            ch = line[i]
            nxt = line[i + 1] if i + 1 < len(line) else ""
            if ch == "'" and not in_double:
                in_single = not in_single
                out.append(ch)
            elif ch == '"' and not in_single:
                in_double = not in_double
                out.append(ch)
            elif ch == "-" and nxt == "-" and not in_single and not in_double:
                break
            else:
                out.append(ch)
            i += 1
        lines.append("".join(out))
    return "\n".join(lines)


def apply_sql_file(engine: Engine, path: Path) -> None:
    sql = _strip_sql_comments(path.read_text(encoding="utf-8"))
    statements = [part.strip() for part in sql.split(";") if part.strip()]
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def apply_alembic(database_url: str) -> None:
    """Run `alembic upgrade head` from services/migrate (source schema only)."""
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        ["uv", "run", "alembic", "upgrade", "head"],
        cwd=MIGRATE_DIR,
        env=env,
        check=True,
    )


def bootstrap_engine(
    database_url: str,
    *,
    with_source_migrations: bool = True,
    with_gold_schema: bool = False,
    with_gold_seed: bool = False,
    with_analytics_schema: bool | None = None,
    with_analytics_seed: bool | None = None,
) -> Engine:
    if with_analytics_schema is not None:
        with_gold_schema = with_analytics_schema
    if with_analytics_seed is not None:
        with_gold_seed = with_analytics_seed
    engine = create_engine(database_url, pool_pre_ping=True)
    apply_sql_file(engine, INIT_SQL)
    if with_source_migrations:
        apply_alembic(database_url)
    if with_gold_schema:
        apply_sql_file(engine, GOLD_SCHEMA_SQL)
    if with_gold_seed:
        apply_sql_file(engine, GOLD_SEED_SQL)
    return engine


def start_postgres_container(network=None, network_alias: str | None = None):
    """Start a Postgres 16 container and return (container, sqlalchemy_url).

    Pass a Testcontainers network and alias when another container (Cube) has
    to reach this database by name; the returned URL is still the host's.
    """
    from testcontainers.community.postgres import PostgresContainer

    container = PostgresContainer(
        image="postgres:16.15-alpine",
        username=POSTGRES_USER,
        password=POSTGRES_PASSWORD,
        dbname=POSTGRES_DB,
    )
    if network is not None:
        container = container.with_network(network)
        if network_alias:
            container = container.with_network_aliases(network_alias)
    container.start()
    # SQLAlchemy + psycopg2 URL (testcontainers may return psycopg driver URL).
    url = container.get_connection_url()
    if url.startswith("postgresql+psycopg2://"):
        pass
    elif url.startswith("postgresql+psycopg://"):
        url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    elif url.startswith("postgresql://"):
        pass
    else:
        url = url.replace("postgres://", "postgresql://", 1)
    return container, url


def postgres_engine_fixture_factory(
    *,
    with_source_migrations: bool = True,
    with_gold_schema: bool = False,
    with_gold_seed: bool = False,
    with_analytics_schema: bool | None = None,
    with_analytics_seed: bool | None = None,
):
    """Build a session-scoped pytest fixture that yields a bootstrapped Engine."""

    def _fixture() -> Iterator[Engine]:
        if not docker_available():
            import pytest

            pytest.skip("Docker is not available for Testcontainers Postgres")

        container, url = start_postgres_container()
        engine = bootstrap_engine(
            url,
            with_source_migrations=with_source_migrations,
            with_gold_schema=with_gold_schema,
            with_gold_seed=with_gold_seed,
            with_analytics_schema=with_analytics_schema,
            with_analytics_seed=with_analytics_seed,
        )
        try:
            yield engine
        finally:
            engine.dispose()
            container.stop()

    return _fixture


def session_from_engine(engine: Engine) -> Iterator[Session]:
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
