from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_standings_repository
from repositories.standings import StandingsRepository
from schemas import PaginatedResponse, PaginationMeta, StandingRow

router = APIRouter()


def _validate_conference(conference: str | None) -> str | None:
    if conference is None:
        return None
    normalized = conference.strip().lower()
    if normalized not in {"east", "west"}:
        raise HTTPException(status_code=400, detail="conference must be 'East' or 'West'")
    return normalized.title()


@router.get("", response_model=PaginatedResponse[StandingRow])
def list_standings(
    season: Annotated[str | None, Query()] = None,
    conference: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: StandingsRepository = Depends(get_standings_repository),
) -> PaginatedResponse[StandingRow]:
    total, rows = repo.list_standings(
        season=season,
        conference=_validate_conference(conference),
        limit=limit,
        offset=offset,
    )
    data = [StandingRow.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )
