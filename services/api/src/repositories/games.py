from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy.orm import Session

from queries.games import (
    GAME_EXISTS,
    GAME_ON_SCHEDULE,
    GET_GAME,
    GET_GAME_FLOW,
    LIST_BIGGEST_COLLAPSES,
    LIST_BOX_SCORE,
    LIST_CLOSEST_GAMES,
    LIST_DAILY_HIGHLIGHTS,
    LIST_GAME_DATES,
    LIST_GAMES,
    LIST_GAMES_COUNT,
    LIST_LARGEST_MARGINS,
    LIST_PLAY_BY_PLAY,
    LIST_SCHEDULE,
    LIST_SCHEDULE_COUNT,
    LIST_SEASONS,
    LIST_UPSETS,
)


class GamesRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def list_games(
        self,
        *,
        season: str | None,
        season_type: str | None = None,
        game_date: date | None = None,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "season": season,
            "season_type": season_type,
            "game_date": game_date,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_GAMES_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_GAMES, params)
        return int(total), [dict(row._mapping) for row in rows]

    def list_schedule(
        self,
        *,
        season: str | None,
        status: str | None,
        from_date: date,
        limit: int,
        offset: int,
        team_id: UUID | None = None,
        opponent_team_id: UUID | None = None,
        location: str | None = None,
        arena_city: str | None = None,
    ) -> tuple[int, list[dict]]:
        params = {
            "season": season,
            "status": status,
            "from_date": from_date,
            "team_id": team_id,
            "opponent_team_id": opponent_team_id,
            "location": location,
            "arena_city": f"%{arena_city}%" if arena_city else None,
            # The odds CTEs are shared with GET_GAME, which narrows them to one game.
            "game_id": None,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_SCHEDULE_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_SCHEDULE, params)
        return int(total), [_with_moneylines(dict(row._mapping)) for row in rows]

    def get_game(self, game_id: UUID) -> dict | None:
        row = self.db.execute(GET_GAME, {"game_id": game_id}).first()
        if row is None:
            return None
        return _with_moneylines(dict(row._mapping))

    def list_biggest_collapses(
        self,
        *,
        season: str | None,
        team: str | None,
        limit: int,
        offset: int,
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_BIGGEST_COLLAPSES,
            {
                "season": season,
                "team": team,
                "limit": limit,
                "offset": offset,
            },
        )
        return [dict(row._mapping) for row in rows]

    def list_closest_games(
        self, *, season: str | None, team: str | None, limit: int, offset: int
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_CLOSEST_GAMES,
            {"season": season, "team": team, "limit": limit, "offset": offset},
        )
        return [dict(row._mapping) for row in rows]

    def list_largest_margins(
        self, *, season: str | None, team: str | None, limit: int, offset: int
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_LARGEST_MARGINS,
            {"season": season, "team": team, "limit": limit, "offset": offset},
        )
        return [dict(row._mapping) for row in rows]

    def list_game_dates(self, *, season: str | None) -> list[dict]:
        rows = self.db.execute(LIST_GAME_DATES, {"season": season})
        return [dict(row._mapping) for row in rows]

    def list_upsets(
        self,
        *,
        season: str | None,
        season_type: str | None,
        limit: int,
        team: str | None = None,
        offset: int = 0,
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_UPSETS,
            {
                "season": season,
                "season_type": season_type,
                "team": team,
                # The shared absences CTE can narrow to one game; here it covers all.
                "game_id": None,
                "limit": limit,
                "offset": offset,
            },
        )
        return [dict(row._mapping) for row in rows]

    def list_daily_highlights(
        self, *, season: str | None, game_date: date | None, limit: int
    ) -> list[dict]:
        rows = self.db.execute(
            LIST_DAILY_HIGHLIGHTS,
            {"season": season, "game_date": game_date, "limit": limit},
        )
        return [dict(row._mapping) for row in rows]

    def list_seasons(self) -> list[str]:
        rows = self.db.execute(LIST_SEASONS)
        return [row[0] for row in rows]

    def game_exists(self, game_id: UUID) -> bool:
        value = self.db.execute(GAME_EXISTS, {"game_id": game_id}).scalar()
        return bool(value)

    def game_on_schedule(self, game_id: UUID) -> bool:
        return bool(self.db.execute(GAME_ON_SCHEDULE, {"game_id": game_id}).scalar())

    def list_play_by_play(self, game_id: UUID) -> list[dict]:
        rows = self.db.execute(LIST_PLAY_BY_PLAY, {"game_id": game_id})
        return [dict(row._mapping) for row in rows]

    def list_box_score(self, game_id: UUID) -> list[dict]:
        rows = self.db.execute(LIST_BOX_SCORE, {"game_id": game_id})
        return [dict(row._mapping) for row in rows]

    def get_game_flow(self, game_id: UUID) -> dict | None:
        row = self.db.execute(GET_GAME_FLOW, {"game_id": game_id}).first()
        if row is None:
            return None
        payload = dict(row._mapping)
        payload["has_play_by_play"] = payload.get("scoring_play_count") is not None
        return payload


def american_moneyline(implied_wp: float | None) -> int | None:
    """Convert a (vigged) implied win probability back to an American price."""
    if implied_wp is None:
        return None
    probability = float(implied_wp)
    if not 0 < probability < 1:
        return None
    if probability >= 0.5:
        return -round(100 * probability / (1 - probability))
    return round(100 * (1 - probability) / probability)


def _with_moneylines(row: dict) -> dict:
    row["home_moneyline"] = american_moneyline(row.pop("home_implied_wp", None))
    row["away_moneyline"] = american_moneyline(row.pop("away_implied_wp", None))
    return row
