"""NBA Analytics MCP server.

Claude Desktop (claude_desktop_config.json):
  command: uv
  args: ["--directory", "/path/to/nba-platform/services/mcp", "run", "src/server.py"]
  env: {"CUBE_API_URL": "http://localhost:4000", "CUBEJS_API_SECRET": "your-cube-secret"}

Production Compose sets MCP_TRANSPORT=streamable-http and serves /mcp on port 8000
inside the container. HTTP clients must send Authorization: Bearer $MCP_API_TOKEN.
"""

from __future__ import annotations

import asyncio
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from baseline_analytics.cube_client import CubeClient
from baseline_analytics.errors import CubeError
from baseline_analytics.operations import CubeAnalytics
from baseline_analytics.tools import TOOLS, call_tool
from dotenv import load_dotenv
from fastmcp import FastMCP
from fastmcp.tools import Tool, ToolResult
from pydantic_core import to_jsonable_python
from pydantic_settings import BaseSettings, SettingsConfigDict

_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from auth import ApiTokenVerifier

load_dotenv()
for parent in _SRC_DIR.parents:
    load_dotenv(parent / ".env")

EXAMPLE_QUESTIONS = """# Example Questions

These questions use named Cube tools or query_cube (Cube query JSON only):

1. **Back-to-back analysis**: "How does Kawhi Leonard perform on back-to-backs?"
   → Use get_player_back_to_backs(player_id, season)

2. **Player comparison**: "Who has more career games, LeBron or Curry?"
   → Use compare_players([player_uuid_a, player_uuid_b], stats=["games"])

3. **Team record by city**: "What is the Warriors' win percentage in Chicago?"
   → Use get_team_record("GSW", arena_city="Chicago")

4. **Game log**: "Show me LeBron's last 10 games"
   → Use get_player_game_log(player_uuid)

5. **Career stats**: "What are Stephen Curry's career averages?"
   → Use get_career_stats(player_uuid)

6. **Ad-hoc Cube query**: "Which team has the most wins this season?"
   → Use query_cube with measures/dimensions from nba://schema (not SQL)

7. **Salary**: "What is Curry's salary?"
   → Use get_player_contract(player_uuid)

8. **Payroll**: "What is the Warriors payroll?"
   → Use get_team_payroll("GSW") for the total, get_team_contracts("GSW") for each player

9. **Standings**: "Who leads the West?" / "How many games back are the Lakers?"
   → Use get_standings(conference="West")

10. **Season averages**: "Curry PPG by season"
   → Use get_player_season_stats(player_uuid)

11. **MVP race**: "Who leads the MVP race?" / "Top 10 playoff MVP scores last season"
   → Use get_mvp_ladder(season, season_type="Regular Season" or "Playoffs", limit)

12. **Player MVP history**: "Where has Jokic ranked in MVP score each season?"
   → Use get_player_mvp_scores(player_uuid)

13. **Upsets**: "Biggest upsets this season?" / "Did the model see any upsets coming?"
   → Use get_biggest_upsets(season, season_type, limit)

14. **Highlights**: "What stood out last night?" / "Best performances on Christmas?"
   → Use get_daily_highlights(game_date, season, all_candidates, limit)

15. **Schedule**: "When do the Pistons play in Chicago?" / "Who do the Celtics play next?"
   → Use get_games_schedule(team_abbreviation, opponent_abbreviation, location, from_date, limit)

16. **National TV / Elo WP / injuries / odds / PBP / reddit**: named tools or query_cube
"""


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    cube_api_url: str | None = None
    cubejs_api_secret: str | None = None
    mcp_transport: str = "stdio"
    mcp_host: str = "127.0.0.1"
    mcp_port: int = 8000
    mcp_path: str = "/mcp"
    mcp_api_token: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_cube_client() -> CubeClient:
    settings = get_settings()
    return CubeClient(settings.cube_api_url, settings.cubejs_api_secret)


def get_analytics() -> CubeAnalytics:
    return CubeAnalytics(get_cube_client())


def mcp_auth(settings: Settings) -> ApiTokenVerifier | None:
    if settings.mcp_transport == "stdio":
        return None
    if not settings.mcp_api_token:
        raise RuntimeError("MCP_API_TOKEN is required for the HTTP MCP transport.")
    return ApiTokenVerifier(settings.mcp_api_token)


settings = get_settings()


mcp = FastMCP(
    "NBA Analytics",
    instructions=(
        "Query NBA player and team stats through Cube (measures, dimensions, filters). "
        "Use named tools (search_players, get_player_game_log, etc.) for structured questions. "
        "Fall back to query_cube with Cube query JSON when named tools do not cover the question. "
        "Cube members are listed in the nba://schema resource. "
        "Do not write SQL. Gold tables are not queryable directly."
    ),
    auth=mcp_auth(settings),
)


@mcp.resource("nba://schema")
def schema_resource() -> str:
    """Cube meta: cubes, measures, and dimensions. Not gold DDL."""
    try:
        return get_analytics().meta_summary()
    except CubeError as exc:
        return str(exc)


@mcp.resource("nba://examples")
def examples_resource() -> str:
    """Example questions and which tools to use for each."""
    return EXAMPLE_QUESTIONS


@mcp.prompt()
def analyze_player(player_name: str) -> str:
    """Guided prompt to analyze an NBA player's performance."""
    return (
        f"Look up {player_name} using search_players, then:\n"
        f"1. Get their career stats with get_career_stats\n"
        f"2. Check their back-to-back performance with get_player_back_to_backs\n"
        f"3. Pull their recent game log with get_player_game_log\n"
        f"Summarize findings with key stats and trends."
    )


@mcp.prompt()
def compare_careers(player_a: str, player_b: str) -> str:
    """Guided prompt to compare two players' careers."""
    return (
        f"Compare {player_a} and {player_b}:\n"
        f"1. Search for both players using search_players\n"
        f"2. Use compare_players with their IDs\n"
        f"3. Highlight who leads in games, PPG, RPG, APG\n"
        f"Present as a side-by-side comparison."
    )


@mcp.prompt()
def team_performance(team_name: str, city: str | None = None) -> str:
    """Guided prompt to analyze a team's record, optionally in a specific city."""
    base = f"Analyze {team_name}'s performance:\n1. Get their overall record with get_team_record\n"
    if city:
        base += f"2. Get their record specifically in {city} using arena_city filter\n"
        base += "3. Compare home vs away performance\n"
    else:
        base += "2. Compare home vs away splits\n"
    base += "Summarize with win percentages and notable patterns."
    return base


class NamedTool(Tool):
    """One shared tool, served under the schema baseline_analytics declares."""

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        # call_tool blocks on Cube HTTP; a thread keeps the server answering
        # other clients meanwhile, as FastMCP does for a sync function tool.
        result = await asyncio.to_thread(call_tool, get_analytics(), self.name, arguments)
        converted = self.convert_result(result)
        if isinstance(result, list):
            # A bare list has no structured form; wrap it the way FastMCP wraps
            # a function tool that returns one.
            return ToolResult(
                content=converted.content,
                structured_content={"result": to_jsonable_python(result)},
            )
        return converted


for _spec in TOOLS:
    mcp.add_tool(
        NamedTool(name=_spec.name, description=_spec.description, parameters=_spec.parameters)
    )


if __name__ == "__main__":
    transport = settings.mcp_transport
    if transport == "stdio":
        mcp.run(transport=transport)
    else:
        mcp.run(
            transport=transport,  # ty: ignore[invalid-argument-type]
            host=settings.mcp_host,
            port=settings.mcp_port,
            path=settings.mcp_path,
        )
