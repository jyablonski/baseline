"""The signed-in account itself: created at sign-in, read, and deleted.

Never called by a browser. The Next.js server checks the session, then calls
here with ``ACCOUNTS_API_TOKEN`` and the caller's internal id in
``X-Baseline-User``. With the token unset every route returns 503. Chat and
picks share the ``/account`` prefix and that gate from their own modules.
"""

from fastapi import APIRouter, Depends, Response, status
from services.chat import chat_quota

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_current_user,
    require_accounts_token,
)
from repositories.account import AccountRepository
from schemas import ItemResponse
from schemas.account import AccountProfile, AccountUser, UserUpsert

router = APIRouter(dependencies=[Depends(require_accounts_token)])


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
