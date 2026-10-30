from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlayerInjury(BaseModel):
    """A player on the current Basketball-Reference injury report."""

    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    player_name: str | None = None
    team_id: UUID
    team_abbreviation: str | None = None
    # Out, Day To Day, Out For Season, or Listed when the note says anything else.
    injury_status: str
    injury_detail: str | None = None
    description: str
    update_date: date | None = None
    is_notable: bool


class GameInjury(BaseModel):
    """A player on the injury report for one game, as of that game's snapshot."""

    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    side: str
    team_id: UUID
    player_id: UUID
    player_name: str | None = None
    injury_status: str
    injury_detail: str | None = None
    description: str
    update_date: date | None = None
    snapshot_date: date
    is_notable: bool
    # Once the game is Final, whether they logged minutes; null before.
    played: bool | None = None
    # Season averages; null for a player with no games this season.
    ppg: float | None = None
    apg: float | None = None
