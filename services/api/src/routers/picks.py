"""Game picks for a signed-in account, mounted under ``/account``.

Never called by a browser: see ``routers/account.py`` for the token gate.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from dependencies import (
    get_account_repository,
    get_current_user,
    get_flags_repository,
    require_accounts_token,
    require_flag,
)
from repositories.account import AccountRepository, PickError, summarise_picks
from repositories.flags import FlagsRepository
from schemas import ItemResponse
from schemas.account import Pick, PickRequest, PickSheet, PickSummary

PICKS_FLAG = "picks"


def require_picks_enabled(flags: FlagsRepository = Depends(get_flags_repository)) -> None:
    require_flag(flags, PICKS_FLAG, "Picks")


router = APIRouter(
    dependencies=[Depends(require_accounts_token), Depends(require_picks_enabled)],
)


def _pick_sheet(repo: AccountRepository, user_id: UUID) -> PickSheet:
    picks = repo.list_picks(user_id)
    return PickSheet(
        summary=PickSummary(**summarise_picks(picks)),
        picks=[Pick.model_validate(pick) for pick in picks],
    )


@router.get("/picks", response_model=ItemResponse[PickSheet])
def list_picks(
    user: dict = Depends(get_current_user),
    repo: AccountRepository = Depends(get_account_repository),
) -> ItemResponse[PickSheet]:
    """Every pick with its grade, plus the record and the net of settled stakes."""
    return ItemResponse(data=_pick_sheet(repo, user["user_id"]))


@router.put("/picks/{game_id}", response_model=ItemResponse[PickSheet])
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


@router.delete("/picks/{game_id}", response_model=ItemResponse[PickSheet])
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
