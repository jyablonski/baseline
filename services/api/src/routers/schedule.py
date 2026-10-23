from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_games_repository
from repositories.games import GamesRepository
from schemas import GameDate, PaginatedResponse, PaginationMeta, ScheduledGame

router = APIRouter()


@router.get("", response_model=PaginatedResponse[ScheduledGame])
def list_schedule(
    season: Annotated[str | None, Query()] = None,
    status: Annotated[str, Query()] = "Scheduled",
    from_date: Annotated[date | None, Query()] = None,
    team_id: Annotated[UUID | None, Query()] = None,
    opponent_team_id: Annotated[UUID | None, Query()] = None,
    location: Annotated[Literal["home", "away"] | None, Query()] = None,
    arena_city: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[ScheduledGame]:
    total, rows = repo.list_schedule(
        season=season,
        status=status,
        from_date=from_date or date.today(),
        team_id=team_id,
        opponent_team_id=opponent_team_id,
        location=location,
        arena_city=arena_city,
        limit=limit,
        offset=offset,
    )
    data = [ScheduledGame.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/dates", response_model=PaginatedResponse[GameDate])
def list_schedule_dates(
    season: Annotated[str | None, Query()] = None,
    from_date: Annotated[date | None, Query()] = None,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameDate]:
    """Every date with a game still to play from from_date (default today), oldest first. Unpaginated."""
    rows = repo.list_schedule_dates(season=season, from_date=from_date or date.today())
    data = [GameDate.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )
