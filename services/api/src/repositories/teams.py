from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from queries.teams import (
    COMPUTE_RECORD,
    COMPUTE_RECORDS_BY_SEASON_TYPE,
    LATEST_SEASON_FOR_TEAM,
    LIST_TEAM_GAMES,
    LIST_TEAM_GAMES_COUNT,
    LIST_TEAM_SEASON_GAMES,
    LIST_TEAMS,
    LIST_TEAMS_COUNT,
    TEAM_BY_ABBREVIATION,
    TEAM_BY_ID,
)


class TeamsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def game_filter_params(
        team_id: UUID,
        *,
        season: str | None = None,
        opponent_team_id: UUID | None = None,
        location: str | None = None,
        since_season: str | None = None,
        arena_city: str | None = None,
        season_type: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict:
        params: dict = {
            "team_id": team_id,
            "season": season,
            "opponent_team_id": opponent_team_id,
            "location": location,
            "since_season": since_season,
            "arena_city": arena_city,
            "season_type": season_type,
        }
        if limit is not None:
            params["limit"] = limit
        if offset is not None:
            params["offset"] = offset
        return params

    def get_team(self, team_id: UUID) -> dict | None:
        row = self.db.execute(TEAM_BY_ID, {"team_id": team_id}).mappings().first()
        return dict(row) if row is not None else None

    def find_by_abbreviation(self, abbreviation: str) -> dict | None:
        row = (
            self.db.execute(TEAM_BY_ABBREVIATION, {"abbreviation": abbreviation}).mappings().first()
        )
        return dict(row) if row is not None else None

    def list_teams(self, *, season: str | None, limit: int, offset: int) -> tuple[int, list[dict]]:
        total = self.db.execute(LIST_TEAMS_COUNT).scalar_one()
        rows = self.db.execute(LIST_TEAMS, {"season": season, "limit": limit, "offset": offset})
        return int(total), [dict(row._mapping) for row in rows]

    def latest_season_for_team(self, team_id: UUID) -> str | None:
        return self.db.execute(LATEST_SEASON_FOR_TEAM, {"team_id": team_id}).scalar()

    def compute_record(self, team: dict, params: dict) -> dict:
        row = self.db.execute(COMPUTE_RECORD, params).mappings().one()
        return self._record_from_counts(
            team,
            int(row["games"] or 0),
            int(row["wins"] or 0),
            params,
        )

    def record_from_standing(self, team: dict, standing: dict, season: str) -> dict | None:
        """Official LeagueStandings W–L when present; games count is wins + losses."""
        if standing.get("record_source") != "official":
            return None
        wins = standing.get("wins")
        losses = standing.get("losses")
        if wins is None or losses is None:
            return None
        params = self.game_filter_params(
            team["team_id"], season=season, season_type="Regular Season"
        )
        return self._record_from_counts(team, int(wins) + int(losses), int(wins), params)

    def records_by_season_type(self, team: dict, season: str) -> dict[str, dict]:
        rows = self.db.execute(
            COMPUTE_RECORDS_BY_SEASON_TYPE,
            {"team_id": team["team_id"], "season": season},
        )
        records: dict[str, dict] = {}
        for row in rows.mappings():
            season_type = row["season_type"]
            if not season_type:
                continue
            params = self.game_filter_params(
                team["team_id"], season=season, season_type=season_type
            )
            records[season_type] = self._record_from_counts(
                team,
                int(row["games"] or 0),
                int(row["wins"] or 0),
                params,
            )
        return records

    def _record_from_counts(self, team: dict, games: int, wins: int, params: dict) -> dict:
        losses = games - wins
        win_pct = round(wins / games, 3) if games else 0.0
        return {
            "team_id": team["team_id"],
            "team_name": team["team_name"],
            "wins": wins,
            "losses": losses,
            "win_pct": win_pct,
            "games": games,
            "filters_applied": {
                "opponent_team_id": params.get("opponent_team_id"),
                "location": params.get("location"),
                "since_season": params.get("since_season"),
                "season": params.get("season"),
                "arena_city": params.get("arena_city"),
                "season_type": params.get("season_type"),
            },
        }

    def list_team_games(self, params: dict) -> tuple[int, list[dict]]:
        total = self.db.execute(LIST_TEAM_GAMES_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_TEAM_GAMES, params)
        return int(total), [dict(row._mapping) for row in rows]

    def list_team_season_games(
        self, team_id: UUID, *, season: str | None, season_type: str | None
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_TEAM_SEASON_GAMES,
            {"team_id": team_id, "season": season, "season_type": season_type},
        )
        return [dict(row._mapping) for row in rows]
