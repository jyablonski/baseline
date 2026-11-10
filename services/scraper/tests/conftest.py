from __future__ import annotations

from collections.abc import Iterator

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import scrapers
from testing.postgres_tc import (
    bootstrap_engine,
    docker_available,
    start_postgres_container,
)


@pytest.fixture(autouse=True)
def _reset_bref_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    # Process-wide by design; one test's 429 must not block the next test's fetches.
    monkeypatch.setattr(scrapers, "_bref_rate_limited_url", None)


@pytest.fixture(scope="session")
def postgres_engine() -> Iterator[Engine]:
    if not docker_available():
        pytest.skip("Docker is not available for Testcontainers Postgres")
    container, url = start_postgres_container()
    engine = bootstrap_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.fixture(scope="session")
def database_url(postgres_engine: Engine) -> str:
    return postgres_engine.url.render_as_string(hide_password=False)


@pytest.fixture
def db_session_factory(postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch):
    factory = sessionmaker(bind=postgres_engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("db.SessionLocal", factory)
    return factory


@pytest.fixture
def db_session(db_session_factory) -> Iterator[Session]:
    session = db_session_factory()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
