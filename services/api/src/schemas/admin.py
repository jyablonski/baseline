from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PipelineGate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    enabled: bool
    season_active: bool
    season_start: date | None = None
    season_end: date | None = None
    scrape_mode: str | None = None
    target_season: str | None = None
    last_success_at: datetime | None = None
    last_scrape_date: date | None = None
    reason: str | None = None
    updated_at: datetime | None = None
    # What decide_action() would return for today, so the UI does not
    # reimplement the gate rules.
    action_today: str
    reddit_would_run: bool
    hours_since_success: float | None = None
    is_stale: bool


class SourceHealth(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source_name: str
    run_id: int | None = None
    status: str
    expectation: str
    rows_written: int | None = None
    attempt: int = 1
    error_type: str | None = None
    error_detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_success_at: datetime | None = None
    # Most recent attempted runs in a row that failed or came back below
    # expectation. Skipped runs neither extend nor break it.
    unhealthy_streak: int = 0


class TableFreshness(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    table_name: str
    scraped_at: datetime | None = None
    row_count: int = 0


class GoldTable(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    table_name: str
    row_count: int = 0


class DbtStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    last_dbt_exit: int | None = None
    last_dbt_run_at: datetime | None = None
    last_dbt_run_id: int | None = None
    gold_tables: list[GoldTable] = []
    gold_table_count: int = 0


class ModelStatus(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model_name: str
    model_version: str
    prediction_count: int = 0
    latest_as_of: datetime | None = None
    latest_scraped_at: datetime | None = None
    with_market_wp: int = 0


class PipelineRun(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    run_id: int
    triggered_by: str
    status: str
    scrape_action: str | None = None
    scrape_exit: int | None = None
    reddit_ran: bool | None = None
    reddit_exit: int | None = None
    dbt_exit: int | None = None
    ml_exit: int | None = None
    detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_seconds: float | None = None


# Mirrors the admin_jobs_job_type_check constraint. Kept as a Literal so an
# unknown job type is rejected at the edge instead of reaching a CHECK
# violation, and so the runner's dispatch table stays exhaustive.
JobType = Literal["scrape", "dbt", "ml", "refresh"]


class AdminJob(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: int
    job_type: str
    status: str
    requested_by: str
    exit_code: int | None = None
    detail: str | None = None
    log_tail: str | None = None
    requested_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None


class JobRequest(BaseModel):
    job_type: JobType
    # Audit only. Trusted because the caller already holds ADMIN_API_TOKEN;
    # in the body rather than the query string so it stays out of access logs.
    requested_by: str = Field(min_length=1, max_length=100)


class AdminHealth(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    pipeline: PipelineGate
    sources: list[SourceHealth]
    freshness: list[TableFreshness]
    dbt: DbtStatus
    ml: list[ModelStatus]
    recent_runs: list[PipelineRun]
    jobs: list[AdminJob] = []
