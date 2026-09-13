from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from queries.players import (
    BACK_TO_BACK_STATS,
    COMPARE_STAT_COLUMNS,
    HEAD_TO_HEAD_LOGS,
    LIST_GAME_LOGS_COUNT,
    LIST_PLAYERS_COUNT,
    LIST_SEASON_STATS,
    LIST_SEASON_STATS_COUNT,
    PLAYER_BY_ID,
    PLAYER_EXISTS,
    PLAYER_NAME,
    PLAYERS_BY_IDS,
    compare_players_stmt,
    list_game_logs_stmt,
    list_players_stmt,
)

__all__ = ["COMPARE_STAT_COLUMNS", "PlayersRepository"]


class PlayersRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def player_exists(self, player_id: UUID) -> bool:
        row = self.db.execute(PLAYER_EXISTS, {"player_id": player_id}).first()
        return row is not None

    def list_players(
        self,
        *,
        search: str | None,
        active: bool | None,
        team_id: UUID | None = None,
        season: str | None = None,
        sort: str = "name",
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        search_pattern = f"%{search}%" if search else None
        params = {
            "search": search_pattern,
            "active": active,
            "team_id": team_id,
            "season": season,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_PLAYERS_COUNT, params).scalar_one()
        rows = self.db.execute(list_players_stmt(sort), params)
        return int(total), [dict(row._mapping) for row in rows]

    def get_player(self, player_id: UUID) -> dict | None:
        row = (
            self.db.execute(PLAYER_BY_ID, {"player_id": player_id, "season": None})
            .mappings()
            .first()
        )
        return dict(row) if row is not None else None

    def compare_players(
        self, player_ids: list[UUID], order_column: str, season: str | None = None
    ) -> list[dict]:
        stmt = compare_players_stmt(order_column)
        params = {"player_ids": player_ids, "season": season}
        return [dict(row._mapping) for row in self.db.execute(stmt, params)]

    def list_players_by_ids(self, player_ids: list[UUID]) -> list[dict]:
        return [
            dict(row._mapping)
            for row in self.db.execute(PLAYERS_BY_IDS, {"player_ids": player_ids})
        ]

    def list_head_to_head_logs(self, player_a: UUID, player_b: UUID) -> list[dict]:
        return [
            dict(row._mapping)
            for row in self.db.execute(
                HEAD_TO_HEAD_LOGS, {"player_a": player_a, "player_b": player_b}
            )
        ]

    def get_player_name(self, player_id: UUID) -> dict | None:
        row = self.db.execute(PLAYER_NAME, {"player_id": player_id}).mappings().first()
        return dict(row) if row is not None else None

    def list_game_logs(
        self,
        player_id: UUID,
        *,
        season: str | None,
        is_back_to_back: bool | None = None,
        order_column: str = "game_date",
        descending: bool = True,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {
            "player_id": player_id,
            "season": season,
            "is_back_to_back": is_back_to_back,
            "limit": limit,
            "offset": offset,
        }
        total = self.db.execute(LIST_GAME_LOGS_COUNT, params).scalar_one()
        rows = self.db.execute(list_game_logs_stmt(order_column, descending), params)
        return int(total), [dict(row._mapping) for row in rows]

    def list_season_stats(
        self,
        player_id: UUID,
        *,
        limit: int,
        offset: int,
    ) -> tuple[int, list[dict]]:
        params = {"player_id": player_id, "limit": limit, "offset": offset}
        total = self.db.execute(LIST_SEASON_STATS_COUNT, params).scalar_one()
        rows = self.db.execute(LIST_SEASON_STATS, params)
        return int(total), [dict(row._mapping) for row in rows]

    def get_back_to_back_stats(self, player_id: UUID, season: str | None) -> dict:
        row = (
            self.db.execute(
                BACK_TO_BACK_STATS,
                {"player_id": player_id, "season": season},
            )
            .mappings()
            .one()
        )
        return dict(row)
