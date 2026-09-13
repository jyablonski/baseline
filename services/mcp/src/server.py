"""NBA Analytics MCP server.

Claude Desktop (claude_desktop_config.json):
  command: uv
  args: ["--directory", "/path/to/nba-platform/services/mcp", "run", "src/server.py"]
  env: {"CUBE_API_URL": "http://localhost:4000", "CUBEJS_API_SECRET": "your-cube-secret"}

Production Compose sets MCP_TRANSPORT=streamable-http and serves /mcp on port 8000
inside the container. HTTP clients must send Authorization: Bearer $MCP_API_TOKEN.
"""

from __future__ import annotations

import sys
from functools import lru_cache
from pathlib import Path
from uuid import UUID

from dotenv import load_dotenv
from fastmcp import FastMCP
from pydantic_settings import BaseSettings, SettingsConfigDict

_SRC_DIR = Path(__file__).resolve().parent
if str(_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(_SRC_DIR))

from auth import ApiTokenVerifier
from cube.analytics import CubeAnalytics
from cube.client import CubeClient
from cube.errors import CubeError

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
   → Use get_team_payroll("GSW")

9. **Standings**: "Who leads the West?" / "How many games back are the Lakers?"
   → Use get_standings(conference="West")

10. **Season averages**: "Curry PPG by season"
   → Use get_player_season_stats(player_uuid)

11. **MVP race**: "Who leads the MVP race?" / "Top 10 playoff MVP scores last season"
   → Use get_mvp_ladder(season, season_type="Regular Season" or "Playoffs", limit)

12. **Player MVP history**: "Where has Jokic ranked in MVP score each season?"
   → Use get_player_mvp_scores(player_uuid)

13. **Schedule / Elo WP / injuries / odds / PBP / reddit**: named tools or query_cube
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


@mcp.tool()
def search_players(name: str) -> list[dict]:
    """Fuzzy search for NBA players by name. Returns player_id, full_name,
    position, team, is_active."""
    return get_analytics().search_players(name)


@mcp.tool()
def get_player_game_log(
    player_id: UUID,
    season: str | None = None,
) -> list[dict]:
    """Get game-by-game stats for a player. If season is omitted, returns
    current season. Returns date, opponent, minutes, pts, reb, ast, season_type,
    and mvp_game_score (the game-level MVP score; null for a DNP), etc."""
    return get_analytics().get_player_game_log(player_id, season)


@mcp.tool()
def get_player_back_to_backs(
    player_id: UUID,
    season: str | None = None,
) -> dict:
    """Get back-to-back game stats: total_back_to_backs, games_played_in_b2b,
    games_sat_in_b2b, avg_pts_in_b2b vs avg_pts_overall."""
    row = get_analytics().get_back_to_back_stats(player_id, season)
    if row.get("player_name") is None:
        raise ValueError(f"Player not found: {player_id}")
    return row


@mcp.tool()
def get_career_stats(player_id: UUID) -> dict:
    """Career totals and averages: total_games, total_points, ppg, rpg, apg,
    seasons_played, teams_played_for."""
    row = get_analytics().get_career_stats(player_id)
    if row is None:
        raise ValueError(f"Player not found: {player_id}")
    return row


@mcp.tool()
def compare_players(
    player_ids: list[UUID],
    stats: list[str] | None = None,
) -> list[dict]:
    """Compare career stats for 2+ players side by side."""
    return get_analytics().compare_players(player_ids, stats)


@mcp.tool()
def get_team_record(
    team_abbreviation: str,
    opponent_abbreviation: str | None = None,
    location: str | None = None,
    since_season: str | None = None,
    season: str | None = None,
    arena_city: str | None = None,
) -> dict:
    """Get a team's W/L record with optional filters. Returns wins, losses,
    win_pct, and the filtered game list.

    location may be 'home'/'away' or a city name (e.g. Chicago). Prefer
    arena_city for city filters such as Warriors games in Chicago.
    """
    team = get_analytics().find_team(team_abbreviation)
    if team is None:
        raise ValueError(f"Team not found: {team_abbreviation}")
    return get_analytics().get_team_record(
        team_abbreviation,
        opponent_abbreviation=opponent_abbreviation,
        location=location,
        since_season=since_season,
        season=season,
        arena_city=arena_city,
    )


@mcp.tool()
def get_player_contract(player_id: UUID, season: str | None = None) -> dict:
    """Remaining-contract snapshot. Without season this is the dim remaining-year
    row. With season it reads player_contracts for that remaining-year slice
    (BRef snapshot, not a paid ledger)."""
    row = get_analytics().get_player_contract(player_id, season)
    if row is None:
        raise ValueError(f"Player not found: {player_id}")
    return row


@mcp.tool()
def get_team_payroll(team_abbreviation: str, season: str | None = None) -> dict:
    """Team payroll snapshot. Without season this is the dim remaining-year
    row. With season it reads team_payroll (BRef Team Totals, not a ledger)."""
    row = get_analytics().get_team_payroll(team_abbreviation, season)
    if row is None:
        raise ValueError(f"Team not found: {team_abbreviation}")
    return row


@mcp.tool()
def get_player_season_stats(player_id: UUID) -> list[dict]:
    """Per-season PPG / RPG / APG from Cube player_season_stats."""
    return get_analytics().get_player_season_stats(player_id)


@mcp.tool()
def get_mvp_ladder(
    season: str | None = None,
    season_type: str | None = None,
    limit: int | None = None,
) -> dict:
    """Baseline MVP score ladder for one season, best rank first (default 25, max 100).

    season_type is 'Regular Season' (default) or 'Playoffs'; play-in games and the
    Cup final are not scored. Omitting season uses the latest scored season.

    mvp_score = avg_game_score x availability_multiplier. A game score is a Game
    Score-style box score scaled up 20% in a win and down 20% in a loss. The
    multiplier is 1.0 through the first 10% of team games missed, then ramps down
    to 0.75 at half missed and never lower. A house metric, not the official award vote."""
    return get_analytics().get_mvp_ladder(season=season, season_type=season_type, limit=limit)


@mcp.tool()
def get_player_mvp_scores(player_id: UUID, season: str | None = None) -> list[dict]:
    """A player's Baseline MVP score and league rank by season, newest first.
    Regular Season and Playoffs are separate rows. See get_mvp_ladder for the formula."""
    return get_analytics().get_player_mvp_scores(player_id, season)


@mcp.tool()
def get_games_schedule(
    season: str | None = None,
    status: str | None = None,
) -> list[dict]:
    """All-status slate (Final and upcoming). Upcoming scores are null."""
    return get_analytics().get_games_schedule(season=season, status=status)


@mcp.tool()
def get_game_predictions(
    game_id: UUID | None = None,
    upcoming: bool = False,
) -> list[dict]:
    """Elo pregame home win probability (model_wp, as_of, model_version).
    Not a betting line and not live WP."""
    return get_analytics().get_game_predictions(game_id=game_id, upcoming=upcoming)


@mcp.tool()
def get_player_injuries(
    player_id: UUID | None = None,
    team_abbreviation: str | None = None,
) -> list[dict]:
    """Current Basketball-Reference injury snapshot. Optional player or team filter."""
    return get_analytics().get_player_injuries(
        player_id=player_id,
        team_abbreviation=team_abbreviation,
    )


@mcp.tool()
def get_game_odds(game_id: UUID | None = None) -> list[dict]:
    """Current Odds API upcoming-slate snapshot. Market snapshot, not a book."""
    return get_analytics().get_game_odds(game_id=game_id)


@mcp.tool()
def get_transactions(
    season: str | None = None,
    search: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Basketball-Reference transactions log: trades, signings, waivers, conversions.

    Optional season ("2025-26") and free-text description search. Use
    get_transaction_participants to filter by which player or team moved."""
    return get_analytics().get_transactions(season=season, search=search, limit=limit)


@mcp.tool()
def get_transaction_participants(
    player_id: UUID | None = None,
    team_abbreviation: str | None = None,
    season: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Teams and players named by each transaction, one row per participant.

    direction is 'from' or 'to' for teams and 'none' for players; a team that
    both sends and receives in one trade appears twice. Draft picks are prose
    on the source page with no link, so they are not participants."""
    return get_analytics().get_transaction_participants(
        player_id=player_id,
        team_abbreviation=team_abbreviation,
        season=season,
        limit=limit,
    )


@mcp.tool()
def get_play_by_play(game_id: UUID, limit: int | None = None) -> list[dict]:
    """Play-by-play actions for one game. Season-scoped ingest; default limit 200."""
    return get_analytics().get_play_by_play(game_id, limit)


@mcp.tool()
def get_reddit_posts(
    search: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Reddit submissions. Optional title search. No Courtline page."""
    return get_analytics().get_reddit_posts(search=search, limit=limit)


@mcp.tool()
def get_standings(
    season: str | None = None,
    conference: str | None = None,
) -> list[dict]:
    """Conference standings. Omitting season uses the latest official season, else latest Regular Season games.
    Official Cube standings first; empty → Regular Season team_games W–L ranks.
    conference may be East or West."""
    return get_analytics().list_standings(season=season, conference=conference)


@mcp.tool()
def query_cube(
    measures: list[str] | None = None,
    dimensions: list[str] | None = None,
    filters: list[dict] | None = None,
    time_dimensions: list[dict] | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Load a Cube query (measures, dimensions, filters). Members must exist
    in Cube meta (nba://schema). This is not SQL."""
    query: dict = {}
    if measures:
        query["measures"] = measures
    if dimensions:
        query["dimensions"] = dimensions
    if filters:
        query["filters"] = filters
    if time_dimensions:
        query["timeDimensions"] = time_dimensions
    if limit is not None:
        query["limit"] = limit
    return get_analytics().run_cube_query(query)


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
