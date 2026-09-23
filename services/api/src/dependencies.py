import secrets
from collections.abc import Generator

from cube.analytics import CubeAnalytics
from cube.client import CubeClient
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from config import Settings, get_settings
from db import SessionLocal
from repositories.admin import AdminRepository
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


# auto_error=False so a missing header reaches our handler and returns the same
# shape as a wrong one, rather than FastAPI's default 403.
_admin_bearer = HTTPBearer(auto_error=False, description="ADMIN_API_TOKEN")


def require_admin_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_admin_bearer),
    settings: Settings = Depends(get_settings),
) -> None:
    """Gate /api/v1/admin/*. Fails closed.

    With ADMIN_API_TOKEN unset the routes are unavailable rather than open:
    forgetting to configure a secret must not publish operational data to the
    internet, and this API is served publicly through Caddy.
    """
    expected = (settings.admin_api_token or "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin API is not configured.",
        )
    supplied = credentials.credentials if credentials is not None else ""
    scheme_ok = credentials is not None and credentials.scheme.lower() == "bearer"
    # compare_digest on every path so a wrong token and a missing one take the
    # same time; the bool is combined afterwards to avoid short-circuiting.
    token_ok = secrets.compare_digest(supplied, expected)
    if not (scheme_ok and token_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_cube_client(settings: Settings = Depends(get_settings)) -> CubeClient:
    return CubeClient(settings.cube_api_url, settings.cubejs_api_secret)


def get_cube_analytics(
    client: CubeClient = Depends(get_cube_client),
) -> CubeAnalytics:
    return CubeAnalytics(client)
