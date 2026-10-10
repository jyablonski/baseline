from fastapi import APIRouter, Depends

from config import Settings, get_settings
from dependencies import get_flags_repository
from repositories.flags import FlagsRepository
from schemas import ItemResponse

router = APIRouter()


@router.get("", response_model=ItemResponse[dict[str, bool]])
def list_features(
    repo: FlagsRepository = Depends(get_flags_repository),
    settings: Settings = Depends(get_settings),
) -> ItemResponse[dict[str, bool]]:
    """Which switchable features the UI should offer. Public.

    The chatbot needs more than its flag: with no model key there is nothing
    for it to add over the rules-based /ask, so the site offers Ask instead.
    It is one or the other, never both.
    """
    features = {flag["flag_key"]: bool(flag["enabled"]) for flag in repo.list_flags()}
    if not (settings.nlp_llm_api_key or "").strip():
        features["chatbot"] = False
    return ItemResponse(data=features)
