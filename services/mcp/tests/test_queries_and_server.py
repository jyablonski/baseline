import asyncio
from datetime import date

import pytest
from cube.errors import CubeUnavailableError, UnknownMemberError
from cube.queries import current_nba_season, normalize_conference, project_compare_stats

import server


class FakeAnalytics:
    def search_players(self, name: str) -> list[dict]:
        return [{"player_id": 1, "full_name": name}]

    def get_player_game_log(self, player_id: int, season: str | None = None) -> list[dict]:
        return [{"player_id": player_id, "season": season}]

    def get_back_to_back_stats(self, player_id: int, season: str | None = None) -> dict:
        if player_id == 99:
            return {"player_name": None}
        return {"player_id": player_id, "player_name": "A", "total_back_to_backs": 1}

    def get_career_stats(self, player_id: int) -> dict | None:
        if player_id == 99:
            return None
        return {"player_id": player_id}

    def compare_players(self, player_ids: list[int], stats: list[str] | None = None) -> list[dict]:
        if len(player_ids) < 2:
            raise ValueError("compare_players requires at least 2 player_ids")
        return [{"player_id": player_ids[0]}]

    def find_team(self, abbreviation: str) -> dict | None:
        if abbreviation.upper() == "XXX":
            return None
        return {"abbreviation": abbreviation.upper(), "team_id": 1}

    def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
        return {"wins": 1, "losses": 0, "win_pct": 1.0, "games": []}

    def get_player_contract(self, player_id: int, season: str | None = None) -> dict | None:
        if player_id == 99:
            return None
        return {"player_id": player_id, "season": season}

    def get_team_payroll(self, abbreviation: str, season: str | None = None) -> dict | None:
        if abbreviation.upper() == "XXX":
            return None
        return {"abbreviation": abbreviation, "season": season}

    def get_player_season_stats(self, player_id: int) -> list[dict]:
        return [{"player_id": player_id, "season": "2024-25", "ppg": 24.5}]

    def get_mvp_ladder(self, **kwargs) -> dict:
        return {
            "season": kwargs.get("season") or "2025-26",
            "season_type": kwargs.get("season_type") or "Regular Season",
            "players": [{"full_name": "A", "mvp_rank": 1}],
        }

    def get_player_mvp_scores(self, player_id: int, season: str | None = None) -> list[dict]:
        return [{"player_id": player_id, "season": season, "mvp_rank": 3}]

    def get_games_schedule(self, **kwargs) -> list[dict]:
        return [{"game_id": "1", "status": kwargs.get("status")}]

    def get_game_predictions(self, **kwargs) -> list[dict]:
        return [{"game_id": kwargs.get("game_id") or "1", "model_wp": 0.58}]

    def get_player_injuries(self, **kwargs) -> list[dict]:
        return [{"player_id": kwargs.get("player_id"), "description": "knee"}]

    def get_game_odds(self, **kwargs) -> list[dict]:
        return [{"game_id": kwargs.get("game_id"), "market": "h2h"}]

    def get_biggest_upsets(self, **kwargs) -> dict:
        return {
            "season": kwargs.get("season") or "2026-27",
            "season_type": kwargs.get("season_type"),
            "upsets": [{"underdog_team_abbreviation": "LAC", "upset_rank": 1}],
        }

    def get_play_by_play(self, game_id: str, limit: int | None = None) -> list[dict]:
        return [{"game_id": game_id, "action_number": 1, "limit": limit}]

    def get_transactions(self, **kwargs) -> list[dict]:
        return [{"season": kwargs.get("season"), "description": "signed a guy"}]

    def get_transaction_participants(self, **kwargs) -> list[dict]:
        return [
            {
                "team_abbreviation": kwargs.get("team_abbreviation"),
                "direction": "to",
            }
        ]

    def get_reddit_posts(self, **kwargs) -> list[dict]:
        return [{"reddit_id": "abc", "title": kwargs.get("search") or "thread"}]

    def list_standings(
        self, season: str | None = None, conference: str | None = None
    ) -> list[dict]:
        return [{"abbreviation": "OKC", "conference": conference}]

    def meta_summary(self) -> str:
        return "## players\nMeasures: players.count\nDimensions: players.full_name\n"

    def run_cube_query(self, query: dict) -> list[dict]:
        if "mystery.ppg" in (query.get("measures") or []):
            raise UnknownMemberError("Unknown Cube member(s): mystery.ppg")
        return [{"x": 1, "query": query}]


class DownAnalytics(FakeAnalytics):
    def meta_summary(self) -> str:
        raise CubeUnavailableError("Ask is unavailable because the Cube semantic layer is down.")


@pytest.mark.unit
def test_current_nba_season() -> None:
    assert current_nba_season(date(2025, 10, 1)) == "2025-26"
    assert current_nba_season(date(2026, 2, 1)) == "2025-26"


@pytest.mark.unit
def test_project_compare_stats() -> None:
    rows = [
        {
            "player_id": 1,
            "full_name": "A",
            "career_games_played": 10,
            "career_ppg": 20,
        }
    ]
    defaulted = project_compare_stats(rows)
    assert defaulted[0]["player_id"] == 1
    projected = project_compare_stats(rows, ["ppg", "games", "ppg"])
    assert "career_ppg" in projected[0]
    assert "career_games_played" in projected[0]


@pytest.mark.unit
def test_normalize_conference() -> None:
    assert normalize_conference("east") == "East"
    assert normalize_conference("  ") is None
    assert normalize_conference("Central") == "Central"


@pytest.mark.unit
def test_server_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    server.get_settings.cache_clear()
    server.get_cube_client.cache_clear()
    monkeypatch.delenv("CUBE_API_URL", raising=False)
    settings = server.Settings(cube_api_url=None, cubejs_api_secret=None)
    assert settings.cube_api_url is None
    settings = server.Settings(cube_api_url="http://cube:4000", cubejs_api_secret="s")
    assert settings.cube_api_url == "http://cube:4000"
    monkeypatch.setenv("CUBE_API_URL", "http://localhost:4000")
    monkeypatch.setenv("CUBEJS_API_SECRET", "secret")
    server.get_settings.cache_clear()
    client = server.get_cube_client()
    assert client.base_url == "http://localhost:4000"
    server.get_settings.cache_clear()
    server.get_cube_client.cache_clear()


@pytest.mark.unit
def test_mcp_transport_auth() -> None:
    stdio = server.Settings(mcp_transport="stdio")
    assert server.mcp_auth(stdio) is None

    with pytest.raises(RuntimeError, match="MCP_API_TOKEN"):
        server.mcp_auth(server.Settings(mcp_transport="streamable-http", mcp_api_token=None))

    http = server.mcp_auth(server.Settings(mcp_transport="streamable-http", mcp_api_token="token"))
    assert http is not None
    assert asyncio.run(http.verify_token("token")) is not None
    assert asyncio.run(http.verify_token("wrong")) is None


@pytest.mark.unit
def test_server_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeAnalytics()
    monkeypatch.setattr(server, "get_analytics", lambda: fake)

    assert server.search_players("kawhi") == [{"player_id": 1, "full_name": "kawhi"}]
    assert server.get_player_game_log(1) == [{"player_id": 1, "season": None}]
    assert server.get_player_back_to_backs(1)["player_id"] == 1
    assert server.get_career_stats(1)["player_id"] == 1
    assert server.compare_players([1, 2]) == [{"player_id": 1}]
    with pytest.raises(ValueError):
        server.compare_players([1])
    assert server.get_team_record("GSW")["wins"] == 1
    assert server.get_player_contract(1)["player_id"] == 1
    assert server.get_team_payroll("GSW")["abbreviation"] == "GSW"
    assert server.get_standings(conference="West") == [
        {"abbreviation": "OKC", "conference": "West"}
    ]
    assert server.get_player_season_stats(1)[0]["ppg"] == 24.5
    ladder = server.get_mvp_ladder(season_type="Playoffs", limit=5)
    assert ladder["season_type"] == "Playoffs"
    assert ladder["players"][0]["mvp_rank"] == 1
    assert server.get_player_mvp_scores(1, season="2024-25") == [
        {"player_id": 1, "season": "2024-25", "mvp_rank": 3}
    ]
    assert server.get_games_schedule(season="2024-25")[0]["game_id"] == "1"
    assert server.get_game_predictions(upcoming=True)[0]["model_wp"] == 0.58
    assert server.get_player_injuries(team_abbreviation="LAC")[0]["description"] == "knee"
    assert server.get_game_odds()[0]["market"] == "h2h"
    upsets = server.get_biggest_upsets(season_type="Playoffs", limit=3)
    assert upsets["season"] == "2026-27"
    assert upsets["upsets"][0]["upset_rank"] == 1
    assert server.get_play_by_play("0022400001")[0]["game_id"] == "0022400001"
    assert server.get_reddit_posts(search="thread")[0]["title"] == "thread"
    assert server.get_transactions(season="2025-26")[0]["season"] == "2025-26"
    assert server.get_transaction_participants(team_abbreviation="ATL")[0]["direction"] == "to"
    assert server.get_player_contract(1, season="2024-25")["season"] == "2024-25"
    assert server.query_cube(measures=["players.count"]) == [
        {"x": 1, "query": {"measures": ["players.count"]}}
    ]
    assert (
        server.query_cube(
            dimensions=["players.full_name"],
            filters=[{"member": "players.full_name", "operator": "contains", "values": ["a"]}],
            time_dimensions=[{"dimension": "player_game_logs.game_date"}],
            limit=5,
        )[0]["query"]["limit"]
        == 5
    )

    with pytest.raises(ValueError):
        server.get_player_back_to_backs(99)
    with pytest.raises(ValueError):
        server.get_career_stats(99)
    with pytest.raises(ValueError):
        server.get_player_contract(99)
    with pytest.raises(ValueError):
        server.get_team_payroll("XXX")
    with pytest.raises(ValueError):
        server.get_team_record("XXX")
    with pytest.raises(UnknownMemberError):
        server.query_cube(measures=["mystery.ppg"])


@pytest.mark.unit
def test_schema_resource(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "get_analytics", lambda: FakeAnalytics())
    result = server.schema_resource()
    assert "## players" in result
    assert "gold.dim_players" not in result
    assert "query_nba_data" not in result

    monkeypatch.setattr(server, "get_analytics", lambda: DownAnalytics())
    assert "Cube semantic layer is down" in server.schema_resource()


@pytest.mark.unit
def test_examples_resource() -> None:
    result = server.examples_resource()
    assert "back-to-back" in result.lower()
    assert "query_cube" in result
    assert "query_nba_data" not in result
    assert "salary" in result.lower()
    assert "payroll" in result.lower()
    assert "who leads the west" in result.lower()
    assert "get_mvp_ladder" in result
    assert "get_player_mvp_scores" in result
    assert "get_biggest_upsets" in result


@pytest.mark.unit
def test_analyze_player_prompt() -> None:
    result = server.analyze_player("LeBron James")
    assert "LeBron James" in result
    assert "search_players" in result


@pytest.mark.unit
def test_compare_careers_prompt() -> None:
    result = server.compare_careers("LeBron", "Curry")
    assert "LeBron" in result
    assert "Curry" in result


@pytest.mark.unit
def test_team_performance_prompt() -> None:
    result = server.team_performance("Warriors")
    assert "Warriors" in result
    result_city = server.team_performance("Warriors", "Chicago")
    assert "Chicago" in result_city
