"""The pages' SQL and the Cube operations must report the same numbers.

REST reads gold with SQL; Ask, Chat and MCP read it through Cube. Standings,
team records, season averages and back-to-backs are defined on both sides, so
this runs both against one seeded database, with a real Cube container serving
the model in services/cube, and fails when they disagree.
"""

from __future__ import annotations

import re
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from uuid import UUID

import pytest
from baseline_analytics import CubeAnalytics, CubeClient
from conftest import POSTGRES_NETWORK_ALIAS
from sqlalchemy.orm import Session, sessionmaker

from repositories.players import PlayersRepository
from repositories.standings import StandingsRepository
from repositories.teams import TeamsRepository
from testing.postgres_tc import POSTGRES_DB, POSTGRES_PASSWORD, POSTGRES_USER, REPO_ROOT

pytestmark = pytest.mark.integration

CUBE_DIR = REPO_ROOT / "services" / "cube"
CUBE_SECRET = "parity-test-secret"
SEASON = "2024-25"
TEAMS = {
    "GSW": UUID("7bf8726a-a852-452d-b81f-14839127c5fb"),
    "LAC": UUID("a79dabb2-26c5-443c-bbb4-cabdd8db5958"),
    "CHI": UUID("a96f53b4-0f5c-4cb6-8b88-21ba05224cae"),
}
PLAYERS = {
    "Stephen Curry": UUID("00000000-0000-4000-8000-000000000101"),
    "Kawhi Leonard": UUID("00000000-0000-4000-8000-000000000102"),
}


def _cube_image() -> str:
    """The image services/cube builds on, so the test follows a version bump."""
    dockerfile = (CUBE_DIR / "Dockerfile").read_text(encoding="utf-8")
    match = re.search(r"^FROM (cubejs/cube:\S+)", dockerfile, re.MULTILINE)
    assert match, "services/cube/Dockerfile no longer starts from cubejs/cube"
    return match.group(1)


def _wait_until_ready(base_url: str, timeout: float = 120.0) -> None:
    deadline = time.monotonic() + timeout
    while True:
        try:
            with urllib.request.urlopen(f"{base_url}/readyz", timeout=5) as response:
                if response.status == 200:
                    return
        except urllib.error.URLError, OSError:
            pass
        if time.monotonic() > deadline:
            raise TimeoutError(f"Cube did not become ready at {base_url}")
        time.sleep(1)


@pytest.fixture(scope="module")
def cube(postgres_engine, postgres_network) -> Iterator[CubeAnalytics]:
    from testcontainers.core.container import DockerContainer

    container = (
        DockerContainer(_cube_image())
        .with_network(postgres_network)
        .with_env("CUBEJS_DB_TYPE", "postgres")
        .with_env("CUBEJS_DB_HOST", POSTGRES_NETWORK_ALIAS)
        .with_env("CUBEJS_DB_PORT", "5432")
        .with_env("CUBEJS_DB_NAME", POSTGRES_DB)
        .with_env("CUBEJS_DB_USER", POSTGRES_USER)
        .with_env("CUBEJS_DB_PASS", POSTGRES_PASSWORD)
        .with_env("CUBEJS_API_SECRET", CUBE_SECRET)
        .with_env("CUBEJS_DEV_MODE", "true")
        # The model as it is on disk, not as it was in the last built image.
        .with_volume_mapping(str(CUBE_DIR / "model"), "/cube/conf/model", "ro")
        .with_volume_mapping(str(CUBE_DIR / "cube.js"), "/cube/conf/cube.js", "ro")
        .with_exposed_ports(4000)
    )
    container.start()
    try:
        base_url = f"http://{container.get_container_host_ip()}:{container.get_exposed_port(4000)}"
        _wait_until_ready(base_url)
        yield CubeAnalytics(CubeClient(base_url, CUBE_SECRET, timeout=60))
    finally:
        container.stop()


@pytest.fixture
def db(postgres_engine) -> Iterator[Session]:
    session = sessionmaker(bind=postgres_engine, autocommit=False, autoflush=False)()
    try:
        yield session
    finally:
        session.close()


def _number(value) -> float | None:
    return None if value is None else round(float(value), 3)


def test_standings_agree(db: Session, cube: CubeAnalytics) -> None:
    _, sql_rows = StandingsRepository(db).list_standings(
        season=SEASON, conference=None, as_of=None, limit=30, offset=0
    )
    cube_rows = {row["team_id"]: row for row in cube.list_standings(season=SEASON)}

    assert {row["team_id"] for row in sql_rows} == set(cube_rows) == set(TEAMS.values())
    for sql_row in sql_rows:
        cube_row = cube_rows[sql_row["team_id"]]
        for field in ("abbreviation", "conference", "division", "streak", "last_10"):
            assert cube_row[field] == sql_row[field], (sql_row["abbreviation"], field)
        for field in ("wins", "losses", "conference_rank", "division_rank"):
            assert cube_row[field] == sql_row[field], (sql_row["abbreviation"], field)
        for field in ("win_pct", "games_back", "conf_games_back"):
            assert _number(cube_row[field]) == _number(sql_row[field]), (
                sql_row["abbreviation"],
                field,
            )


@pytest.mark.parametrize(
    ("team", "opponent", "location"),
    [
        ("GSW", None, None),
        ("LAC", None, None),
        ("LAC", "GSW", None),
        ("LAC", None, "away"),
        ("GSW", "LAC", "home"),
        ("CHI", None, None),
    ],
)
def test_team_records_agree(
    db: Session,
    cube: CubeAnalytics,
    team: str,
    opponent: str | None,
    location: str | None,
) -> None:
    repo = TeamsRepository(db)
    params = TeamsRepository.game_filter_params(
        TEAMS[team],
        season=SEASON,
        opponent_team_id=TEAMS[opponent] if opponent else None,
        location=location,
        since_season=None,
        arena_city=None,
        season_type=None,
    )
    from_sql = repo.compute_record(repo.get_team(TEAMS[team]), params)
    from_cube = cube.get_team_record(
        team, opponent_abbreviation=opponent, location=location, season=SEASON
    )

    assert (from_cube["wins"], from_cube["losses"]) == (from_sql["wins"], from_sql["losses"])
    assert _number(from_cube["win_pct"]) == _number(from_sql["win_pct"])
    assert from_cube["games"] == from_sql["games"]


@pytest.mark.parametrize("player", sorted(PLAYERS))
def test_player_season_stats_agree(db: Session, cube: CubeAnalytics, player: str) -> None:
    _, sql_rows = PlayersRepository(db).list_season_stats(PLAYERS[player], limit=50, offset=0)
    cube_rows = {row["season"]: row for row in cube.get_player_season_stats(PLAYERS[player])}

    assert sql_rows, "the seed has a season for every player here"
    assert {row["season"] for row in sql_rows} == set(cube_rows)
    for sql_row in sql_rows:
        cube_row = cube_rows[sql_row["season"]]
        assert cube_row["games_played"] == sql_row["games_played"]
        for field in ("ppg", "rpg", "apg"):
            assert _number(cube_row[field]) == _number(sql_row[field]), (player, field)


@pytest.mark.parametrize("player", sorted(PLAYERS))
def test_player_back_to_backs_agree(db: Session, cube: CubeAnalytics, player: str) -> None:
    from_sql = PlayersRepository(db).get_back_to_back_stats(PLAYERS[player], SEASON)
    from_cube = cube.get_back_to_back_stats(PLAYERS[player], SEASON)

    for field in ("total_back_to_backs", "games_played_in_b2b", "games_sat_in_b2b"):
        assert from_cube[field] == from_sql[field], (player, field)
    for field in ("avg_pts_b2b", "avg_pts_non_b2b"):
        assert _number(from_cube[field]) == _number(from_sql[field]), (player, field)
