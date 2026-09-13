"""Named Ask/MCP operations implemented as Cube queries."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from cube.client import CubeClient
from cube.errors import CubeError
from cube.queries import (
    game_odds_query,
    game_predictions_query,
    game_standings_query,
    games_schedule_query,
    mvp_ladder_query,
    mvp_seasons_query,
    normalize_mvp_season_type,
    play_by_play_query,
    player_back_to_backs_query,
    player_contract_season_query,
    player_game_log_query,
    player_ids_query,
    player_injuries_query,
    player_mvp_scores_query,
    player_profile_query,
    player_salary_query,
    player_season_stats_query,
    project_compare_stats,
    reddit_posts_query,
    search_players_query,
    standings_query,
    standings_seasons_query,
    team_by_abbreviation_query,
    team_games_seasons_query,
    team_payroll_season_query,
    team_record_games_query,
    team_record_query,
    teams_played_query,
    transaction_participants_query,
    transactions_query,
)
from standings_rank import apply_derived_ranks


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(float(value))
    except TypeError, ValueError:
        return None


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        return None


def _round_optional(value: Any, digits: int = 1) -> float | None:
    number = _as_float(value)
    if number is None:
        return None
    return round(number, digits)


class CubeAnalytics:
    def __init__(self, client: CubeClient) -> None:
        self.client = client

    def meta_summary(self) -> str:
        return self.client.meta_summary()

    def run_cube_query(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        return self.client.load(query)

    def search_players(self, name: str) -> list[dict[str, Any]]:
        rows = self.client.load(search_players_query(name))
        return [_player_search_row(row) for row in rows]

    def get_player(self, player_id: UUID) -> dict[str, Any] | None:
        rows = self.client.load(player_profile_query(player_id))
        if not rows:
            return None
        return _player_profile_row(rows[0])

    def get_player_game_log(
        self,
        player_id: UUID,
        season: str | None = None,
    ) -> list[dict[str, Any]]:
        return self.client.load(player_game_log_query(player_id, season))

    def get_back_to_back_stats(
        self,
        player_id: UUID,
        season: str | None = None,
    ) -> dict[str, Any]:
        player = self.get_player(player_id)
        rows = self.client.load(player_back_to_backs_query(player_id, season))
        stats = rows[0] if rows else {}
        total = _as_int(stats.get("back_to_back_games")) or 0
        played = _as_int(stats.get("games_played_in_b2b"))
        sat = _as_int(stats.get("games_sat_in_b2b"))
        if played is None:
            played = 0
        if sat is None:
            sat = max(total - played, 0)
        return {
            "player_id": player_id,
            "player_name": (player or {}).get("full_name"),
            "season": season,
            "total_back_to_backs": total,
            "games_played_in_b2b": played,
            "games_sat_in_b2b": sat,
            "avg_pts_b2b": _round_optional(stats.get("avg_points_b2b")),
            "avg_pts_non_b2b": _round_optional(stats.get("avg_points_non_b2b")),
            "avg_pts_overall": _round_optional(stats.get("avg_points")),
        }

    def get_player_back_to_backs(
        self,
        player_id: UUID,
        season: str | None = None,
    ) -> dict[str, Any]:
        return self.get_back_to_back_stats(player_id, season)

    def get_career_stats(self, player_id: UUID) -> dict[str, Any] | None:
        player = self.get_player(player_id)
        if player is None:
            return None
        teams = self.client.load(teams_played_query([player_id]))
        teams_played = _as_int(teams[0].get("teams_played")) if teams else 0
        games = _as_int(player.get("career_games_played")) or 0
        ppg = _as_float(player.get("career_ppg"))
        total_points = None
        if ppg is not None:
            total_points = round(ppg * games)
        return {
            **player,
            "total_games": games,
            "total_points": total_points,
            "ppg": player.get("career_ppg"),
            "rpg": player.get("career_rpg"),
            "apg": player.get("career_apg"),
            "teams_played_for": teams_played,
        }

    def compare_players(
        self,
        player_ids: list[UUID],
        stats: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        if len(player_ids) < 2:
            raise ValueError("compare_players requires at least 2 player_ids")
        rows = self.client.load(player_ids_query(player_ids))
        teams_rows = self.client.load(teams_played_query(player_ids))
        teams_by_id = {
            UUID(str(row.get("player_id"))): _as_int(row.get("teams_played")) or 0
            for row in teams_rows
        }
        enriched = []
        for row in rows:
            profile = _player_profile_row(row)
            games = _as_int(profile.get("career_games_played")) or 0
            ppg = _as_float(profile.get("career_ppg"))
            total_points = round(ppg * games) if ppg is not None else None
            pid = UUID(str(profile.get("player_id")))
            enriched.append(
                {
                    **profile,
                    "total_games": games,
                    "total_points": total_points,
                    "teams_played_for": teams_by_id.get(pid, 0),
                }
            )
        enriched.sort(
            key=lambda row: (
                -(_as_int(row.get("career_games_played")) or 0),
                str(row.get("full_name") or ""),
            )
        )
        return project_compare_stats(enriched, stats)

    def find_team(self, abbreviation: str) -> dict[str, Any] | None:
        rows = self.client.load(team_by_abbreviation_query(abbreviation))
        if not rows:
            return None
        row = rows[0]
        return {
            "team_id": UUID(str(row.get("team_id"))),
            "abbreviation": row.get("abbreviation"),
            "team_name": row.get("team_name"),
            "current_season_payroll": _as_int(row.get("current_season_payroll")),
            "current_remaining_guaranteed": _as_int(row.get("current_remaining_guaranteed")),
            "current_contract_season": row.get("current_contract_season"),
        }

    def get_team_record(
        self,
        team_abbreviation: str,
        opponent_abbreviation: str | None = None,
        location: str | None = None,
        since_season: str | None = None,
        season: str | None = None,
        arena_city: str | None = None,
    ) -> dict[str, Any]:
        query, applied = team_record_query(
            team_abbreviation,
            opponent_abbreviation=opponent_abbreviation,
            location=location,
            since_season=since_season,
            season=season,
            arena_city=arena_city,
        )
        summary_rows = self.client.load(query)
        games = self.client.load(
            team_record_games_query(
                team_abbreviation,
                opponent_abbreviation=opponent_abbreviation,
                location=location,
                since_season=since_season,
                season=season,
                arena_city=arena_city,
            )
        )
        summary = summary_rows[0] if summary_rows else {}
        wins = _as_int(summary.get("wins")) or 0
        losses = _as_int(summary.get("losses")) or 0
        total = _as_int(summary.get("games")) or (wins + losses)
        win_pct = round(wins / total, 3) if total else None
        abbreviation = summary.get("team_abbreviation") or team_abbreviation.upper()
        team_name = summary.get("team_name")
        team_id = UUID(str(summary.get("team_id"))) if summary.get("team_id") else None
        if not team_name:
            team = self.find_team(abbreviation)
            if team:
                team_name = team.get("team_name")
                team_id = team_id or team.get("team_id")
        return {
            "team_id": team_id,
            "abbreviation": abbreviation,
            "team_name": team_name,
            "wins": wins,
            "losses": losses,
            "win_pct": win_pct,
            "games": total,
            "game_list": games,
            "filters_applied": applied,
        }

    def get_player_contract(
        self,
        player_id: UUID,
        season: str | None = None,
    ) -> dict[str, Any] | None:
        if season:
            rows = self.client.load(player_contract_season_query(player_id, season))
            if not rows:
                return None
            row = rows[0]
            return {
                "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else player_id,
                "full_name": row.get("player_name"),
                "current_contract_season": row.get("season") or season,
                "current_season_salary": _as_int(row.get("salary")),
                "current_remaining_guaranteed": _as_int(row.get("remaining_guaranteed")),
                "team_abbreviation": row.get("team_abbreviation"),
                "match_method": row.get("match_method"),
                "source": "player_contracts",
            }
        rows = self.client.load(player_salary_query(player_id))
        if not rows:
            return None
        row = rows[0]
        return {
            "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else player_id,
            "full_name": row.get("full_name"),
            "current_contract_season": row.get("current_contract_season"),
            "current_season_salary": _as_int(row.get("current_season_salary")),
            "current_remaining_guaranteed": _as_int(row.get("current_remaining_guaranteed")),
        }

    def get_team_payroll(
        self,
        abbreviation: str,
        season: str | None = None,
    ) -> dict[str, Any] | None:
        if season:
            rows = self.client.load(team_payroll_season_query(abbreviation, season))
            if not rows:
                return None
            row = rows[0]
            return {
                "team_id": UUID(str(row.get("team_id"))) if row.get("team_id") else None,
                "abbreviation": row.get("abbreviation") or abbreviation.upper(),
                "team_name": row.get("team_name"),
                "current_season_payroll": _as_int(row.get("total_salary")),
                "current_remaining_guaranteed": _as_int(row.get("remaining_guaranteed")),
                "current_contract_season": row.get("season") or season,
                "source": "team_payroll",
            }
        return self.find_team(abbreviation)

    def get_player_season_stats(self, player_id: UUID) -> list[dict[str, Any]]:
        rows = self.client.load(player_season_stats_query(player_id))
        return [
            {
                "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else player_id,
                "full_name": row.get("full_name"),
                "season": row.get("season"),
                "games_played": _as_int(row.get("games_played")) or 0,
                "ppg": _as_float(row.get("ppg")),
                "rpg": _as_float(row.get("rpg")),
                "apg": _as_float(row.get("apg")),
            }
            for row in rows
        ]

    def get_mvp_ladder(
        self,
        season: str | None = None,
        season_type: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        resolved_type = normalize_mvp_season_type(season_type)
        resolved_season = season or self._latest_mvp_season()
        if resolved_season is None:
            return {"season": None, "season_type": resolved_type, "players": []}
        rows = self.client.load(mvp_ladder_query(resolved_season, resolved_type, limit))
        return {
            "season": resolved_season,
            "season_type": resolved_type,
            "players": [_mvp_row(row) for row in rows],
        }

    def get_player_mvp_scores(
        self,
        player_id: UUID,
        season: str | None = None,
    ) -> list[dict[str, Any]]:
        rows = self.client.load(player_mvp_scores_query(player_id, season))
        return [_mvp_row(row) for row in rows]

    def _latest_mvp_season(self) -> str | None:
        rows = self.client.load(mvp_seasons_query())
        return rows[0].get("season") if rows else None

    def get_games_schedule(
        self,
        season: str | None = None,
        status: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return self.client.load(games_schedule_query(season=season, status=status, limit=limit))

    def get_game_predictions(
        self,
        game_id: UUID | None = None,
        upcoming: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return self.client.load(
            game_predictions_query(game_id=game_id, upcoming=upcoming, limit=limit)
        )

    def get_player_injuries(
        self,
        player_id: UUID | None = None,
        team_abbreviation: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return self.client.load(
            player_injuries_query(
                player_id=player_id,
                team_abbreviation=team_abbreviation,
                limit=limit,
            )
        )

    def get_game_odds(
        self,
        game_id: UUID | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return self.client.load(game_odds_query(game_id=game_id, limit=limit))

    def get_transactions(
        self,
        season: str | None = None,
        search: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.client.load(transactions_query(season=season, search=search, limit=limit))

    def get_transaction_participants(
        self,
        player_id: UUID | None = None,
        team_abbreviation: str | None = None,
        season: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.client.load(
            transaction_participants_query(
                player_id=player_id,
                team_abbreviation=team_abbreviation,
                season=season,
                limit=limit,
            )
        )

    def get_play_by_play(
        self,
        game_id: UUID,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.client.load(play_by_play_query(game_id, limit))

    def get_reddit_posts(
        self,
        search: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return self.client.load(reddit_posts_query(search=search, limit=limit))

    def list_standings(
        self,
        season: str | None = None,
        conference: str | None = None,
    ) -> list[dict[str, Any]]:
        resolved = self._resolve_standings_season(season)
        rows = self.client.load(standings_query(season=resolved, conference=conference))
        mapped = [_standings_row(row) for row in rows]
        if mapped:
            return mapped
        game_rows = self.client.load(game_standings_query(season=resolved, conference=conference))
        return apply_derived_ranks([_game_standings_row(row, season=resolved) for row in game_rows])

    def _resolve_standings_season(self, season: str | None) -> str | None:
        if season is not None:
            return season
        latest = self.client.load(standings_seasons_query())
        if latest:
            return latest[0].get("season")
        latest_games = self.client.load(team_games_seasons_query())
        if latest_games:
            return latest_games[0].get("season")
        return None

    def get_team_standing(
        self,
        team_id: UUID,
        season: str | None = None,
    ) -> dict[str, Any] | None:
        for row in self.list_standings(season=season, conference=None):
            if row.get("team_id") == team_id:
                return row
        return None


def _player_search_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else None,
        "full_name": row.get("full_name"),
        "position": row.get("position"),
        "team": row.get("abbreviation"),
        "is_active": row.get("is_active"),
    }


def _player_profile_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else None,
        "full_name": row.get("full_name"),
        "position": row.get("position"),
        "is_active": row.get("is_active"),
        "height": row.get("height"),
        "weight": _as_int(row.get("weight")),
        "birth_date": row.get("birth_date"),
        "first_season": row.get("first_season"),
        "last_season": row.get("last_season"),
        "career_games_played": _as_int(row.get("career_games_played")) or 0,
        "seasons_played": _as_int(row.get("seasons_played")) or 0,
        "career_ppg": _as_float(row.get("career_ppg")),
        "career_rpg": _as_float(row.get("career_rpg")),
        "career_apg": _as_float(row.get("career_apg")),
        "first_game_date": row.get("first_game_date"),
        "last_game_date": row.get("last_game_date"),
        "current_contract_season": row.get("current_contract_season"),
        "current_season_salary": _as_int(row.get("current_season_salary")),
        "current_remaining_guaranteed": _as_int(row.get("current_remaining_guaranteed")),
    }


def _mvp_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "player_id": UUID(str(row.get("player_id"))) if row.get("player_id") else None,
        "full_name": row.get("full_name"),
        "team_abbreviation": row.get("abbreviation"),
        "season": row.get("season"),
        "season_type": row.get("season_type"),
        "mvp_rank": _as_int(row.get("mvp_rank")),
        "mvp_score": _as_float(row.get("mvp_score")),
        "avg_game_score": _as_float(row.get("avg_game_score")),
        "avg_box_score": _as_float(row.get("avg_box_score")),
        "availability_multiplier": _as_float(row.get("availability_multiplier")),
        "games_played": _as_int(row.get("games_played")),
        "team_games": _as_int(row.get("team_games")),
        "games_missed_pct": _as_float(row.get("games_missed_pct")),
        "wins": _as_int(row.get("wins")),
        "losses": _as_int(row.get("losses")),
        "win_pct": _as_float(row.get("win_pct")),
    }


def _standings_row(row: dict[str, Any]) -> dict[str, Any]:
    wins = _as_int(row.get("team_wins") if row.get("team_wins") is not None else row.get("wins"))
    losses = _as_int(
        row.get("team_losses") if row.get("team_losses") is not None else row.get("losses")
    )
    return {
        "team_id": UUID(str(row.get("team_id"))) if row.get("team_id") else None,
        "abbreviation": row.get("abbreviation"),
        "team_name": row.get("team_name"),
        "season": row.get("season"),
        "season_type": row.get("season_type"),
        "as_of_date": row.get("as_of_date"),
        "conference": row.get("conference"),
        "division": row.get("division"),
        "conference_rank": _as_int(row.get("conference_rank")),
        "division_rank": _as_int(row.get("division_rank")),
        "wins": wins,
        "losses": losses,
        "win_pct": _as_float(row.get("win_pct") or row.get("avg_win_pct")),
        "games_back": _as_float(row.get("games_back") or row.get("avg_games_back")),
        "conf_games_back": _as_float(row.get("conf_games_back")),
        "streak": row.get("streak"),
        "last_10": row.get("last_10"),
    }


def _game_standings_row(row: dict[str, Any], season: str | None) -> dict[str, Any]:
    wins = _as_int(row.get("wins")) or 0
    losses = _as_int(row.get("losses")) or 0
    games = _as_int(row.get("games")) or (wins + losses)
    win_pct = round(wins / games, 3) if games else None
    return {
        "team_id": UUID(str(row.get("team_id"))) if row.get("team_id") else None,
        "abbreviation": row.get("team_abbreviation") or row.get("abbreviation"),
        "team_name": row.get("team_name"),
        "season": row.get("season") or season,
        "season_type": "Regular Season",
        "as_of_date": None,
        "conference": row.get("conference"),
        "division": row.get("division"),
        "conference_rank": None,
        "division_rank": None,
        "wins": wins,
        "losses": losses,
        "win_pct": win_pct,
        "games_back": None,
        "conf_games_back": None,
        "streak": None,
        "last_10": None,
    }


# Re-export for callers that catch any Cube failure from analytics.
CubeAnalyticsError = CubeError
