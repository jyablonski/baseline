import secrets
from collections.abc import Generator
from uuid import UUID

from baseline_analytics.cube_client import CubeClient
from baseline_analytics.operations import CubeAnalytics
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from config import Settings, get_settings
from db import SessionLocal
from repositories.account import AccountRepository
from repositories.admin import AdminRepository
from repositories.flags import FlagsRepository
from repositories.games import GamesRepository
from repositories.players import PlayersRepository
from repositories.predictions import PredictionsRepository
from repositories.social import SocialRepository
from repositories.standings import StandingsRepository
from repositories.status import StatusRepository
from repositories.teams import TeamsRepository
from repositories.transactions import TransactionsRepository


def get_db() -> Generator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_players_repository(db: Session = Depends(get_db)) -> PlayersRepository:
    return PlayersRepository(db)


def get_predictions_repository(db: Session = Depends(get_db)) -> PredictionsRepository:
    return PredictionsRepository(db)


def get_social_repository(db: Session = Depends(get_db)) -> SocialRepository:
    return SocialRepository(db)


def get_teams_repository(db: Session = Depends(get_db)) -> TeamsRepository:
    return TeamsRepository(db)


def get_games_repository(db: Session = Depends(get_db)) -> GamesRepository:
    return GamesRepository(db)


def get_standings_repository(db: Session = Depends(get_db)) -> StandingsRepository:
    return StandingsRepository(db)


def get_status_repository(db: Session = Depends(get_db)) -> StatusRepository:
    return StatusRepository(db)


def get_transactions_repository(db: Session = Depends(get_db)) -> TransactionsRepository:
    return TransactionsRepository(db)


def get_admin_repository(db: Session = Depends(get_db)) -> AdminRepository:
    return AdminRepository(db)


def get_account_repository(db: Session = Depends(get_db)) -> AccountRepository:
    return AccountRepository(db)


def get_flags_repository(db: Session = Depends(get_db)) -> FlagsRepository:
    return FlagsRepository(db)


def require_flag(flags: FlagsRepository, flag_key: str, label: str) -> None:
    if not flags.is_enabled(flag_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{label} is turned off right now.",
        )


# auto_error=False so a missing header reaches our handler and returns the same
# shape as a wrong one, rather than FastAPI's default 403.
_admin_bearer = HTTPBearer(auto_error=False, description="ADMIN_API_TOKEN")


def _require_bearer(
    credentials: HTTPAuthorizationCredentials | None, configured: str | None, *, name: str
) -> None:
    expected = (configured or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{name} API is not configured.",
        )
    supplied = credentials.credentials if credentials is not None else ""
    scheme_ok = credentials is not None and credentials.scheme.lower() == "bearer"
    # compare_digest on every path so a wrong token and a missing one take the
    # same time; the bool is combined afterwards to avoid short-circuiting.
    token_ok = secrets.compare_digest(supplied, expected)
    if not (scheme_ok and token_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or missing {name.lower()} credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_admin_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Gate /api/v1/admin/*. Fails closed.

    With ADMIN_API_TOKEN unset the routes are unavailable rather than open:
    forgetting to configure a secret must not publish operational data to the
    internet, and this API is served publicly through Caddy.
    """
    _require_bearer(credentials, settings.admin_api_token, name="Admin")


_accounts_bearer = HTTPBearer(auto_error=False, description="ACCOUNTS_API_TOKEN")


def require_accounts_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_accounts_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Gate /api/v1/account/*. Fails closed, like the admin token.

    Only the Next.js server holds this token, and it is the sole reason the
    X-Baseline-User header can be believed: the API never sees a session
    cookie, so without the token anyone could claim to be any user.
    """
    _require_bearer(credentials, settings.accounts_api_token, name="Accounts")


def get_current_user(
    x_baseline_user: str | None = Header(default=None),
    _: None = Depends(require_accounts_token),
    repo: AccountRepository = Depends(get_account_repository),
) -> dict:
    try:
        user_id = UUID(x_baseline_user or "")
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Missing or malformed user id."
        ) from exc
    user = repo.get_user(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found.")
    if user["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="This account has been blocked."
        )
    return user


def get_cube_client(settings: Settings = Depends(get_settings)) -> CubeClient:
    return CubeClient(settings.cube_api_url, settings.cubejs_api_secret)


def get_cube_analytics(
    client: CubeClient = Depends(get_cube_client),
) -> CubeAnalytics:
    return CubeAnalytics(client)
