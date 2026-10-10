"""Signed-in chat, mounted under ``/account``.

Never called by a browser: see ``routers/account.py`` for the token gate.
"""

from baseline_analytics.operations import CubeAnalytics
from fastapi import APIRouter, Depends, HTTPException, status
from services.chat import ChatRequestError, run_chat

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_cube_analytics,
    get_current_user,
    get_flags_repository,
    require_accounts_token,
    require_flag,
)
from repositories.account import (
    AccountRepository,
    ChatInFlightError,
    ChatQuotaExceededError,
)
from repositories.flags import FlagsRepository
from schemas.account import ChatRequest, ChatResponse

router = APIRouter(dependencies=[Depends(require_accounts_token)])

CHATBOT_FLAG = "chatbot"


@router.post("/chat", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
    flags: FlagsRepository = Depends(get_flags_repository),
    cube: CubeAnalytics = Depends(get_cube_analytics),
    settings: Settings = Depends(get_settings),
) -> ChatResponse:
    require_flag(flags, CHATBOT_FLAG, "Chat")
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
