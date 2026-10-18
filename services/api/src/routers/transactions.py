from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from dependencies import get_transactions_repository
from repositories.transactions import TransactionsRepository
from routers.params import normalize_team
from schemas import (
    PaginatedResponse,
    PaginationMeta,
    Transaction,
)

router = APIRouter()


@router.get("", response_model=PaginatedResponse[Transaction])
def list_transactions(
    season: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query()] = None,
    team_abbreviation: Annotated[str | None, Query()] = None,
    player_id: Annotated[UUID | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: TransactionsRepository = Depends(get_transactions_repository),
) -> PaginatedResponse[Transaction]:
    total, rows = repo.list_transactions(
        season=season,
        search=search.strip() if search and search.strip() else None,
        team_abbreviation=normalize_team(team_abbreviation),
        player_id=player_id,
        limit=limit,
        offset=offset,
    )
    return PaginatedResponse(
        data=[Transaction.model_validate(row) for row in rows],
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )
