from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class StandingRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    team_id: UUID
    abbreviation: str
    team_name: str
    season: str
    season_type: str
    as_of_date: date | None = None
    conference: str
    division: str
    conference_rank: int | None = None
    playoff_seed: int | None = None
    division_rank: int | None = None
    wins: int | None = None
    losses: int | None = None
    win_pct: float | None = None
    games_back: float | None = None
    streak: str | None = None
    last_10: str | None = None
    record_source: str | None = None


class StandingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season: str
    season_type: str | None = None
    conference: str
    conference_rank: int
    division: str | None = None
    division_rank: int | None = None
    wins: int
    losses: int
    win_pct: float | None = None
    games_back: float | None = None
    streak: str | None = None
    last_10: str | None = None
