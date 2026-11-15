"""The signed-in account itself: created at sign-in, read, and deleted.

Never called by a browser. The Next.js server checks the session, then calls
here with ``ACCOUNTS_API_TOKEN`` and the caller's internal id in
``X-Baseline-User``. With the token unset every route returns 503. Chat and
picks share the ``/account`` prefix and that gate from their own modules.
"""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from services.chat import chat_quota

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_current_user,
    require_accounts_token,
)
from repositories.account import (
    AccountRepository,
    FollowLimitError,
    FollowNotFoundError,
    FollowOrderError,
)
from schemas import ItemResponse
from schemas.account import (
    AccountProfile,
    AccountUser,
    Follow,
    FollowOrder,
    TimezoneUpdate,
    UserUpsert,
)

router = APIRouter(dependencies=[Depends(require_accounts_token)])

# Only teams can be followed so far; the table also allows players.
FollowType = Literal["team"]


def _follows(repo: AccountRepository, user_id: UUID) -> list[Follow]:
    return [Follow.model_validate(row) for row in repo.list_follows(user_id)]


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
            follows=_follows(repo, user["user_id"]),
        )
    )


@router.put("/me/timezone", response_model=ItemResponse[AccountUser])
def set_my_timezone(
    body: TimezoneUpdate,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[AccountUser]:
    """Choose the time zone game times are shown in; null is the Eastern default."""
    updated = repo.set_timezone(user["user_id"], body.timezone)
    return ItemResponse(data=AccountUser.model_validate(updated))


@router.put("/me/follows/{entity_type}", response_model=ItemResponse[list[Follow]])
def reorder_follows(
    entity_type: FollowType,
    body: FollowOrder,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[list[Follow]]:
    """Set the order follows are shown in. The body must list every one."""
    try:
        repo.reorder_follows(user["user_id"], entity_type=entity_type, entity_ids=body.entity_ids)
    except FollowOrderError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ItemResponse(data=_follows(repo, user["user_id"]))


@router.put("/me/follows/{entity_type}/{entity_id}", response_model=ItemResponse[list[Follow]])
def follow(
    entity_type: FollowType,
    entity_id: UUID,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
    settings: Settings = Depends(get_settings),
) -> ItemResponse[list[Follow]]:
    """Follow a team; already following it is not an error. Returns every follow."""
    try:
        repo.follow(
            user["user_id"],
            entity_type=entity_type,
            entity_id=entity_id,
            max_follows=settings.follow_max_teams,
        )
    except FollowNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except FollowLimitError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return ItemResponse(data=_follows(repo, user["user_id"]))


@router.delete("/me/follows/{entity_type}/{entity_id}", response_model=ItemResponse[list[Follow]])
def unfollow(
    entity_type: FollowType,
    entity_id: UUID,
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[list[Follow]]:
    """Stop following a team; not following it is not an error. Returns every follow."""
    repo.unfollow(user["user_id"], entity_type=entity_type, entity_id=entity_id)
    return ItemResponse(data=_follows(repo, user["user_id"]))


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
def delete_me(
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> Response:
    """Remove the account with its usage rows, picks and follows."""
    repo.delete_user(user["user_id"])
    return Response(status_code=status.HTTP_204_NO_CONTENT)
