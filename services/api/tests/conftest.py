from __future__ import annotations

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from dependencies import get_cube_analytics, get_db
from main import create_app
from testing.postgres_tc import (
    bootstrap_engine,
    docker_available,
    start_postgres_container,
)


class MappingRow:
    def __init__(self, data: dict):
        id_keys = {
            "player_id",
            "team_id",
            "game_id",
            "home_team_id",
            "away_team_id",
            "winning_team_id",
            "opponent_team_id",
        }
        self._mapping = {
            key: UUID(value) if key in id_keys and isinstance(value, str) else value
            for key, value in data.items()
        }

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self._mapping.values())[key]
        return self._mapping[key]

    def keys(self):
        return self._mapping.keys()

    def values(self):
        return self._mapping.values()

    def items(self):
        return self._mapping.items()

    def __iter__(self):
        return iter(self._mapping)

    def __len__(self):
        return len(self._mapping)


class QueryResult:
    def __init__(self, rows=None, scalar=None):
        self._rows = list(rows or [])
        self._scalar = scalar

    def first(self):
        return self._rows[0] if self._rows else None

    def mappings(self):
        return self

    def scalar_one(self):
        if self._scalar is not None:
            return self._scalar
        return 0

    def scalar(self):
        return self._scalar

    def one(self):
        return self._rows[0]

    def __iter__(self):
        return iter(self._rows)


class ScriptedSession:
    def __init__(self) -> None:
        self.queue: list[QueryResult] = []
        # Every (statement, params) pair, so a test can assert on the values a
        # router actually bound rather than only on the rows it returned.
        self.calls: list[tuple[object, dict | None]] = []
        self.closed = False

    def execute(self, stmt, params=None):
        self.calls.append((stmt, params))
        if not self.queue:
            raise AssertionError(f"Unexpected SQL execute: {stmt} {params}")
        return self.queue.pop(0)

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def session() -> ScriptedSession:
    return ScriptedSession()


@pytest.fixture
def mapping_row():
    return MappingRow


@pytest.fixture
def query_result():
    return QueryResult


@pytest.fixture
def cube_analytics():
    from test_nl_eval import FakeCubeAnalytics

    return FakeCubeAnalytics()


@pytest.fixture
def client(session: ScriptedSession, cube_analytics) -> TestClient:
    app = create_app()

    def override_db():
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_cube_analytics] = lambda: cube_analytics
    return TestClient(app)


# The name other containers on postgres_network (Cube) use to reach Postgres.
POSTGRES_NETWORK_ALIAS = "postgres"


@pytest.fixture(scope="session")
def postgres_network():
    if not docker_available():
        pytest.skip("Docker is not available for Testcontainers Postgres")
    from testcontainers.core.network import Network

    with Network() as network:
        yield network


@pytest.fixture(scope="session")
def postgres_engine(postgres_network):
    container, url = start_postgres_container(
        network=postgres_network, network_alias=POSTGRES_NETWORK_ALIAS
    )
    engine = bootstrap_engine(
        url,
        with_gold_schema=True,
        with_gold_seed=True,
    )
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.fixture(scope="session")
def database_url(postgres_engine) -> str:
    return str(postgres_engine.url)


@pytest.fixture
def integration_client(postgres_engine) -> TestClient:
    SessionLocal = sessionmaker(
        bind=postgres_engine,
        autocommit=False,
        autoflush=False,
    )
    app = create_app()

    def override_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    return TestClient(app)
