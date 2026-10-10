"""Named tools over Cube, defined once.

The API's LLM adapter turns these into function schemas and the MCP server
registers the same list, so a tool or filter added here reaches both. Neither
surface executes SQL: every handler is a Cube query through CubeAnalytics.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from baseline_analytics.operations import CubeAnalytics

Handler = Callable[[CubeAnalytics, dict[str, Any]], Any]

_STRING = {"type": "string"}
_INTEGER = {"type": "integer"}
_BOOLEAN = {"type": "boolean"}
_STRINGS = {"type": "array", "items": {"type": "string"}}
_OBJECTS = {"type": "array", "items": {"type": "object"}}


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    properties: dict[str, Any]
    handler: Handler
    required: tuple[str, ...] = ()
    # Set when the result is a dict wrapping its row list (get_mvp_ladder ->
    # "players"), so a caller that wants a table knows where the rows are.
    rows_key: str | None = None
    # False for a tool that returns reference text, not rows about the NBA.
    is_data: bool = True

    @property
    def parameters(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": dict(self.properties),
            "required": list(self.required),
        }


def _uuid(args: dict[str, Any], key: str) -> UUID:
    return UUID(str(args[key]))


def _optional_uuid(args: dict[str, Any], key: str) -> UUID | None:
    return UUID(str(args[key])) if args.get(key) else None


def _search_players(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.search_players(str(args["name"]).strip())


def _game_log(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_player_game_log(_uuid(args, "player_id"), args.get("season"))


def _back_to_backs(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    row = cube.get_back_to_back_stats(_uuid(args, "player_id"), args.get("season"))
    if row.get("player_name") is None:
        raise ValueError(f"Player not found: {args['player_id']}")
    return row


def _career_stats(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    row = cube.get_career_stats(_uuid(args, "player_id"))
    if row is None:
        raise ValueError(f"Player not found: {args['player_id']}")
    return row


def _compare(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    ids = [UUID(str(player_id)) for player_id in args["player_ids"]]
    return cube.compare_players(ids, args.get("stats"))


def _team_record(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    abbreviation = str(args["team_abbreviation"]).upper()
    if cube.find_team(abbreviation) is None:
        raise ValueError(f"Team not found: {abbreviation}")
    record = cube.get_team_record(
        abbreviation,
        opponent_abbreviation=args.get("opponent_abbreviation"),
        location=args.get("location"),
        since_season=args.get("since_season"),
        season=args.get("season"),
        arena_city=args.get("arena_city"),
    )
    if not args.get("include_games"):
        # One entry per game: thousands of tokens that a W/L question never reads.
        record = {key: value for key, value in record.items() if key != "game_list"}
    return record


def _player_contract(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    row = cube.get_player_contract(_uuid(args, "player_id"), args.get("season"))
    if row is None:
        raise ValueError(f"Player not found: {args['player_id']}")
    return row


def _team_payroll(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    abbreviation = str(args["team_abbreviation"]).upper()
    row = cube.get_team_payroll(abbreviation, args.get("season"))
    if row is None:
        raise ValueError(f"Team not found: {abbreviation}")
    return row


def _team_contracts(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    abbreviation = str(args["team_abbreviation"]).upper()
    rows = cube.get_team_contracts(abbreviation, args.get("season"))
    if rows is None:
        raise ValueError(f"Team not found: {abbreviation}")
    return rows


def _standings(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.list_standings(season=args.get("season"), conference=args.get("conference"))


def _season_stats(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_player_season_stats(_uuid(args, "player_id"))


def _mvp_ladder(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_mvp_ladder(
        season=args.get("season"),
        season_type=args.get("season_type"),
        limit=args.get("limit"),
    )


def _player_mvp_scores(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_player_mvp_scores(_uuid(args, "player_id"), args.get("season"))


def _games_schedule(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    location = args.get("location")
    if location and str(location).lower() not in ("home", "away"):
        # Anything else would be ignored and return both home and away games.
        raise ValueError(
            "location must be 'home' or 'away'. For a team's games in a city, pass that "
            "city's team as opponent_abbreviation with location 'away'."
        )
    return cube.get_games_schedule(
        season=args.get("season"),
        status=args.get("status"),
        limit=args.get("limit"),
        team_abbreviation=args.get("team_abbreviation"),
        opponent_abbreviation=args.get("opponent_abbreviation"),
        location=args.get("location"),
        from_date=args.get("from_date"),
        to_date=args.get("to_date"),
    )


def _game_predictions(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_game_predictions(
        game_id=_optional_uuid(args, "game_id"),
        upcoming=bool(args.get("upcoming")),
    )


def _player_injuries(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_player_injuries(
        player_id=_optional_uuid(args, "player_id"),
        team_abbreviation=args.get("team_abbreviation"),
    )


def _game_odds(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_game_odds(game_id=_optional_uuid(args, "game_id"))


def _biggest_upsets(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_biggest_upsets(
        season=args.get("season"),
        season_type=args.get("season_type"),
        limit=args.get("limit"),
    )


def _transactions(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_transactions(
        season=args.get("season"),
        search=args.get("search"),
        limit=args.get("limit"),
    )


def _transaction_participants(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_transaction_participants(
        player_id=_optional_uuid(args, "player_id"),
        team_abbreviation=args.get("team_abbreviation"),
        season=args.get("season"),
        limit=args.get("limit"),
    )


def _daily_highlights(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_daily_highlights(
        game_date=args.get("game_date"),
        season=args.get("season"),
        all_candidates=bool(args.get("all_candidates")),
        limit=args.get("limit"),
    )


def _play_by_play(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_play_by_play(_uuid(args, "game_id"), args.get("limit"))


def _reddit_posts(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    return cube.get_reddit_posts(search=args.get("search"), limit=args.get("limit"))


def _cube_schema(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    cubes = args.get("cubes")
    # A lone name sometimes arrives as a string; iterating it would look up
    # one "cube" per character.
    return cube.describe_cubes([cubes] if isinstance(cubes, str) else cubes)


def _query_cube(cube: CubeAnalytics, args: dict[str, Any]) -> Any:
    query: dict[str, Any] = {}
    for key in ("measures", "dimensions", "filters", "order"):
        if args.get(key):
            query[key] = args[key]
    if args.get("timeDimensions"):
        query["timeDimensions"] = args["timeDimensions"]
    if args.get("limit") is not None:
        query["limit"] = args["limit"]
    return cube.run_cube_query(query)


TOOLS: tuple[ToolSpec, ...] = (
    ToolSpec(
        "search_players",
        "Fuzzy search for NBA players by name. Returns player_id, full_name, position, team, "
        "is_active. Use it to turn a name into the player_id other tools need.",
        {"name": _STRING},
        _search_players,
        required=("name",),
    ),
    ToolSpec(
        "get_player_game_log",
        "Game-by-game box scores for a player. Omitting season uses the current season. "
        "Includes season_type and mvp_game_score (the game-level MVP score; null for a DNP).",
        {"player_id": _STRING, "season": _STRING},
        _game_log,
        required=("player_id",),
    ),
    ToolSpec(
        "get_player_back_to_backs",
        "Back-to-back volume and scoring splits for a player: total_back_to_backs, "
        "games_played_in_b2b, games_sat_in_b2b, avg_pts_in_b2b vs avg_pts_overall.",
        {"player_id": _STRING, "season": _STRING},
        _back_to_backs,
        required=("player_id",),
    ),
    ToolSpec(
        "get_career_stats",
        "Career totals and averages for a player: games, points, ppg, rpg, apg, "
        "seasons_played, teams_played_for.",
        {"player_id": _STRING},
        _career_stats,
        required=("player_id",),
    ),
    ToolSpec(
        "compare_players",
        "Side-by-side career rows for two or more players. stats optionally narrows the columns.",
        {"player_ids": _STRINGS, "stats": _STRINGS},
        _compare,
        required=("player_ids",),
    ),
    ToolSpec(
        "get_team_record",
        "A team's W/L with optional opponent, location, arena-city, and season filters. "
        "Returns wins, losses, and win_pct; include_games adds the game-by-game list, which "
        "is long. location may be 'home', 'away', or a city name; prefer arena_city for a "
        "city (Warriors games in Chicago).",
        {
            "team_abbreviation": _STRING,
            "opponent_abbreviation": _STRING,
            "location": _STRING,
            "arena_city": _STRING,
            "since_season": _STRING,
            "season": _STRING,
            "include_games": _BOOLEAN,
        },
        _team_record,
        required=("team_abbreviation",),
    ),
    ToolSpec(
        "get_player_contract",
        "Remaining-contract salary snapshot for one player. With season, that season's "
        "remaining-year row from player_contracts. A Basketball-Reference snapshot, not a "
        "paid ledger.",
        {"player_id": _STRING, "season": _STRING},
        _player_contract,
        required=("player_id",),
    ),
    ToolSpec(
        "get_team_payroll",
        "Team payroll total (one row, no players). With season, that season's "
        "Basketball-Reference team total. Not a paid ledger.",
        {"team_abbreviation": _STRING, "season": _STRING},
        _team_payroll,
        required=("team_abbreviation",),
    ),
    ToolSpec(
        "get_team_contracts",
        "Every player contract on a team for one season, largest salary first. Use for the "
        "biggest, smallest, or full list of a team's contracts. Season defaults to the "
        "current contract season.",
        {"team_abbreviation": _STRING, "season": _STRING},
        _team_contracts,
        required=("team_abbreviation",),
    ),
    ToolSpec(
        "get_standings",
        "Conference standings. Omitting season uses the latest. Official standings first; "
        "when those are missing, ranks from Regular Season W-L. conference may be East or West.",
        {"season": _STRING, "conference": _STRING},
        _standings,
    ),
    ToolSpec(
        "get_player_season_stats",
        "Per-season PPG / RPG / APG for a player.",
        {"player_id": _STRING},
        _season_stats,
        required=("player_id",),
    ),
    ToolSpec(
        "get_mvp_ladder",
        "Baseline MVP score ladder for one season, best rank first (default 25, max 100). "
        "season_type is 'Regular Season' (default) or 'Playoffs'. Omitting season uses the "
        "latest scored season. mvp_score is a house metric (average game score scaled by "
        "availability), not the official award vote.",
        {"season": _STRING, "season_type": _STRING, "limit": _INTEGER},
        _mvp_ladder,
        rows_key="players",
    ),
    ToolSpec(
        "get_player_mvp_scores",
        "A player's Baseline MVP score and league rank by season, newest first. Regular "
        "Season and Playoffs are separate rows. See get_mvp_ladder for the formula.",
        {"player_id": _STRING, "season": _STRING},
        _player_mvp_scores,
        required=("player_id",),
    ),
    ToolSpec(
        "get_games_schedule",
        "Games, Final and upcoming, earliest first; upcoming scores are null. Narrow it: "
        "team_abbreviation for one team, opponent_abbreviation for a matchup, location 'home' "
        "or 'away' relative to team_abbreviation, status 'Scheduled' or 'Final', from_date / "
        "to_date as YYYY-MM-DD. There is no city filter: for a team's games in a city, pass "
        "that city's team as opponent_abbreviation with location 'away'. limit defaults to "
        "50; ask only for what the question needs, e.g. limit 1 from today for a team's next "
        "game. national_tv is null for a local-only game.",
        {
            "season": _STRING,
            "status": _STRING,
            "team_abbreviation": _STRING,
            "opponent_abbreviation": _STRING,
            "location": {"type": "string", "enum": ["home", "away"]},
            "from_date": _STRING,
            "to_date": _STRING,
            "limit": _INTEGER,
        },
        _games_schedule,
    ),
    ToolSpec(
        "get_game_predictions",
        "Champion pregame home win probability (model_wp; away_wp is 1 - model_wp, as_of, "
        "model_version). Not a betting line and not live win probability.",
        {"game_id": _STRING, "upcoming": _BOOLEAN},
        _game_predictions,
    ),
    ToolSpec(
        "get_player_injuries",
        "Current Basketball-Reference injury snapshot. Optional player or team filter.",
        {"player_id": _STRING, "team_abbreviation": _STRING},
        _player_injuries,
    ),
    ToolSpec(
        "get_game_odds",
        "Odds API moneylines and spreads for games that have not tipped yet. With game_id, "
        "that game's lines, including the last pregame line of a game already played. A "
        "market snapshot, not a book.",
        {"game_id": _STRING},
        _game_odds,
    ),
    ToolSpec(
        "get_biggest_upsets",
        "Games the pregame moneyline underdog won, most surprising first (default 10, max "
        "50). Omitting season uses the latest season with an upset; season_type is optional. "
        "underdog_market_wp is the de-vigged bookmaker-average win probability from the last "
        "scrape before tip-off; model_called_upset is true when the champion model had the "
        "underdog above 50%. Odds history starts with 2026-27, so earlier seasons return "
        "none.",
        {"season": _STRING, "season_type": _STRING, "limit": _INTEGER},
        _biggest_upsets,
        rows_key="upsets",
    ),
    ToolSpec(
        "get_transactions",
        "Basketball-Reference transactions log: trades, signings, waivers, conversions. "
        "Optional season ('2025-26') and free-text description search. Use "
        "get_transaction_participants to filter by which player or team moved.",
        {"season": _STRING, "search": _STRING, "limit": _INTEGER},
        _transactions,
    ),
    ToolSpec(
        "get_transaction_participants",
        "Teams and players named by each transaction, one row per participant. direction is "
        "'from' or 'to' for teams and 'none' for players; a team that both sends and receives "
        "in one trade appears twice. Draft picks are prose on the source page with no link, "
        "so they are not participants.",
        {
            "player_id": _STRING,
            "team_abbreviation": _STRING,
            "season": _STRING,
            "limit": _INTEGER,
        },
        _transaction_participants,
    ),
    ToolSpec(
        "get_daily_highlights",
        "What stood out on one day of games, most notable first (default 15, max 100): one "
        "lead highlight per game, such as season highs, 40-point games, triple-doubles, "
        "streaks, blown leads, overtime, blowouts, and upsets. game_date is YYYY-MM-DD; "
        "omitting it uses the latest day with games (in season, if given). is_featured marks "
        "the day's top three. all_candidates also returns each game's runners-up.",
        {
            "game_date": _STRING,
            "season": _STRING,
            "all_candidates": _BOOLEAN,
            "limit": _INTEGER,
        },
        _daily_highlights,
        rows_key="highlights",
    ),
    ToolSpec(
        "get_play_by_play",
        "Play-by-play actions for one game. Season-scoped ingest; default limit 200.",
        {"game_id": _STRING, "limit": _INTEGER},
        _play_by_play,
        required=("game_id",),
    ),
    ToolSpec(
        "get_reddit_posts",
        "Reddit submissions. Optional title search.",
        {"search": _STRING, "limit": _INTEGER},
        _reddit_posts,
    ),
    ToolSpec(
        "get_cube_schema",
        "Measures and dimensions, with types, for the named cubes. Call it before query_cube "
        "to get exact member names. With no cubes it lists every cube.",
        {"cubes": _STRINGS},
        _cube_schema,
        is_data=False,
    ),
    ToolSpec(
        "query_cube",
        "Load a Cube query (measures, dimensions, filters). Use exact member names from "
        "get_cube_schema. This is not SQL. order maps a member to 'asc' or 'desc'.",
        {
            "measures": _STRINGS,
            "dimensions": _STRINGS,
            "filters": _OBJECTS,
            "timeDimensions": _OBJECTS,
            "order": {"type": "object"},
            "limit": _INTEGER,
        },
        _query_cube,
    ),
)

TOOLS_BY_NAME: dict[str, ToolSpec] = {tool.name: tool for tool in TOOLS}


def call_tool(cube: CubeAnalytics, name: str, arguments: dict[str, Any] | None) -> Any:
    """Run one named tool. Raises ValueError for an unknown tool, a missing
    required argument, an argument the tool does not take, or a player or team
    that does not exist."""
    spec = TOOLS_BY_NAME.get(name)
    if spec is None:
        raise ValueError(f"Unknown tool '{name}'")
    args = {key: value for key, value in (arguments or {}).items() if value is not None}
    # A filter the tool does not have must not be dropped quietly: the caller
    # would read unfiltered rows as if they had been filtered.
    unknown = [key for key in args if key not in spec.properties]
    if unknown:
        raise ValueError(
            f"{name} does not take {', '.join(unknown)}. Arguments: {', '.join(spec.properties)}"
        )
    missing = [key for key in spec.required if key not in args]
    if missing:
        raise ValueError(f"{name} requires {', '.join(missing)}")
    return spec.handler(cube, args)
