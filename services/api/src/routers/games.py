from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_games_repository
from repositories.games import GamesRepository
from schemas import (
    BoxScoreRow,
    GameCollapse,
    GameFlow,
    GameHighlight,
    GameResult,
    ItemResponse,
    PaginatedResponse,
    PaginationMeta,
    PlayByPlayEvent,
    SeasonListResponse,
)

router = APIRouter()
seasons_router = APIRouter()


def _validate_season_type(season_type: str | None) -> str | None:
    if season_type is None:
        return None
    key = season_type.strip().lower().replace("-", "").replace(" ", "")
    mapping = {
        "regularseason": "Regular Season",
        "cup": "Cup",
        "nbacup": "Cup",
        "playoffs": "Playoffs",
        "playin": "PlayIn",
    }
    if key not in mapping:
        raise HTTPException(
            status_code=400,
            detail="season_type must be Regular Season, Cup, Playoffs, or PlayIn",
        )
    return mapping[key]


@router.get("/collapses", response_model=PaginatedResponse[GameCollapse])
def list_biggest_collapses(
    season: Annotated[str | None, Query()] = None,
    blown_lead_team: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameCollapse]:
    """Games ranked by the biggest lead the losing team gave up."""
    # Abbreviation, not team_id: gold.fct_game_flow denormalizes both sides to
    # abbreviations and never carries the ids.
    rows = repo.list_biggest_collapses(
        season=season,
        blown_lead_team=blown_lead_team.upper() if blown_lead_team else None,
        limit=limit,
    )
    data = [GameCollapse.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=0),
    )


@router.get("/highlights", response_model=PaginatedResponse[GameHighlight])
def list_daily_highlights(
    season: Annotated[str | None, Query()] = None,
    game_date: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=30)] = 15,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameHighlight]:
    """Each game's lead highlight for one day, most notable first.

    Without game_date this is the newest day that has games, so the caller
    does not have to know when the last slate was.
    """
    rows = repo.list_daily_highlights(season=season, game_date=game_date, limit=limit)
    data = [GameHighlight.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=0),
    )


@router.get("", response_model=PaginatedResponse[GameResult])
def list_recent_games(
    season: Annotated[str | None, Query()] = None,
    season_type: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameResult]:
    total, rows = repo.list_games(
        season=season,
        season_type=_validate_season_type(season_type),
        limit=limit,
        offset=offset,
    )
    data = [GameResult.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{game_id}/play-by-play", response_model=PaginatedResponse[PlayByPlayEvent])
def get_game_play_by_play(
    game_id: UUID,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[PlayByPlayEvent]:
    if not repo.game_exists(game_id):
        raise HTTPException(status_code=404, detail="Game not found")
    rows = repo.list_play_by_play(game_id)
    data = [PlayByPlayEvent.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )


@router.get("/{game_id}/box-score", response_model=PaginatedResponse[BoxScoreRow])
def get_game_box_score(
    game_id: UUID,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[BoxScoreRow]:
    """Player lines for one game, home team first, then by minutes played."""
    if not repo.game_exists(game_id):
        raise HTTPException(status_code=404, detail="Game not found")
    rows = repo.list_box_score(game_id)
    data = [BoxScoreRow.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
    )


@router.get("/{game_id}/flow", response_model=ItemResponse[GameFlow])
def get_game_flow(
    game_id: UUID,
    repo: GamesRepository = Depends(get_games_repository),
) -> ItemResponse[GameFlow]:
    row = repo.get_game_flow(game_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return ItemResponse(data=GameFlow.model_validate(row))


@seasons_router.get("/seasons", response_model=SeasonListResponse)
def list_seasons(
    repo: GamesRepository = Depends(get_games_repository),
) -> SeasonListResponse:
    seasons = repo.list_seasons()
    return SeasonListResponse(
        data=seasons,
        meta=PaginationMeta(total=len(seasons), limit=len(seasons), offset=0),
    )
