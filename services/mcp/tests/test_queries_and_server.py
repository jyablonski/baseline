import asyncio
from uuid import UUID

import pytest
from baseline_analytics.errors import CubeUnavailableError, UnknownMemberError
from baseline_analytics.tools import TOOLS, TOOLS_BY_NAME
from fastmcp import Client
from fastmcp.exceptions import ToolError

import server

PLAYER = "00000000-0000-4000-8000-000000000001"
MISSING = "00000000-0000-4000-8000-000000000099"


class FakeAnalytics:
    def get_career_stats(self, player_id: UUID) -> dict | None:
        if str(player_id) == MISSING:
            return None
        return {"player_id": player_id, "career_ppg": 24.7}

    def get_games_schedule(self, **kwargs) -> list[dict]:
        return [{"game_id": "1", "home_team": kwargs.get("team_abbreviation")}]

    def get_mvp_ladder(self, **kwargs) -> dict:
        return {"season": "2025-26", "players": [{"full_name": "A", "mvp_rank": 1}]}

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
def test_server_registers_the_shared_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(server, "get_analytics", lambda: FakeAnalytics())

    async def scenario() -> None:
        async with Client(server.mcp) as client:
            listed = {tool.name: tool for tool in await client.list_tools()}
            assert set(listed) == {tool.name for tool in TOOLS}
            schedule = listed["get_games_schedule"]
            assert schedule.description == TOOLS_BY_NAME["get_games_schedule"].description
            assert "opponent_abbreviation" in schedule.input_schema["properties"]
            assert listed["get_career_stats"].input_schema["required"] == ["player_id"]

            # A dict comes back as is; a list is wrapped the way FastMCP wraps one.
            career = await client.call_tool("get_career_stats", {"player_id": PLAYER})
            assert career.structured_content == {"player_id": PLAYER, "career_ppg": 24.7}
            games = await client.call_tool("get_games_schedule", {"team_abbreviation": "DET"})
            assert games.structured_content == {"result": [{"game_id": "1", "home_team": "DET"}]}
            ladder = await client.call_tool("get_mvp_ladder", {})
            assert ladder.structured_content["players"][0]["mvp_rank"] == 1
            rows = await client.call_tool("query_cube", {"measures": ["players.count"]})
            assert rows.structured_content["result"][0]["query"] == {"measures": ["players.count"]}

            with pytest.raises(ToolError, match="Player not found"):
                await client.call_tool("get_career_stats", {"player_id": MISSING})
            with pytest.raises(ToolError, match="requires player_id"):
                await client.call_tool("get_career_stats", {})
            with pytest.raises(ToolError, match="mystery.ppg"):
                await client.call_tool("query_cube", {"measures": ["mystery.ppg"]})

    asyncio.run(scenario())


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
    assert "get_daily_highlights" in result
    assert "get_team_contracts" in result
    assert "get_games_schedule" in result


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
