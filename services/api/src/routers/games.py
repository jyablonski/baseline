from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_games_repository, get_injuries_repository
from repositories.games import GamesRepository
from repositories.injuries import InjuriesRepository
from routers.params import normalize_team, validate_season_type
from schemas import (
    BoxScoreRow,
    ClosestGame,
    GameCollapse,
    GameDate,
    GameDetail,
    GameFlow,
    GameHighlight,
    GameInjury,
    GameResult,
    GameUpset,
    ItemResponse,
    LargestMarginGame,
    PaginatedResponse,
    PaginationMeta,
    PlayByPlayEvent,
    SeasonListResponse,
)

router = APIRouter()
seasons_router = APIRouter()


@router.get("/collapses", response_model=PaginatedResponse[GameCollapse])
def list_biggest_collapses(
    season: Annotated[str | None, Query()] = None,
    team: Annotated[
        str | None, Query(description="Either side: the team that blew it or came back")
    ] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameCollapse]:
    """Games ranked by the biggest lead the losing team gave up."""
    rows = repo.list_biggest_collapses(
        season=season,
        team=normalize_team(team),
        limit=limit,
        offset=offset,
    )
    data = [GameCollapse.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=offset),
    )


@router.get("/closest", response_model=PaginatedResponse[ClosestGame])
def list_closest_games(
    season: Annotated[str | None, Query()] = None,
    team: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[ClosestGame]:
    """Final games by smallest margin, then most lead changes, then most overtime."""
    rows = repo.list_closest_games(
        season=season, team=normalize_team(team), limit=limit, offset=offset
    )
    data = [ClosestGame.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=offset),
    )


@router.get("/largest-margins", response_model=PaginatedResponse[LargestMarginGame])
def list_largest_margins(
    season: Annotated[str | None, Query()] = None,
    team: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[LargestMarginGame]:
    """Final games by winning margin, biggest first."""
    rows = repo.list_largest_margins(
        season=season, team=normalize_team(team), limit=limit, offset=offset
    )
    data = [LargestMarginGame.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=offset),
    )


@router.get("/dates", response_model=PaginatedResponse[GameDate])
def list_game_dates(
    season: Annotated[str | None, Query()] = None,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameDate]:
    """Every date with a Final game, newest first. Unpaginated."""
    rows = repo.list_game_dates(season=season)
    data = [GameDate.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=len(data), offset=0),
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


@router.get("/upsets", response_model=PaginatedResponse[GameUpset])
def list_upsets(
    season: Annotated[str | None, Query()] = None,
    season_type: Annotated[str | None, Query()] = None,
    team: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameUpset]:
    """Games the market underdog won, biggest surprise first.

    Without season this is the newest season with any upsets. Empty, not an
    error, until Final games with captured pregame lines exist.
    """
    rows = repo.list_upsets(
        season=season,
        season_type=validate_season_type(season_type),
        team=normalize_team(team),
        limit=limit,
        offset=offset,
    )
    data = [GameUpset.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=len(data), limit=limit, offset=offset),
    )


@router.get("", response_model=PaginatedResponse[GameResult])
def list_recent_games(
    season: Annotated[str | None, Query()] = None,
    season_type: Annotated[str | None, Query()] = None,
    game_date: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: GamesRepository = Depends(get_games_repository),
) -> PaginatedResponse[GameResult]:
    total, rows = repo.list_games(
        season=season,
        season_type=validate_season_type(season_type),
        game_date=game_date,
        limit=limit,
        offset=offset,
    )
    data = [GameResult.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


# Declared after the fixed paths above: /collapses, /closest, /largest-margins, /dates,
# /highlights and /upsets would otherwise be parsed as a game id and fail UUID validation.
@router.get("/{game_id}", response_model=ItemResponse[GameDetail])
def get_game(
    game_id: UUID,
    repo: GamesRepository = Depends(get_games_repository),
) -> ItemResponse[GameDetail]:
    """One game in any state: preview before tip, result once Final."""
    row = repo.get_game(game_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Game not found")
    return ItemResponse(data=GameDetail.model_validate(row))


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


@router.get("/{game_id}/injuries", response_model=PaginatedResponse[GameInjury])
def get_game_injuries(
    game_id: UUID,
    games: GamesRepository = Depends(get_games_repository),
    injuries: InjuriesRepository = Depends(get_injuries_repository),
) -> PaginatedResponse[GameInjury]:
    """Both teams' injury report for one game. Empty when no report was on file."""
    if not games.game_on_schedule(game_id):
        raise HTTPException(status_code=404, detail="Game not found")
    rows = injuries.list_game_injuries(game_id)
    data = [GameInjury.model_validate(row) for row in rows]
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
