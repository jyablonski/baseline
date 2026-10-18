from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class Transaction(BaseModel):
    """One Basketball-Reference transactions-log entry.

    Grain is `transaction_key`, sha256(transaction_date|description), so a
    reworded entry arrives as a new row rather than an edit. `team_count`
    separates a signing (one team) from a trade (two or more) without
    re-reading the prose.
    """

    model_config = ConfigDict(from_attributes=True)

    transaction_key: str
    transaction_date: date
    season: str
    description: str
    team_count: int
    player_count: int
    source_url: str
    team_names: list[str] = Field(default_factory=list)
    team_abbreviations: list[str] = Field(default_factory=list)
    player_names: list[str] = Field(default_factory=list)
    # Only the players matched to a Baseline UUID, under Baseline's name for them.
    linked_player_names: list[str] = Field(default_factory=list)
