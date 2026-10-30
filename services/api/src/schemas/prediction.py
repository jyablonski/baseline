from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScorecardRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    season: str
    model_name: str
    model_version: str
    is_champion: bool = False
    n: int
    logloss: float | None = None
    brier: float | None = None
    accuracy: float | None = None
    home_always_accuracy: float | None = None
    calibration_error: float | None = None
    # Market baseline over the season's games that had odds attached; null when
    # no scored game carried a market_wp.
    market_n: int | None = None
    market_logloss: float | None = None
    market_brier: float | None = None


class PredictionScorecard(BaseModel):
    champion_model_version: str | None = None
    rows: list[ScorecardRow]


class CalibrationBucket(BaseModel):
    bucket: str
    # Mean home win probability the model gave these games, 0 to 1.
    predicted: float
    # Share of them the home team won, 0 to 1.
    actual: float
    n: int


class PredictionGame(BaseModel):
    game_id: UUID
    game_date: date
    home_team_abbreviation: str | None = None
    away_team_abbreviation: str | None = None
    # The model's pregame home win probability.
    model_wp: float
    home_won: bool


class RegisteredModel(BaseModel):
    model_version: str
    model_name: str
    is_champion: bool
    # Null for a champion that predates the admin switch.
    promoted_at: datetime | None = None
    promoted_by: str | None = None


class ModelGame(BaseModel):
    game_id: UUID
    game_date: date
    home_team_abbreviation: str | None = None
    away_team_abbreviation: str | None = None
    home_won: bool
    # Null when no odds were captured.
    market_wp: float | None = None
    # Home win probability by model version; a model that missed the game is absent.
    predictions: dict[str, float]


class ModelReview(BaseModel):
    season: str | None = None
    live_model_version: str | None = None
    # What gold serves. Lags the live model until dbt rebuilds after a promotion.
    serving_model_version: str | None = None
    models: list[RegisteredModel]
    rows: list[ScorecardRow]
    games: list[ModelGame]


class ChampionUpdate(BaseModel):
    model_version: str = Field(min_length=1, max_length=50)
    # Audit only, like JobRequest.requested_by.
    updated_by: str = Field(min_length=1, max_length=100)
    # False where no host runner would ever pick the dbt job up.
    queue_rebuild: bool = True


class ChampionChange(BaseModel):
    model_version: str
    promoted_at: datetime | None = None
    promoted_by: str | None = None
    # False when another job holds the queue, or nothing changed.
    rebuild_queued: bool
