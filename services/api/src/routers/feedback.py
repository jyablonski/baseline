"""Reports from the public /feedback form.

Anyone may send one, signed in or not, but the browser still never calls this:
a Next.js server action does, with ACCOUNTS_API_TOKEN, the client's IP address
in ``X-Baseline-Client-IP`` and, when signed in, ``X-Baseline-User``. The token
is what makes those headers believable.

Guards, in order: the ``feedback`` flag, the honeypot, a per-IP hourly limit,
and a site-wide daily cap, checked under one advisory lock so concurrent sends
cannot both slip under them. The admin reads and resolves reports through
``routers/admin.py``.
"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from services.feedback import hash_ip, post_to_slack

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_feedback_repository,
    get_flags_repository,
    require_accounts_token,
    require_flag,
)
from repositories.account import AccountRepository
from repositories.feedback import FeedbackRepository
from repositories.flags import FlagsRepository
from schemas import ItemResponse
from schemas.feedback import FeedbackReceipt, FeedbackRequest

FEEDBACK_FLAG = "feedback"


def require_feedback_enabled(flags: FlagsRepository = Depends(get_flags_repository)) -> None:
    require_flag(flags, FEEDBACK_FLAG, "Feedback")


router = APIRouter(
    dependencies=[Depends(require_accounts_token), Depends(require_feedback_enabled)],
)


def _signed_in_user(header: str | None, accounts: AccountRepository) -> UUID | None:
    """The sender's account when the header names an active one, else anonymous.

    Never an error: a stale or blocked session can still report a problem, it
    just is not credited to the account.
    """
    try:
        user_id = UUID(header or "")
    except ValueError:
        return None
    user = accounts.get_user(user_id)
    return user_id if user is not None and user["status"] == "active" else None


@router.post("", response_model=ItemResponse[FeedbackReceipt], status_code=status.HTTP_201_CREATED)
def send_feedback(
    body: FeedbackRequest,
    background: BackgroundTasks,
    x_baseline_client_ip: str | None = Header(default=None),
    x_baseline_user: str | None = Header(default=None),
    repo: FeedbackRepository = Depends(get_feedback_repository),
    accounts: AccountRepository = Depends(get_account_repository),
    settings: Settings = Depends(get_settings),
) -> ItemResponse[FeedbackReceipt]:
    # The same answer a real report gets, so a bot learns nothing from it.
    if body.website:
        return ItemResponse(data=FeedbackReceipt())

    ip = (x_baseline_client_ip or "").strip()
    if not ip:
        # The server action always sends it; without it there is nothing to limit by.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing client address."
        )
    # require_accounts_token has already refused an unset token.
    ip_hash = hash_ip(ip, settings.accounts_api_token or "")

    repo.lock_limits()
    if repo.count_from_ip_last_hour(ip_hash) >= settings.feedback_ip_hourly_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="That is a lot of feedback in one hour. Try again a little later.",
        )
    if repo.count_today() >= settings.feedback_global_daily_limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Feedback is full for today. Try again tomorrow.",
        )

    report = repo.insert(
        kind=body.kind,
        message=body.message,
        reply_email=body.reply_email,
        page_path=body.page_path,
        user_id=_signed_in_user(x_baseline_user, accounts),
        ip_hash=ip_hash,
    )
    background.add_task(post_to_slack, settings.slack_webhook_url, report)
    return ItemResponse(data=FeedbackReceipt())
