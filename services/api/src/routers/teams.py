from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from dependencies import get_standings_repository, get_teams_repository
from repositories.standings import StandingsRepository
from repositories.teams import TeamsRepository
from schemas import (
    ItemResponse,
    PaginatedResponse,
    PaginationMeta,
    StandingSummary,
    TeamDetail,
    TeamRecord,
    TeamSummary,
)
from schemas.game import TeamGameResult

router = APIRouter()


def _validate_location(location: str | None) -> str | None:
    if location is None:
        return None
    normalized = location.lower()
    if normalized not in {"home", "away"}:
        raise HTTPException(status_code=400, detail="location must be 'home' or 'away'")
    return normalized


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


@router.get("", response_model=PaginatedResponse[TeamSummary])
def list_teams(
    season: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: TeamsRepository = Depends(get_teams_repository),
) -> PaginatedResponse[TeamSummary]:
    total, rows = repo.list_teams(season=season, limit=limit, offset=offset)
    data = [TeamSummary.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{team_id}", response_model=ItemResponse[TeamDetail])
def get_team(
    team_id: UUID,
    season: Annotated[str | None, Query()] = None,
    repo: TeamsRepository = Depends(get_teams_repository),
    standings_repo: StandingsRepository = Depends(get_standings_repository),
) -> ItemResponse[TeamDetail]:
    team = repo.get_team(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    latest_season = season or repo.latest_season_for_team(team_id)
    season_record = None
    play_in_record = None
    playoff_record = None
    if latest_season:
        by_type = repo.records_by_season_type(team, latest_season)
        if "Regular Season" in by_type:
            season_record = TeamRecord.model_validate(by_type["Regular Season"])
        else:
            season_record = TeamRecord.model_validate(
                repo.compute_record(
                    team,
                    repo.game_filter_params(
                        team_id,
                        season=latest_season,
                        season_type="Regular Season",
                    ),
                )
            )
        if "PlayIn" in by_type:
            play_in_record = TeamRecord.model_validate(by_type["PlayIn"])
        if "Playoffs" in by_type:
            playoff_record = TeamRecord.model_validate(by_type["Playoffs"])
    standing_row = standings_repo.get_team_standing(team_id, season=latest_season)
    standing = StandingSummary.model_validate(standing_row) if standing_row else None
    if latest_season and standing_row:
        official = repo.record_from_standing(team, standing_row, latest_season)
        if official:
            season_record = TeamRecord.model_validate(official)
    return ItemResponse(
        data=TeamDetail(
            team_id=team["team_id"],
            abbreviation=team["abbreviation"],
            team_name=team["team_name"],
            conference=team["conference"],
            division=team["division"],
            city=team.get("city"),
            nickname=team.get("nickname"),
            arena_name=team.get("arena_name"),
            arena_latitude=team.get("arena_latitude"),
            arena_longitude=team.get("arena_longitude"),
            primary_color=team.get("primary_color"),
            alternate_color=team.get("alternate_color"),
            current_season_payroll=team.get("current_season_payroll"),
            current_remaining_guaranteed=team.get("current_remaining_guaranteed"),
            current_contract_season=team.get("current_contract_season"),
            salary_cap=team.get("salary_cap"),
            luxury_tax=team.get("luxury_tax"),
            first_apron=team.get("first_apron"),
            second_apron=team.get("second_apron"),
            over_luxury_tax=team.get("over_luxury_tax"),
            over_first_apron=team.get("over_first_apron"),
            over_second_apron=team.get("over_second_apron"),
            record_season=latest_season,
            season_record=season_record,
            play_in_record=play_in_record,
            playoff_record=playoff_record,
            standing=standing,
        )
    )


@router.get("/{team_id}/games", response_model=PaginatedResponse[TeamGameResult])
def get_team_games(
    team_id: UUID,
    season: Annotated[str | None, Query()] = None,
    opponent_team_id: Annotated[UUID | None, Query()] = None,
    location: Annotated[str | None, Query()] = None,
    since_season: Annotated[str | None, Query()] = None,
    arena_city: Annotated[str | None, Query()] = None,
    season_type: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 82,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: TeamsRepository = Depends(get_teams_repository),
) -> PaginatedResponse[TeamGameResult]:
    if repo.get_team(team_id) is None:
        raise HTTPException(status_code=404, detail="Team not found")
    params = TeamsRepository.game_filter_params(
        team_id,
        season=season,
        opponent_team_id=opponent_team_id,
        location=_validate_location(location),
        since_season=since_season,
        arena_city=arena_city,
        season_type=_validate_season_type(season_type),
        limit=limit,
        offset=offset,
    )
    total, rows = repo.list_team_games(params)
    data = [TeamGameResult.model_validate(row) for row in rows]
    return PaginatedResponse(
        data=data,
        meta=PaginationMeta(total=total, limit=limit, offset=offset),
    )


@router.get("/{team_id}/record", response_model=ItemResponse[TeamRecord])
def get_team_record(
    team_id: UUID,
    opponent_team_id: Annotated[UUID | None, Query()] = None,
    location: Annotated[str | None, Query()] = None,
    since_season: Annotated[str | None, Query()] = None,
    season: Annotated[str | None, Query()] = None,
    arena_city: Annotated[str | None, Query()] = None,
    season_type: Annotated[str | None, Query()] = None,
    repo: TeamsRepository = Depends(get_teams_repository),
) -> ItemResponse[TeamRecord]:
    team = repo.get_team(team_id)
    if team is None:
        raise HTTPException(status_code=404, detail="Team not found")
    params = TeamsRepository.game_filter_params(
        team_id,
        season=season,
        opponent_team_id=opponent_team_id,
        location=_validate_location(location),
        since_season=since_season,
        arena_city=arena_city,
        season_type=_validate_season_type(season_type),
    )
    return ItemResponse(data=TeamRecord.model_validate(repo.compute_record(team, params)))
