from __future__ import annotations

from datetime import date
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from ids import PLAYER_CURRY, TEAM_GSW
from sqlalchemy.orm import sessionmaker

from dependencies import get_cube_analytics, get_db
from main import create_app
from queries.players import PLAYER_TREND_STATS
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


def _trend_row(player_id: str = PLAYER_CURRY, **overrides) -> dict:
    """A qualified fct_player_trends row in the routes' wide shape."""
    row = {
        "player_id": player_id,
        "full_name": "Stephen Curry",
        "team_id": TEAM_GSW,
        "season": "2024-25",
        "games_played": 16,
        "window_games": 10,
        "baseline_games": 6,
        "window_start_date": date(2024, 11, 20),
        "window_end_date": date(2025, 1, 8),
        "trend_direction": "up",
        "trend_rank": 1,
    }
    for stat in PLAYER_TREND_STATS:
        row |= {f"{stat}_last_10": 1.5, f"{stat}_baseline": 1.0, f"{stat}_season": 1.2}
        row |= {f"{stat}_change": 0.5, f"{stat}_z": 0.4, f"{stat}_changed": False}
        row[f"{stat}_games"] = [1.0, 2.0, None]
    row |= {"mvp_game_score_last_10": 28.1, "mvp_game_score_baseline": 22.6}
    row |= {"mvp_game_score_change": 5.5, "true_shooting_pct_baseline": None}
    row |= {"mvp_game_score_z": 2.8, "mvp_game_score_changed": True}
    return row | overrides


@pytest.fixture
def trend_row():
    return _trend_row


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
