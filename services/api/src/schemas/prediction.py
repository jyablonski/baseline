from pydantic import BaseModel, ConfigDict


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
