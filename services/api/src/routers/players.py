from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_players_repository
from queries.players import (
    COMPARE_STAT_COLUMNS,
    GAME_LOG_SORT_COLUMNS,
    PLAYER_SORT_ORDERS,
    build_head_to_head,
)
from repositories.players import PlayersRepository
from schemas import (
    BackToBackStats,
    GameLogEntry,
    HeadToHeadComparison,
    ItemResponse,
    PaginatedResponse,
    PaginationMeta,
    PlayerComparison,
    PlayerDetail,
    PlayerSeasonStats,
    PlayerSummary,
)

router = APIRouter()


@router.get("/compare", response_model=PaginatedResponse[PlayerComparison])
def compare_players(
    ids: Annotated[str, Query(description="Comma-separated player IDs")],
    stat: Annotated[str, Query()] = "games_played",
    season: Annotated[
        str | None, Query(description="MVP season; defaults to the latest scored")
    ] = None,
    repo: PlayersRepository = Depends(get_players_repository),
) -> PaginatedResponse[PlayerComparison]:
    try:
        player_ids = [UUID(part.strip()) for part in ids.split(",") if part.strip()]
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="ids must be a comma-separated list of UUIDs"
        ) from exc

    if len(player_ids) < 2:
        raise HTTPException(status_code=400, detail="Provide at least two player ids to compare")

    column = COMPARE_STAT_COLUMNS.get(stat)
    if column is None:
        allowed = ", ".join(sorted(COMPARE_STAT_COLUMNS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported stat '{stat}'. Allowed: {allowed}",
        )

    rows = repo.compare_players(player_ids, column, season)
    found_ids = {row["player_id"] for row in rows}
    missing = [pid for pid in player_ids if pid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Player not found: {', '.join(str(pid) for pid in missing)}",
        )

    data = [PlayerComparison.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )


@router.get("/compare/head-to-head", response_model=ItemResponse[HeadToHeadComparison])
def compare_players_head_to_head(
    ids: Annotated[str, Query(description="Exactly two comma-separated player IDs")],
    repo: PlayersRepository = Depends(get_players_repository),
) -> ItemResponse[HeadToHeadComparison]:
    try:
        player_ids = [UUID(part.strip()) for part in ids.split(",") if part.strip()]
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail="ids must be a comma-separated list of UUIDs"
        ) from exc

    if len(player_ids) != 2:
        raise HTTPException(
            status_code=400, detail="Provide exactly two player ids for head-to-head"
        )
    if player_ids[0] == player_ids[1]:
        raise HTTPException(status_code=400, detail="Player ids must be distinct")

    players = repo.list_players_by_ids(player_ids)
    found_ids = {row["player_id"] for row in players}
    missing = [pid for pid in player_ids if pid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=404,
            detail=f"Player not found: {', '.join(str(pid) for pid in missing)}",
        )

    logs = repo.list_head_to_head_logs(player_ids[0], player_ids[1])
    payload = build_head_to_head(players, logs, player_ids)
    return ItemResponse(data=HeadToHeadComparison.model_validate(payload))


@router.get("", response_model=PaginatedResponse[PlayerSummary])
def list_players(
    search: Annotated[str | None, Query()] = None,
    active: Annotated[bool | None, Query()] = None,
    team_id: Annotated[UUID | None, Query()] = None,
    season: Annotated[
        str | None, Query(description="MVP season; defaults to the latest scored")
    ] = None,
    sort: Annotated[str, Query()] = "name",
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: PlayersRepository = Depends(get_players_repository),
) -> PaginatedResponse[PlayerSummary]:
    if sort not in PLAYER_SORT_ORDERS:
        allowed = ", ".join(sorted(PLAYER_SORT_ORDERS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported sort '{sort}'. Allowed: {allowed}",
        )
    total, rows = repo.list_players(
        search=search,
        active=active,
        team_id=team_id,
        season=season,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    data = [PlayerSummary.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{player_id}", response_model=ItemResponse[PlayerDetail])
def get_player(
    player_id: UUID,
    repo: PlayersRepository = Depends(get_players_repository),
) -> ItemResponse[PlayerDetail]:
    row = repo.get_player(player_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return ItemResponse(data=PlayerDetail.model_validate(row))


@router.get("/{player_id}/game-log", response_model=PaginatedResponse[GameLogEntry])
def get_player_game_log(
    player_id: UUID,
    season: Annotated[str | None, Query()] = None,
    is_back_to_back: Annotated[bool | None, Query()] = None,
    sort: Annotated[str, Query()] = "game_date",
    order: Annotated[str, Query()] = "desc",
    limit: Annotated[int, Query(ge=1, le=500)] = 82,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: PlayersRepository = Depends(get_players_repository),
) -> PaginatedResponse[GameLogEntry]:
    if not repo.player_exists(player_id):
        raise HTTPException(status_code=404, detail="Player not found")
    order_column = GAME_LOG_SORT_COLUMNS.get(sort)
    if order_column is None:
        allowed = ", ".join(sorted(set(GAME_LOG_SORT_COLUMNS)))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported sort '{sort}'. Allowed: {allowed}",
        )
    normalized_order = order.lower()
    if normalized_order not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail="order must be 'asc' or 'desc'")
    total, rows = repo.list_game_logs(
        player_id,
        season=season,
        is_back_to_back=is_back_to_back,
        order_column=order_column,
        descending=normalized_order == "desc",
        limit=limit,
        offset=offset,
    )
    data = [GameLogEntry.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{player_id}/season-stats", response_model=PaginatedResponse[PlayerSeasonStats])
def get_player_season_stats(
    player_id: UUID,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: PlayersRepository = Depends(get_players_repository),
) -> PaginatedResponse[PlayerSeasonStats]:
    if not repo.player_exists(player_id):
        raise HTTPException(status_code=404, detail="Player not found")
    total, rows = repo.list_season_stats(player_id, limit=limit, offset=offset)
    data = [PlayerSeasonStats.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{player_id}/back-to-backs", response_model=ItemResponse[BackToBackStats])
def get_player_back_to_backs(
    player_id: UUID,
    season: Annotated[str | None, Query()] = None,
    repo: PlayersRepository = Depends(get_players_repository),
) -> ItemResponse[BackToBackStats]:
    player = repo.get_player_name(player_id)
    if player is None:
        raise HTTPException(status_code=404, detail="Player not found")

    stats = repo.get_back_to_back_stats(player_id, season)
    return ItemResponse(
        data=BackToBackStats(
            player_id=player["player_id"],
            player_name=player["full_name"],
            season=season,
            total_back_to_backs=int(stats["total_back_to_backs"] or 0),
            games_played_in_b2b=int(stats["games_played_in_b2b"] or 0),
            games_sat_in_b2b=int(stats.get("games_sat_in_b2b") or 0),
            avg_pts_b2b=float(stats["avg_pts_b2b"]) if stats["avg_pts_b2b"] is not None else None,
            avg_pts_non_b2b=(
                float(stats["avg_pts_non_b2b"]) if stats["avg_pts_non_b2b"] is not None else None
            ),
        )
    )
