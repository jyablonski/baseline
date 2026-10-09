"""Signed-in features: the account itself, chat, and game picks.

Never called by a browser. The Next.js server checks the session, then calls
here with ``ACCOUNTS_API_TOKEN`` and the caller's internal id in
``X-Baseline-User``. With the token unset every route returns 503.
"""

from uuid import UUID

from cube.analytics import CubeAnalytics
from fastapi import APIRouter, Depends, HTTPException, Response, status
from services.chat import ChatRequestError, chat_quota, run_chat

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_cube_analytics,
    get_current_user,
    get_flags_repository,
    require_accounts_token,
)
from repositories.account import (
    AccountRepository,
    ChatInFlightError,
    ChatQuotaExceededError,
    PickError,
    summarise_picks,
)
from repositories.flags import FlagsRepository
from schemas import ItemResponse
from schemas.account import (
    AccountProfile,
    AccountUser,
    ChatRequest,
    ChatResponse,
    Pick,
    PickRequest,
    PickSheet,
    PickSummary,
    UserUpsert,
)

router = APIRouter(dependencies=[Depends(require_accounts_token)])

CHATBOT_FLAG = "chatbot"
PICKS_FLAG = "picks"


def _require_flag(flags: FlagsRepository, flag_key: str, label: str) -> None:
    if not flags.is_enabled(flag_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{label} is turned off right now.",
        )


def require_picks_enabled(flags: FlagsRepository = Depends(get_flags_repository)) -> None:
    _require_flag(flags, PICKS_FLAG, "Picks")


@router.post("/users", response_model=ItemResponse[AccountUser])
def upsert_user(
    body: UserUpsert,
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[AccountUser]:
    """Called at sign-in: create the account on first sight, touch it after."""
    user = repo.upsert_user(
        provider=body.provider,
        provider_subject=body.provider_subject,
        display_name=body.display_name,
    )
    return ItemResponse(data=AccountUser.model_validate(user))


@router.get("/me", response_model=ItemResponse[AccountProfile])
def get_me(
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
    settings: Settings = Depends(get_settings),
) -> ItemResponse[AccountProfile]:
    return ItemResponse(
        data=AccountProfile(
            user=AccountUser.model_validate(user),
            chat=chat_quota(repo, user["user_id"], settings),
        )
    )


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> Response:
    """Remove the account with its usage rows and picks."""
    repo.delete_user(user["user_id"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
    flags: FlagsRepository = Depends(get_flags_repository),
    cube: CubeAnalytics = Depends(get_cube_analytics),
    settings: Settings = Depends(get_settings),
) -> ChatResponse:
    _require_flag(flags, CHATBOT_FLAG, "Chat")
    try:
        return run_chat(
            user_id=user["user_id"],
            messages=body.messages,
            season=body.season,
            repo=repo,
            cube=cube,
            settings=settings,
        )
    except ChatQuotaExceededError as exc:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)) from exc
    except ChatInFlightError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ChatRequestError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        # The provider call failed, or its reply would not parse. The detail is
        # ours, never the provider's response or a parser message, which could
        # echo request headers or internals.
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The answer service did not respond. Try again in a moment.",
        ) from exc


def _pick_sheet(repo: AccountRepository, user_id: UUID) -> PickSheet:
    picks = repo.list_picks(user_id)
    return PickSheet(
        summary=PickSummary(**summarise_picks(picks)),
        picks=[Pick.model_validate(pick) for pick in picks],
    )


@router.get(
    "/picks",
    response_model=ItemResponse[PickSheet],
    dependencies=[Depends(require_picks_enabled)],
)
def list_picks(
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[PickSheet]:
    """Every pick with its grade, plus the record and the net of settled stakes."""
    return ItemResponse(data=_pick_sheet(repo, user["user_id"]))


@router.put(
    "/picks/{game_id}",
    response_model=ItemResponse[PickSheet],
    dependencies=[Depends(require_picks_enabled)],
)
def save_pick(
    game_id: UUID,
    body: PickRequest,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[PickSheet]:
    """Pick a winner, optionally with a stake. Open until tip."""
    try:
        repo.save_pick(
            user["user_id"],
            game_id=game_id,
            picked_team_id=body.picked_team_id,
            stake=body.stake,
        )
    except PickError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ItemResponse(data=_pick_sheet(repo, user["user_id"]))


@router.delete(
    "/picks/{game_id}",
    response_model=ItemResponse[PickSheet],
    dependencies=[Depends(require_picks_enabled)],
)
def delete_pick(
    game_id: UUID,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[PickSheet]:
    try:
        repo.delete_pick(user["user_id"], game_id)
    except PickError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ItemResponse(data=_pick_sheet(repo, user["user_id"]))
