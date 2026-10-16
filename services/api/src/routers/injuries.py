from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_injuries_repository
from repositories.injuries import InjuriesRepository
from schemas import PaginatedResponse, PaginationMeta, PlayerInjury

router = APIRouter()


@router.get("", response_model=PaginatedResponse[PlayerInjury])
def list_injuries(
    team_id: Annotated[UUID | None, Query()] = None,
    notable: Annotated[bool | None, Query()] = None,
    repo: InjuriesRepository = Depends(get_injuries_repository),
) -> PaginatedResponse[PlayerInjury]:
    """The current injury report, unpaginated: a league-wide list is a few dozen rows."""
    rows = repo.list_injuries(team_id=team_id, notable=notable)
    data = [PlayerInjury.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )
