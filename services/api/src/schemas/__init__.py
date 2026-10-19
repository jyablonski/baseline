from pydantic import BaseModel, Field

from schemas.admin import (
    AdminHealth,
    AdminJob,
    DbtStatus,
    GoldTable,
    JobRequest,
    JobType,
    ModelStatus,
    PipelineGate,
    PipelineGateUpdate,
    PipelineRun,
    SourceHealth,
    TableFreshness,
)
from schemas.game import (
    BoxScoreRow,
    ClosestGame,
    GameCollapse,
    GameDate,
    GameDetail,
    GameFlow,
    GameHighlight,
    GameResult,
    GameUpset,
    LargestMarginGame,
    PlayByPlayEvent,
    QueryClarify,
    QueryEntity,
    QueryRequest,
    QueryResponse,
    ScheduledGame,
    TeamGameResult,
)
from schemas.injury import GameInjury, PlayerInjury
from schemas.player import (
    BackToBackStats,
    GameLogEntry,
    HeadToHeadComparison,
    PlayerComparison,
    PlayerDetail,
    PlayerSeasonStats,
    PlayerSummary,
    PlayerValue,
)
from schemas.prediction import PredictionScorecard, ScorecardRow
from schemas.social import (
    SocialComment,
    SocialEntity,
    SocialFacet,
    SocialFanbase,
    SocialLeader,
    SocialPost,
    SocialPostDetail,
    SocialSummary,
)
from schemas.standing import StandingRow, StandingSummary
from schemas.status import WarehouseStatus
from schemas.team import TeamDetail, TeamRecord, TeamSummary
from schemas.transaction import Transaction


class PaginationMeta(BaseModel):
    total: int
    limit: int
    offset: int


class PaginatedResponse[T](BaseModel):
    data: list[T]
    meta: PaginationMeta


class ItemResponse[T](BaseModel):
    data: T


class SeasonListResponse(BaseModel):
    data: list[str]
    meta: PaginationMeta = Field(default_factory=lambda: PaginationMeta(total=0, limit=0, offset=0))


__all__ = [
    "AdminHealth",
    "AdminJob",
    "BackToBackStats",
    "BoxScoreRow",
    "SocialComment",
    "SocialEntity",
    "SocialFacet",
    "SocialFanbase",
    "SocialLeader",
    "SocialPost",
    "SocialPostDetail",
    "SocialSummary",
    "DbtStatus",
    "ClosestGame",
    "GameCollapse",
    "GameDate",
    "GameDetail",
    "GameInjury",
    "GameFlow",
    "GameHighlight",
    "GameUpset",
    "LargestMarginGame",
    "GameLogEntry",
    "GameResult",
    "GoldTable",
    "HeadToHeadComparison",
    "ItemResponse",
    "JobRequest",
    "JobType",
    "ModelStatus",
    "PaginatedResponse",
    "PaginationMeta",
    "PipelineGate",
    "PipelineGateUpdate",
    "PipelineRun",
    "PlayByPlayEvent",
    "PlayerComparison",
    "PlayerDetail",
    "PlayerInjury",
    "PlayerSeasonStats",
    "PlayerSummary",
    "PlayerValue",
    "PredictionScorecard",
    "QueryClarify",
    "QueryEntity",
    "QueryRequest",
    "QueryResponse",
    "ScheduledGame",
    "ScorecardRow",
    "SeasonListResponse",
    "SourceHealth",
    "Transaction",
    "StandingRow",
    "StandingSummary",
    "TableFreshness",
    "TeamDetail",
    "TeamGameResult",
    "TeamRecord",
    "TeamSummary",
    "WarehouseStatus",
]
