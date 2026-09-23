from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import (
    admin,
    games,
    players,
    predictions,
    query,
    schedule,
    social,
    standings,
    status,
    teams,
    transactions,
)


def create_app() -> FastAPI:
    app = FastAPI(title="NBA Platform API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(players.router, prefix="/api/v1/players", tags=["players"])
    app.include_router(standings.router, prefix="/api/v1/standings", tags=["standings"])
    app.include_router(teams.router, prefix="/api/v1/teams", tags=["teams"])
    app.include_router(games.router, prefix="/api/v1/games", tags=["games"])
    app.include_router(schedule.router, prefix="/api/v1/schedule", tags=["schedule"])
    app.include_router(predictions.router, prefix="/api/v1/predictions", tags=["predictions"])
    app.include_router(games.seasons_router, prefix="/api/v1", tags=["games"])
    app.include_router(query.router, prefix="/api/v1", tags=["query"])
    app.include_router(social.router, prefix="/api/v1/social", tags=["social"])
    app.include_router(transactions.router, prefix="/api/v1/transactions", tags=["transactions"])
    app.include_router(status.router, prefix="/api/v1/status", tags=["status"])
    app.include_router(admin.router, prefix="/api/v1/admin", tags=["admin"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
