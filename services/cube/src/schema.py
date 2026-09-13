from __future__ import annotations

from pathlib import Path

import yaml

REQUIRED_CUBES = (
    "players",
    "games",
    "player_game_logs",
    "team_game_results",
    "standings",
    "teams",
    "team_games",
    "team_game_flow",
    "player_season_stats",
    "player_mvp_scores",
    "player_contracts",
    "team_payroll",
    "games_schedule",
    "game_predictions",
    "player_injuries",
    "game_odds",
    "play_by_play",
    "reddit_posts",
    "reddit_comments",
    "reddit_entity_mentions",
    "reddit_flair",
    "transactions",
    "transaction_participants",
)
REQUIRED_VIEWS = ("player_performance",)


def cube_root(start: Path | None = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for candidate in (here, *here.parents):
        if (candidate / "cube.js").is_file() and (candidate / "model").is_dir():
            return candidate
    raise FileNotFoundError("Could not find Cube project root (cube.js + model/)")


def load_yaml(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle) or {}
    if not isinstance(loaded, dict):
        raise ValueError(f"Expected mapping in {path}")
    return loaded


def load_cubes(root: Path | None = None) -> list[dict]:
    cubes_dir = cube_root(root) / "model" / "cubes"
    cubes: list[dict] = []
    for path in sorted(cubes_dir.glob("*.yml")):
        payload = load_yaml(path)
        cubes.extend(cube for cube in payload.get("cubes") or [] if isinstance(cube, dict))
    return cubes


def cube_names(root: Path | None = None) -> list[str]:
    return [cube["name"] for cube in load_cubes(root)]


def view_names(root: Path | None = None) -> list[str]:
    views_dir = cube_root(root) / "model" / "views"
    names: list[str] = []
    for path in sorted(views_dir.glob("*.yml")):
        payload = load_yaml(path)
        for view in payload.get("views", []):
            names.append(view["name"])
    return names


def validate_schema(root: Path | None = None) -> dict:
    project_dir = cube_root(root)
    cubes_payload = load_cubes(project_dir)
    cubes = [cube["name"] for cube in cubes_payload]
    views = view_names(project_dir)
    missing_cubes = [name for name in REQUIRED_CUBES if name not in cubes]
    if missing_cubes:
        raise ValueError(f"Missing cubes: {', '.join(missing_cubes)}")
    missing_views = [name for name in REQUIRED_VIEWS if name not in views]
    if missing_views:
        raise ValueError(f"Missing views: {', '.join(missing_views)}")

    cube = next(item for item in cubes_payload if item["name"] == "player_game_logs")
    if cube.get("sql_table") != "gold.fct_player_game_logs":
        raise ValueError("player_game_logs must query gold.fct_player_game_logs")
    measures = {measure["name"] for measure in cube.get("measures") or []}
    for required in (
        "games_played",
        "avg_points",
        "back_to_back_games",
        "games_played_in_b2b",
        "games_sat_in_b2b",
        "avg_points_b2b",
        "avg_points_non_b2b",
    ):
        if required not in measures:
            raise ValueError(f"player_game_logs is missing measure {required}")

    players = next(item for item in cubes_payload if item["name"] == "players")
    player_dims = {dim["name"] for dim in players.get("dimensions") or []}
    if "current_season_salary" not in player_dims:
        raise ValueError("players is missing dimension current_season_salary")
    for required in ("height", "weight", "birth_date", "first_season", "last_season"):
        if required not in player_dims:
            raise ValueError(f"players is missing dimension {required}")

    standings = next(item for item in cubes_payload if item["name"] == "standings")
    standing_dims = {dim["name"]: dim for dim in standings.get("dimensions") or []}
    pk_dims = {name for name, dim in standing_dims.items() if dim.get("primary_key")}
    if "conf_games_back" not in standing_dims:
        raise ValueError("standings is missing dimension conf_games_back")
    if not pk_dims:
        raise ValueError("standings is missing a primary_key")
    if pk_dims == {"team_id"}:
        raise ValueError("standings primary_key must include season (team×season grain)")

    teams = next(item for item in cubes_payload if item["name"] == "teams")
    if teams.get("sql_table") != "gold.dim_teams":
        raise ValueError("teams must query gold.dim_teams")
    team_dims = {dim["name"] for dim in teams.get("dimensions") or []}
    if "current_season_payroll" not in team_dims:
        raise ValueError("teams is missing dimension current_season_payroll")

    team_games = next(item for item in cubes_payload if item["name"] == "team_games")
    team_games_sql = team_games.get("sql") or ""
    if "gold.fct_team_game_results" not in team_games_sql:
        raise ValueError("team_games must query gold.fct_team_game_results")
    team_game_measures = {measure["name"] for measure in team_games.get("measures") or []}
    for required in ("games", "wins", "losses"):
        if required not in team_game_measures:
            raise ValueError(f"team_games is missing measure {required}")
    team_game_dims = {dim["name"] for dim in team_games.get("dimensions") or []}
    if "season_type" not in team_game_dims:
        raise ValueError("team_games is missing dimension season_type")

    team_game_flow = next(item for item in cubes_payload if item["name"] == "team_game_flow")
    if "gold.fct_game_flow" not in (team_game_flow.get("sql") or ""):
        raise ValueError("team_game_flow must query gold.fct_game_flow")
    flow_measures = {measure["name"] for measure in team_game_flow.get("measures") or []}
    for required in ("biggest_lead_blown", "biggest_comeback", "overtime_games"):
        if required not in flow_measures:
            raise ValueError(f"team_game_flow is missing measure {required}")

    mvp_scores = next(item for item in cubes_payload if item["name"] == "player_mvp_scores")
    if mvp_scores.get("sql_table") != "gold.fct_player_mvp_scores":
        raise ValueError("player_mvp_scores must query gold.fct_player_mvp_scores")
    mvp_dims = {dim["name"] for dim in mvp_scores.get("dimensions") or []}
    for required in ("season_type", "mvp_score", "mvp_rank"):
        if required not in mvp_dims:
            raise ValueError(f"player_mvp_scores is missing dimension {required}")

    return {
        "root": project_dir,
        "cubes": cubes,
        "views": views,
        "measures": sorted(measures),
    }
