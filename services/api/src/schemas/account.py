from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Long enough for a real question, short enough that one ask cannot carry a
# page of pasted text into every later model call.
MAX_CHAT_MESSAGE_CHARS = 500
# A bound on the request body; the turn cap itself is the CHAT_MAX_TURNS setting.
MAX_CHAT_MESSAGES = 40


# The time zones an account may show game times in. `services/frontend/src/lib/
# timezones.ts` offers the same list; a name missing here is refused with a 422.
Timezone = Literal[
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Sao_Paulo",
    "UTC",
    "Europe/London",
    "Europe/Paris",
    "Europe/Athens",
    "Asia/Kolkata",
    "Asia/Shanghai",
    "Asia/Manila",
    "Asia/Tokyo",
    "Australia/Sydney",
]


class UserUpsert(BaseModel):
    provider: Literal["github", "google"]
    # The provider's stable account id, never an email or a login name.
    provider_subject: str = Field(min_length=1, max_length=255)
    display_name: str | None = Field(default=None, max_length=100)


class AccountUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: UUID
    provider: str
    display_name: str | None = None
    status: str
    # Null is the site default, Eastern.
    timezone: str | None = None
    created_at: datetime
    last_seen_at: datetime


class TimezoneUpdate(BaseModel):
    # Null goes back to the site default.
    timezone: Timezone | None


class ChatQuota(BaseModel):
    daily_limit: int
    remaining: int
    # The next midnight Eastern, when the count starts over.
    resets_at: datetime
    # Questions one conversation may hold before a new one has to be started.
    max_turns: int


class AccountProfile(BaseModel):
    user: AccountUser
    chat: ChatQuota


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_CHAT_MESSAGE_CHARS * 8)


class ChatRequest(BaseModel):
    # The whole conversation so far, oldest first, ending on the new question.
    # The transcript lives in the browser; the server stores none of it.
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_CHAT_MESSAGES)
    season: str | None = None


class ChatResponse(BaseModel):
    answer: str
    data: list = Field(default_factory=list)
    # Which tool the rows came from, shown under the answer.
    source: str | None = None
    backend: Literal["llm", "rules"]
    quota: ChatQuota


# No balance limits a stake, so this bound is what keeps the net figure sane.
MAX_STAKE = 1000


class PickRequest(BaseModel):
    picked_team_id: UUID
    # Optional. Null is a pick that only counts toward the record.
    stake: int | None = Field(default=None, ge=1, le=MAX_STAKE)


class Pick(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    picked_team_id: UUID
    # Whole dollars, with no cash value.
    stake: int | None = None
    # The consensus price when the pick was last saved, which a stake settles at.
    moneyline: int | None = None
    result: Literal["pending", "won", "lost", "void"]
    # Dollars to the cent: winnings, the stake as a negative, or null while
    # open, void or unstaked.
    profit: float | None = None
    # Did the model's favourite win? Null while open or when the model has no pick.
    model_correct: bool | None = None
    game_date: date | None = None
    start_time_et: time | None = None
    game_status: str | None = None
    home_team_id: UUID | None = None
    home_team_abbreviation: str | None = None
    home_score: int | None = None
    away_team_id: UUID | None = None
    away_team_abbreviation: str | None = None
    away_score: int | None = None
    created_at: datetime
    updated_at: datetime


class PickSummary(BaseModel):
    wins: int
    losses: int
    pending: int
    # Dollars: what settled stakes have won less what they lost. Starts at zero.
    net: float
    # Riding on picks that have not finished.
    staked_open: int
    # Net picks ahead of (or behind) the model, over model_games settled games.
    vs_model: int
    model_games: int


class PickSheet(BaseModel):
    summary: PickSummary
    picks: list[Pick]


class FeatureFlag(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    flag_key: str
    enabled: bool
    description: str
    updated_at: datetime
    updated_by: str | None = None


class FlagUpdate(BaseModel):
    enabled: bool
    # Audit only, like JobRequest.requested_by.
    updated_by: str = Field(min_length=1, max_length=100)
