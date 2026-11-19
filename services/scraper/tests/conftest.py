from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
import requests
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


@pytest.fixture(autouse=True)
def _refuse_live_basketball_reference(monkeypatch: pytest.MonkeyPatch) -> None:
    # A test that reaches the real site spends the developer's rate limit and
    # can get their IP blocked. Tests that fake requests.get, or pass get= to
    # bref_get, are unaffected; anything else fails here instead.
    real_get = requests.get

    def get(url: str, *args: Any, **kwargs: Any) -> Any:
        if "basketball-reference.com" in str(url):
            # ValueError, which bref_get does not retry, so the test fails at once.
            raise ValueError(f"tests must not call Basketball-Reference: {url}")
        return real_get(url, *args, **kwargs)

    monkeypatch.setattr(requests, "get", get)


@pytest.fixture(autouse=True)
def _stub_pipeline_roster_scrape(monkeypatch: pytest.MonkeyPatch) -> None:
    # The pipeline and scrape-daily run the roster scrape before contracts.
    # Tests that drive them stub contracts but would otherwise fetch 30 live
    # Basketball-Reference team pages. A test can override this stub.
    monkeypatch.setattr("pipeline.scrape_players", lambda **_kwargs: 0)
    monkeypatch.setattr("main.scrape_players", lambda **_kwargs: 0)


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
