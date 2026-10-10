from baseline_analytics.operations import CubeAnalytics
from fastapi import APIRouter, Depends
from services.nlp.factory import build_nlp_provider

from config import Settings, get_settings
from dependencies import get_cube_analytics
from schemas.game import QueryRequest, QueryResponse

router = APIRouter()


@router.post(
    "/query",
    response_model=QueryResponse,
)
def natural_language_query(
    body: QueryRequest,
    cube: CubeAnalytics = Depends(get_cube_analytics),
    settings: Settings = Depends(get_settings),
) -> QueryResponse:
    provider = build_nlp_provider(cube=cube, settings=settings)
    return provider.answer(body.question, season=body.season)
