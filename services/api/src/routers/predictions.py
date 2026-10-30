from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_predictions_repository
from repositories.predictions import PredictionsRepository
from schemas import (
    CalibrationBucket,
    ItemResponse,
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
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> PaginatedResponse[PredictionGame]:
    """The live model's graded games, newest first."""
    return PaginatedResponse(
        data=[
            PredictionGame.model_validate(row)
            for row in repo.list_games(limit=limit, offset=offset)
        ],
        meta=PaginationMeta(total=repo.count_games(), limit=limit, offset=offset),
    )
