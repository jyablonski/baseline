"""Named product questions as Cube query JSON (shared by API rules/LLM and MCP)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

DEFAULT_COMPARE_STATS = (
    "career_games_played",
    "career_ppg",
    "career_rpg",
    "career_apg",
    "seasons_played",
    "total_points",
    "teams_played_for",
)

STAT_ALIASES = {
    "games": "career_games_played",
    "games_played": "career_games_played",
    "career_games_played": "career_games_played",
    "total_games": "career_games_played",
    "ppg": "career_ppg",
    "career_ppg": "career_ppg",
    "rpg": "career_rpg",
    "career_rpg": "career_rpg",
    "apg": "career_apg",
    "career_apg": "career_apg",
    "seasons": "seasons_played",
    "seasons_played": "seasons_played",
    "points": "total_points",
    "total_points": "total_points",
    "teams": "teams_played_for",
    "teams_played_for": "teams_played_for",
}

_HOME_AWAY = frozenset({"home", "away"})

PLAYER_SEARCH_DIMENSIONS = [
    "players.player_id",
    "players.full_name",
    "players.position",
    "players.is_active",
    "teams.abbreviation",
]

PLAYER_PROFILE_DIMENSIONS = [
    "players.player_id",
    "players.full_name",
    "players.position",
    "players.is_active",
    "players.height",
    "players.weight",
    "players.birth_date",
    "players.first_season",
    "players.last_season",
    "players.career_games_played",
    "players.seasons_played",
    "players.career_ppg",
    "players.career_rpg",
    "players.career_apg",
    "players.first_game_date",
    "players.last_game_date",
    "players.current_contract_season",
    "players.current_season_salary",
    "players.current_remaining_guaranteed",
]

PLAYER_COMPARE_DIMENSIONS = [
    "players.player_id",
    "players.full_name",
    "players.career_games_played",
    "players.seasons_played",
    "players.career_ppg",
    "players.career_rpg",
    "players.career_apg",
]

PLAYER_SALARY_DIMENSIONS = [
    "players.player_id",
    "players.full_name",
    "players.current_contract_season",
    "players.current_season_salary",
    "players.current_remaining_guaranteed",
]

PLAYER_GAME_LOG_DIMENSIONS = [
    "player_game_logs.game_date",
    "player_game_logs.opponent",
    "player_game_logs.location",
    "player_game_logs.result",
    "player_game_logs.minutes",
    "player_game_logs.points",
    "player_game_logs.rebounds",
    "player_game_logs.assists",
    "player_game_logs.steals",
    "player_game_logs.blocks",
    "player_game_logs.turnovers",
    "player_game_logs.plus_minus",
    "player_game_logs.is_back_to_back",
    "player_game_logs.matchup",
    "player_game_logs.team_abbreviation",
    "player_game_logs.season",
    "player_game_logs.season_type",
    "player_game_logs.mvp_game_score",
]

TEAM_DIMENSIONS = [
    "teams.team_id",
    "teams.abbreviation",
    "teams.team_name",
    "teams.current_season_payroll",
    "teams.current_remaining_guaranteed",
    "teams.current_contract_season",
]

STANDINGS_DIMENSIONS = [
    "standings.team_id",
    "standings.abbreviation",
    "standings.team_name",
    "standings.season",
    "standings.season_type",
    "standings.as_of_date",
    "standings.conference",
    "standings.division",
    "standings.conference_rank",
    "standings.division_rank",
    "standings.streak",
    "standings.last_10",
    "standings.team_wins",
    "standings.team_losses",
    "standings.win_pct",
    "standings.games_back",
    "standings.conf_games_back",
]

TEAM_RECORD_GAME_DIMENSIONS = [
    "team_games.game_id",
    "team_games.season",
    "team_games.game_date",
    "team_games.arena",
    "team_games.arena_city",
    "team_games.team_abbreviation",
    "team_games.opponent_abbreviation",
    "team_games.location",
    "team_games.result",
]


def current_nba_season(today: date | None = None) -> str:
    day = today or date.today()
    start_year = day.year if day.month >= 10 else day.year - 1
    return f"{start_year}-{str(start_year + 1)[-2:]}"


def equals(member: str, value: Any) -> dict[str, Any]:
    return {"member": member, "operator": "equals", "values": [str(value)]}


def contains(member: str, value: str) -> dict[str, Any]:
    return {"member": member, "operator": "contains", "values": [value]}


def search_players_query(name: str) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_SEARCH_DIMENSIONS),
        "filters": [contains("players.full_name", name)] if name.strip() else [],
        "limit": 10,
    }


def player_profile_query(player_id: UUID) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_PROFILE_DIMENSIONS),
        "filters": [equals("players.player_id", player_id)],
        "limit": 1,
    }


def player_ids_query(player_ids: list[UUID]) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_COMPARE_DIMENSIONS),
        "filters": [
            {
                "member": "players.player_id",
                "operator": "equals",
                "values": [str(pid) for pid in player_ids],
            }
        ],
        "order": {"players.career_games_played": "desc"},
        "limit": max(len(player_ids), 1),
    }


def player_salary_query(player_id: UUID) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_SALARY_DIMENSIONS),
        "filters": [equals("players.player_id", player_id)],
        "limit": 1,
    }


def player_game_log_query(player_id: UUID, season: str | None = None) -> dict[str, Any]:
    resolved = season or current_nba_season()
    return {
        "dimensions": list(PLAYER_GAME_LOG_DIMENSIONS),
        "filters": [
            equals("player_game_logs.player_id", player_id),
            equals("player_game_logs.season", resolved),
        ],
        "order": {"player_game_logs.game_date": "desc"},
        "limit": 100,
    }


def player_back_to_backs_query(player_id: UUID, season: str | None = None) -> dict[str, Any]:
    filters: list[dict[str, Any]] = [equals("player_game_logs.player_id", player_id)]
    if season:
        filters.append(equals("player_game_logs.season", season))
    return {
        "measures": [
            "player_game_logs.back_to_back_games",
            "player_game_logs.games_played_in_b2b",
            "player_game_logs.games_sat_in_b2b",
            "player_game_logs.avg_points_b2b",
            "player_game_logs.avg_points_non_b2b",
            "player_game_logs.avg_points",
        ],
        "filters": filters,
        "limit": 1,
    }


def teams_played_query(player_ids: list[UUID]) -> dict[str, Any]:
    return {
        "measures": ["player_game_logs.teams_played"],
        "dimensions": ["player_game_logs.player_id"],
        "filters": [
            {
                "member": "player_game_logs.player_id",
                "operator": "equals",
                "values": [str(pid) for pid in player_ids],
            }
        ],
        "limit": max(len(player_ids), 1),
    }


def team_by_abbreviation_query(abbreviation: str) -> dict[str, Any]:
    return {
        "dimensions": list(TEAM_DIMENSIONS),
        "filters": [equals("teams.abbreviation", abbreviation.upper())],
        "limit": 1,
    }


def resolve_location_filters(
    location: str | None,
    arena_city: str | None,
) -> tuple[str | None, str | None]:
    home_away: str | None = None
    city = arena_city
    if location:
        normalized = location.strip()
        if normalized.lower() in _HOME_AWAY:
            home_away = normalized.lower()
        elif city is None:
            city = normalized
    return home_away, city


def team_record_filters(
    team_abbreviation: str,
    opponent_abbreviation: str | None = None,
    location: str | None = None,
    since_season: str | None = None,
    season: str | None = None,
    arena_city: str | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    home_away, city = resolve_location_filters(location, arena_city)
    filters: list[dict[str, Any]] = [
        equals("team_games.team_abbreviation", team_abbreviation.upper()),
    ]
    if opponent_abbreviation:
        filters.append(equals("team_games.opponent_abbreviation", opponent_abbreviation.upper()))
    if home_away:
        filters.append(equals("team_games.location", home_away))
    if city:
        filters.append(contains("team_games.arena_city", city))
    if since_season:
        filters.append({"member": "team_games.season", "operator": "gte", "values": [since_season]})
    if season:
        filters.append(equals("team_games.season", season))
    applied = {
        "team_abbreviation": team_abbreviation.upper(),
        "opponent_abbreviation": (opponent_abbreviation.upper() if opponent_abbreviation else None),
        "location": home_away,
        "arena_city": city,
        "since_season": since_season,
        "season": season,
    }
    return filters, applied


def team_record_query(
    team_abbreviation: str,
    opponent_abbreviation: str | None = None,
    location: str | None = None,
    since_season: str | None = None,
    season: str | None = None,
    arena_city: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    filters, applied = team_record_filters(
        team_abbreviation,
        opponent_abbreviation=opponent_abbreviation,
        location=location,
        since_season=since_season,
        season=season,
        arena_city=arena_city,
    )
    query = {
        "measures": ["team_games.wins", "team_games.losses", "team_games.games"],
        "dimensions": [
            "team_games.team_id",
            "team_games.team_abbreviation",
            "team_games.team_name",
        ],
        "filters": filters,
        "limit": 1,
    }
    return query, applied


def team_record_games_query(
    team_abbreviation: str,
    opponent_abbreviation: str | None = None,
    location: str | None = None,
    since_season: str | None = None,
    season: str | None = None,
    arena_city: str | None = None,
) -> dict[str, Any]:
    filters, _applied = team_record_filters(
        team_abbreviation,
        opponent_abbreviation=opponent_abbreviation,
        location=location,
        since_season=since_season,
        season=season,
        arena_city=arena_city,
    )
    return {
        "dimensions": list(TEAM_RECORD_GAME_DIMENSIONS),
        "filters": filters,
        "order": {"team_games.game_date": "desc"},
        "limit": 500,
    }


def standings_seasons_query() -> dict[str, Any]:
    return {
        "dimensions": ["standings.season"],
        "measures": ["standings.count"],
        "order": {"standings.season": "desc"},
        "limit": 1,
    }


def team_games_seasons_query() -> dict[str, Any]:
    """Latest Regular Season with team-game results (Ask overlay when official standings are empty)."""
    return {
        "dimensions": ["team_games.season"],
        "measures": ["team_games.games"],
        "filters": [equals("team_games.season_type", "Regular Season")],
        "order": {"team_games.season": "desc"},
        "limit": 1,
    }


def standings_query(season: str | None = None, conference: str | None = None) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if season:
        filters.append(equals("standings.season", season))
    normalized = normalize_conference(conference)
    if normalized:
        filters.append(equals("standings.conference", normalized))
    return {
        "dimensions": list(STANDINGS_DIMENSIONS),
        "filters": filters,
        "order": {"standings.conference_rank": "asc"},
        "limit": 30,
    }


def game_standings_query(
    season: str | None = None, conference: str | None = None
) -> dict[str, Any]:
    """Regular Season W–L by team from team_games (same overlay REST uses when fct_standings is empty)."""
    filters: list[dict[str, Any]] = [equals("team_games.season_type", "Regular Season")]
    if season:
        filters.append(equals("team_games.season", season))
    normalized = normalize_conference(conference)
    if normalized:
        filters.append(equals("teams.conference", normalized))
    return {
        "measures": ["team_games.wins", "team_games.losses", "team_games.games"],
        "dimensions": [
            "team_games.team_id",
            "team_games.team_abbreviation",
            "team_games.team_name",
            "team_games.season",
            "teams.conference",
            "teams.division",
        ],
        "filters": filters,
        "limit": 30,
    }


def normalize_conference(conference: str | None) -> str | None:
    if conference is None or not str(conference).strip():
        return None
    lowered = conference.strip().lower()
    if lowered in {"east", "eastern"}:
        return "East"
    if lowered in {"west", "western"}:
        return "West"
    return conference.strip()


def project_compare_stats(
    rows: list[dict[str, Any]],
    stats: list[str] | None = None,
) -> list[dict[str, Any]]:
    if not stats:
        keys = ("player_id", "full_name", *DEFAULT_COMPARE_STATS)
        return [{key: row.get(key) for key in keys} for row in rows]

    selected: list[str] = []
    seen: set[str] = set()
    for stat in stats:
        mapped = STAT_ALIASES.get(stat.strip().lower(), stat.strip())
        if mapped not in seen:
            selected.append(mapped)
            seen.add(mapped)

    result = []
    for row in rows:
        projected: dict[str, Any] = {
            "player_id": row.get("player_id"),
            "full_name": row.get("full_name"),
        }
        for key in selected:
            projected[key] = row.get(key)
        result.append(projected)
    return result


PLAYER_SEASON_STATS_DIMENSIONS = [
    "player_season_stats.player_id",
    "players.full_name",
    "player_season_stats.season",
    "player_season_stats.games_played",
    "player_season_stats.ppg",
    "player_season_stats.rpg",
    "player_season_stats.apg",
]

PLAYER_CONTRACT_SEASON_DIMENSIONS = [
    "player_contracts.player_id",
    "player_contracts.player_name",
    "player_contracts.season",
    "player_contracts.salary",
    "player_contracts.remaining_guaranteed",
    "player_contracts.team_abbreviation",
    "player_contracts.match_method",
]

TEAM_PAYROLL_SEASON_DIMENSIONS = [
    "team_payroll.team_id",
    "team_payroll.abbreviation",
    "team_payroll.team_name",
    "team_payroll.season",
    "team_payroll.total_salary",
    "team_payroll.remaining_guaranteed",
]

GAMES_SCHEDULE_DIMENSIONS = [
    "games_schedule.game_id",
    "games_schedule.season",
    "games_schedule.season_type",
    "games_schedule.game_date",
    "games_schedule.status",
    "games_schedule.arena",
    "games_schedule.arena_city",
    "games_schedule.home_team_id",
    "games_schedule.home_team",
    "games_schedule.home_team_name",
    "games_schedule.home_score",
    "games_schedule.away_team_id",
    "games_schedule.away_team",
    "games_schedule.away_team_name",
    "games_schedule.away_score",
]

GAME_PREDICTIONS_DIMENSIONS = [
    "game_predictions.game_id",
    "game_predictions.as_of",
    "game_predictions.model_name",
    "game_predictions.model_version",
    "game_predictions.home_team_id",
    "game_predictions.away_team_id",
    "game_predictions.model_wp",
    "game_predictions.market_wp",
    "game_predictions.game_date",
    "game_predictions.season",
    "game_predictions.game_status",
]

PLAYER_INJURIES_DIMENSIONS = [
    "player_injuries.player_id",
    "player_injuries.player_name",
    "player_injuries.team_abbreviation",
    "player_injuries.update_date",
    "player_injuries.description",
    "player_injuries.match_method",
    "player_injuries.team_id",
]

GAME_ODDS_DIMENSIONS = [
    "game_odds.odds_event_id",
    "game_odds.game_id",
    "game_odds.commence_time",
    "game_odds.home_team_name",
    "game_odds.away_team_name",
    "game_odds.bookmaker",
    "game_odds.market",
    "game_odds.home_price",
    "game_odds.away_price",
    "game_odds.home_market_wp",
    "game_odds.away_market_wp",
    "game_odds.spread_home",
]

PLAY_BY_PLAY_DIMENSIONS = [
    "play_by_play.game_id",
    "play_by_play.season",
    "play_by_play.action_number",
    "play_by_play.action_id",
    "play_by_play.period",
    "play_by_play.clock",
    "play_by_play.score_home",
    "play_by_play.score_away",
    "play_by_play.team_id",
    "play_by_play.player_id",
    "play_by_play.action_type",
    "play_by_play.sub_type",
    "play_by_play.description",
]

REDDIT_POSTS_DIMENSIONS = [
    "reddit_posts.reddit_id",
    "reddit_posts.subreddit",
    "reddit_posts.title",
    "reddit_posts.author",
    "reddit_posts.score",
    "reddit_posts.num_comments",
    "reddit_posts.created_utc",
    "reddit_posts.permalink",
    "reddit_posts.flair",
]

PBP_DEFAULT_LIMIT = 200
PBP_MAX_LIMIT = 500
TRANSACTIONS_DIMENSIONS = [
    "transactions.transaction_key",
    "transactions.transaction_date",
    "transactions.season",
    "transactions.description",
]

TRANSACTION_PARTICIPANTS_DIMENSIONS = [
    "transaction_participants.transaction_key",
    "transaction_participants.transaction_date",
    "transaction_participants.season",
    "transaction_participants.participant_type",
    "transaction_participants.direction",
    "transaction_participants.display_name",
    "transaction_participants.team_abbreviation",
    "transaction_participants.player_name",
    "transaction_participants.player_id",
    "transaction_participants.team_id",
]

TRANSACTIONS_DEFAULT_LIMIT = 50
TRANSACTIONS_MAX_LIMIT = 200

REDDIT_DEFAULT_LIMIT = 25
REDDIT_MAX_LIMIT = 50


def clamp_limit(value: int | None, default: int, maximum: int) -> int:
    if value is None:
        return default
    return max(1, min(int(value), maximum))


def player_season_stats_query(player_id: UUID) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_SEASON_STATS_DIMENSIONS),
        "filters": [equals("player_season_stats.player_id", player_id)],
        "order": {"player_season_stats.season": "asc"},
        "limit": 30,
    }


def player_contract_season_query(player_id: UUID, season: str) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_CONTRACT_SEASON_DIMENSIONS),
        "filters": [
            equals("player_contracts.player_id", player_id),
            equals("player_contracts.season", season),
        ],
        "limit": 5,
    }


def team_payroll_season_query(abbreviation: str, season: str) -> dict[str, Any]:
    return {
        "dimensions": list(TEAM_PAYROLL_SEASON_DIMENSIONS),
        "filters": [
            equals("team_payroll.abbreviation", abbreviation.upper()),
            equals("team_payroll.season", season),
        ],
        "limit": 1,
    }


def games_schedule_query(
    season: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if season:
        filters.append(equals("games_schedule.season", season))
    if status:
        filters.append(equals("games_schedule.status", status))
    return {
        "dimensions": list(GAMES_SCHEDULE_DIMENSIONS),
        "filters": filters,
        "order": {"games_schedule.game_date": "asc"},
        "limit": clamp_limit(limit, 50, 200),
    }


def game_predictions_query(
    game_id: UUID | None = None,
    upcoming: bool = False,
    limit: int = 50,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if game_id:
        filters.append(equals("game_predictions.game_id", game_id))
    if upcoming:
        filters.append(
            {
                "member": "game_predictions.game_status",
                "operator": "notEquals",
                "values": ["Final"],
            }
        )
    return {
        "dimensions": list(GAME_PREDICTIONS_DIMENSIONS),
        "filters": filters,
        "order": {"game_predictions.game_date": "asc"},
        "limit": clamp_limit(limit, 50, 100),
    }


def player_injuries_query(
    player_id: UUID | None = None,
    team_abbreviation: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if player_id is not None:
        filters.append(equals("player_injuries.player_id", player_id))
    if team_abbreviation:
        filters.append(equals("player_injuries.team_abbreviation", team_abbreviation.upper()))
    return {
        "dimensions": list(PLAYER_INJURIES_DIMENSIONS),
        "filters": filters,
        "order": {"player_injuries.update_date": "desc"},
        "limit": clamp_limit(limit, 50, 100),
    }


def game_odds_query(
    game_id: UUID | None = None,
    limit: int = 100,
    now: datetime | None = None,
) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if game_id:
        filters.append(equals("game_odds.game_id", game_id))
    else:
        # game_odds keeps each played game's last pregame line as history, so
        # the unfiltered slate has to be bounded to games that have not tipped.
        # commence_time is naive UTC.
        cutoff = (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%S")
        filters.append(
            {"member": "game_odds.commence_time", "operator": "afterDate", "values": [cutoff]}
        )
    return {
        "dimensions": list(GAME_ODDS_DIMENSIONS),
        "filters": filters,
        "order": {"game_odds.commence_time": "asc"},
        "limit": clamp_limit(limit, 100, 200),
    }


def play_by_play_query(game_id: UUID, limit: int | None = None) -> dict[str, Any]:
    return {
        "dimensions": list(PLAY_BY_PLAY_DIMENSIONS),
        "filters": [equals("play_by_play.game_id", game_id)],
        "order": {"play_by_play.action_number": "asc"},
        "limit": clamp_limit(limit, PBP_DEFAULT_LIMIT, PBP_MAX_LIMIT),
    }


def reddit_posts_query(search: str | None = None, limit: int | None = None) -> dict[str, Any]:
    filters: list[dict[str, Any]] = []
    if search and search.strip():
        filters.append(contains("reddit_posts.title", search.strip()))
    return {
        "dimensions": list(REDDIT_POSTS_DIMENSIONS),
        "filters": filters,
        "order": {"reddit_posts.created_utc": "desc"},
        "limit": clamp_limit(limit, REDDIT_DEFAULT_LIMIT, REDDIT_MAX_LIMIT),
    }


def transactions_query(
    season: str | None = None,
    search: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """The log itself. Use transaction_participants_query to filter by who."""
    filters: list[dict[str, Any]] = []
    if season and season.strip():
        filters.append(equals("transactions.season", season.strip()))
    if search and search.strip():
        filters.append(contains("transactions.description", search.strip()))
    return {
        "dimensions": list(TRANSACTIONS_DIMENSIONS),
        "filters": filters,
        "order": {"transactions.transaction_date": "desc"},
        "limit": clamp_limit(limit, TRANSACTIONS_DEFAULT_LIMIT, TRANSACTIONS_MAX_LIMIT),
    }


PLAYER_MVP_DIMENSIONS = [
    "player_mvp_scores.player_id",
    "players.full_name",
    "teams.abbreviation",
    "player_mvp_scores.season",
    "player_mvp_scores.season_type",
    "player_mvp_scores.mvp_rank",
    "player_mvp_scores.mvp_score",
    "player_mvp_scores.avg_game_score",
    "player_mvp_scores.avg_box_score",
    "player_mvp_scores.availability_multiplier",
    "player_mvp_scores.games_played",
    "player_mvp_scores.team_games",
    "player_mvp_scores.games_missed_pct",
    "player_mvp_scores.wins",
    "player_mvp_scores.losses",
    "player_mvp_scores.win_pct",
]

MVP_LADDER_DEFAULT_LIMIT = 25
MVP_LADDER_MAX_LIMIT = 100

_MVP_SEASON_TYPES = {
    "regular season": "Regular Season",
    "regular": "Regular Season",
    "playoffs": "Playoffs",
    "playoff": "Playoffs",
    "postseason": "Playoffs",
}


def normalize_mvp_season_type(season_type: str | None) -> str:
    """Only the Regular Season and Playoffs are scored; default to the Regular Season."""
    if season_type is None or not season_type.strip():
        return "Regular Season"
    resolved = _MVP_SEASON_TYPES.get(season_type.strip().lower())
    if resolved is None:
        raise ValueError(
            "season_type must be 'Regular Season' or 'Playoffs'; "
            "play-in games and the Cup final are not scored"
        )
    return resolved


def mvp_seasons_query() -> dict[str, Any]:
    return {
        "dimensions": ["player_mvp_scores.season"],
        "measures": ["player_mvp_scores.count"],
        "order": {"player_mvp_scores.season": "desc"},
        "limit": 1,
    }


def mvp_ladder_query(
    season: str,
    season_type: str = "Regular Season",
    limit: int | None = None,
) -> dict[str, Any]:
    return {
        "dimensions": list(PLAYER_MVP_DIMENSIONS),
        "filters": [
            equals("player_mvp_scores.season", season),
            equals("player_mvp_scores.season_type", season_type),
        ],
        "order": {"player_mvp_scores.mvp_rank": "asc"},
        "limit": clamp_limit(limit, MVP_LADDER_DEFAULT_LIMIT, MVP_LADDER_MAX_LIMIT),
    }


def player_mvp_scores_query(player_id: UUID, season: str | None = None) -> dict[str, Any]:
    filters: list[dict[str, Any]] = [equals("player_mvp_scores.player_id", player_id)]
    if season and season.strip():
        filters.append(equals("player_mvp_scores.season", season.strip()))
    return {
        "dimensions": list(PLAYER_MVP_DIMENSIONS),
        "filters": filters,
        # "Regular Season" sorts after "Playoffs", so desc lists it first within a season.
        "order": {
            "player_mvp_scores.season": "desc",
            "player_mvp_scores.season_type": "desc",
        },
        "limit": 60,
    }


def transaction_participants_query(
    player_id: UUID | None = None,
    team_abbreviation: str | None = None,
    season: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Who moved. A team both sending and receiving in one trade is two rows."""
    filters: list[dict[str, Any]] = []
    if player_id is not None:
        filters.append(equals("transaction_participants.player_id", player_id))
    if team_abbreviation:
        filters.append(
            equals(
                "transaction_participants.team_abbreviation",
                team_abbreviation.upper(),
            )
        )
    if season and season.strip():
        filters.append(equals("transaction_participants.season", season.strip()))
    return {
        "dimensions": list(TRANSACTION_PARTICIPANTS_DIMENSIONS),
        "filters": filters,
        "order": {"transaction_participants.transaction_date": "desc"},
        "limit": clamp_limit(limit, TRANSACTIONS_DEFAULT_LIMIT, TRANSACTIONS_MAX_LIMIT),
    }


GAME_UPSETS_DIMENSIONS = [
    "game_upsets.game_id",
    "game_upsets.season",
    "game_upsets.season_type",
    "game_upsets.game_date",
    "game_upsets.away_team_abbreviation",
    "game_upsets.home_team_abbreviation",
    "game_upsets.away_score",
    "game_upsets.home_score",
    "game_upsets.underdog_team_abbreviation",
    "game_upsets.underdog_market_wp",
    "game_upsets.underdog_fair_moneyline",
    "game_upsets.underdog_best_moneyline",
    "game_upsets.bookmaker_count",
    "game_upsets.upset_magnitude",
    "game_upsets.upset_rank",
    "game_upsets.model_winner_wp",
    "game_upsets.model_called_upset",
]

UPSETS_DEFAULT_LIMIT = 10
UPSETS_MAX_LIMIT = 50


def upset_seasons_query() -> dict[str, Any]:
    return {
        "dimensions": ["game_upsets.season"],
        "measures": ["game_upsets.upsets"],
        "filters": [equals("game_upsets.is_upset", "true")],
        "order": {"game_upsets.season": "desc"},
        "limit": 1,
    }


def biggest_upsets_query(
    season: str,
    season_type: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    filters = [
        equals("game_upsets.season", season),
        equals("game_upsets.is_upset", "true"),
    ]
    if season_type and season_type.strip():
        filters.append(equals("game_upsets.season_type", season_type.strip()))
    return {
        "dimensions": list(GAME_UPSETS_DIMENSIONS),
        "filters": filters,
        # upset_rank restarts per season_type; magnitude orders across them.
        "order": {"game_upsets.upset_magnitude": "desc"},
        "limit": clamp_limit(limit, UPSETS_DEFAULT_LIMIT, UPSETS_MAX_LIMIT),
    }
