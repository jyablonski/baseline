from typing import Annotated

from fastapi import APIRouter, Depends, Query

from dependencies import get_predictions_repository
from repositories.predictions import PredictionsRepository
from schemas import ItemResponse, PredictionScorecard

router = APIRouter()


@router.get("/scorecard", response_model=ItemResponse[PredictionScorecard])
def get_prediction_scorecard(
    season: Annotated[str | None, Query()] = None,
    repo: PredictionsRepository = Depends(get_predictions_repository),
) -> ItemResponse[PredictionScorecard]:
    return ItemResponse(data=PredictionScorecard.model_validate(repo.get_scorecard(season=season)))
