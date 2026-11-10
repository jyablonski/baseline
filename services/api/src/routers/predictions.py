from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_predictions_repository
from repositories.predictions import PredictionsRepository
from routers.params import normalize_team
from schemas import (
    CalibrationBucket,
    ItemResponse,
    LiveModelWeights,
    PaginatedResponse,
    PaginationMeta,
    PredictionGame,
    PredictionScorecard,
)

router = APIRouter()


@router.get("/scorecard", response_model=ItemResponse[PredictionScorecard])
def get_prediction_scorecard(
    season: Annotated[str | None, Query()] = None,
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> ItemResponse[PredictionScorecard]:
    return ItemResponse(data=PredictionScorecard.model_validate(repo.get_scorecard(season=season)))


@router.get("/weights", response_model=ItemResponse[LiveModelWeights | None])
def get_live_model_weights(
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> ItemResponse[LiveModelWeights | None]:
    """What the live model weighs on its newest run; null before any run stored it."""
    row = repo.get_live_model_weights()
    return ItemResponse(data=None if row is None else LiveModelWeights.model_validate(row))


@router.get("/calibration", response_model=ItemResponse[list[CalibrationBucket]])
def get_prediction_calibration(
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> ItemResponse[list[CalibrationBucket]]:
    """How often the live model's home teams won, by what it said beforehand."""
    return ItemResponse(
        data=[CalibrationBucket.model_validate(row) for row in repo.get_calibration()]
    )


@router.get("/games", response_model=PaginatedResponse[PredictionGame])
def list_prediction_games(
    team: Annotated[str | None, Query(description="Either side of the game")] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> PaginatedResponse[PredictionGame]:
    """The live model's graded games, newest first; `meta.total` counts every match."""
    team = normalize_team(team)
    return PaginatedResponse(
        data=[
            PredictionGame.model_validate(row)
            for row in repo.list_games(team=team, limit=limit, offset=offset)
        ],
        meta=PaginationMeta(total=repo.count_games(team=team), limit=limit, offset=offset),
    )
