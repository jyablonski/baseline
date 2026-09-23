from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from queries.admin import (
    ADMIN_DBT_STATUS,
    ADMIN_FRESHNESS,
    ADMIN_GOLD_TABLES,
    ADMIN_ML_STATUS,
    ADMIN_PIPELINE_STATUS,
    ADMIN_RECENT_RUNS,
    ADMIN_SOURCE_HEALTH,
    INSERT_ADMIN_JOB,
    SELECT_ADMIN_JOBS,
)
from repositories.status import as_utc


class JobAlreadyPendingError(RuntimeError):
    """A queued or running job already exists.

    Enforced by a partial unique index rather than a read-then-write check, so
    two rapid clicks cannot both pass a look-before-you-leap test.
    """


# Beyond this the page shows a source as stale. Ingestion is daily, so a little
# over a day allows one late start without flagging every morning.
STALE_AFTER_HOURS = 26


class AdminRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_pipeline(self) -> dict:
        row = dict(self.db.execute(ADMIN_PIPELINE_STATUS).mappings().one())
        hours = row.get("hours_since_success")
        return {
            "enabled": bool(row["enabled"]),
            "season_active": bool(row["season_active"]),
            "season_start": row.get("season_start"),
            "season_end": row.get("season_end"),
            "scrape_mode": row.get("scrape_mode"),
            "target_season": row.get("target_season"),
            "last_success_at": as_utc(row.get("last_success_at")),
            "last_scrape_date": row.get("last_scrape_date"),
            "reason": row.get("reason"),
            "updated_at": as_utc(row.get("updated_at")),
            "action_today": row.get("action_today"),
            "reddit_would_run": bool(row.get("reddit_would_run")),
            "hours_since_success": float(hours) if hours is not None else None,
            # A pipeline that is off is not stale; it is off on purpose.
            "is_stale": bool(
                row["enabled"] and (hours is None or float(hours) > STALE_AFTER_HOURS)
            ),
        }

    def get_recent_runs(self, limit: int = 20) -> list[dict]:
        rows = self.db.execute(ADMIN_RECENT_RUNS, {"limit": limit}).mappings().all()
        return [
            {
                "run_id": row["run_id"],
                "triggered_by": row["triggered_by"],
                "status": row["status"],
                "scrape_action": row["scrape_action"],
                "scrape_exit": row["scrape_exit"],
                "reddit_ran": row["reddit_ran"],
                "reddit_exit": row["reddit_exit"],
                "dbt_exit": row["dbt_exit"],
                "ml_exit": row["ml_exit"],
                "detail": row["detail"],
                "started_at": as_utc(row["started_at"]),
                "finished_at": as_utc(row["finished_at"]),
                "duration_seconds": (
                    float(row["duration_seconds"]) if row["duration_seconds"] is not None else None
                ),
            }
            for row in rows
        ]

    def get_source_health(self) -> list[dict]:
        rows = self.db.execute(ADMIN_SOURCE_HEALTH).mappings().all()
        return [
            {
                "source_name": row["source_name"],
                "run_id": row["run_id"],
                "status": row["status"],
                "expectation": row["expectation"],
                "rows_written": row["rows_written"],
                "attempt": row["attempt"],
                "error_type": row["error_type"],
                "error_detail": row["error_detail"],
                "started_at": as_utc(row["started_at"]),
                "finished_at": as_utc(row["finished_at"]),
                "last_success_at": as_utc(row["last_success_at"]),
                "unhealthy_streak": int(row["unhealthy_streak"] or 0),
            }
            for row in rows
        ]

    def get_freshness(self) -> list[dict]:
        rows = self.db.execute(ADMIN_FRESHNESS).mappings().all()
        return [
            {
                "table_name": row["table_name"],
                "scraped_at": as_utc(row["scraped_at"]),
                "row_count": int(row["row_count"] or 0),
            }
            for row in rows
        ]

    def get_dbt(self) -> dict:
        row = dict(self.db.execute(ADMIN_DBT_STATUS).mappings().one())
        tables = self.db.execute(ADMIN_GOLD_TABLES).mappings().all()
        return {
            "last_dbt_exit": row.get("last_dbt_exit"),
            "last_dbt_run_at": as_utc(row.get("last_dbt_run_at")),
            "last_dbt_run_id": row.get("last_dbt_run_id"),
            # Empty until dbt has run at least once, which is itself the signal.
            "gold_tables": [
                {
                    "table_name": table["table_name"],
                    "row_count": int(table["row_count"] or 0),
                }
                for table in tables
            ],
            "gold_table_count": len(tables),
        }

    def get_ml(self) -> list[dict]:
        rows = self.db.execute(ADMIN_ML_STATUS).mappings().all()
        return [
            {
                "model_name": row["model_name"],
                "model_version": row["model_version"],
                "prediction_count": int(row["prediction_count"] or 0),
                "latest_as_of": as_utc(row["latest_as_of"]),
                "latest_scraped_at": as_utc(row["latest_scraped_at"]),
                "with_market_wp": int(row["with_market_wp"] or 0),
            }
            for row in rows
        ]

    def _job_row(self, row) -> dict:
        return {
            "job_id": row["job_id"],
            "job_type": row["job_type"],
            "status": row["status"],
            "requested_by": row["requested_by"],
            "exit_code": row["exit_code"],
            "detail": row["detail"],
            "log_tail": row["log_tail"],
            "requested_at": as_utc(row["requested_at"]),
            "started_at": as_utc(row["started_at"]),
            "finished_at": as_utc(row["finished_at"]),
        }

    def get_jobs(self, limit: int = 10) -> list[dict]:
        rows = self.db.execute(SELECT_ADMIN_JOBS, {"limit": limit}).mappings().all()
        return [self._job_row(row) for row in rows]

    def enqueue_job(self, job_type: str, *, requested_by: str, detail: str | None = None) -> dict:
        try:
            row = (
                self.db.execute(
                    INSERT_ADMIN_JOB,
                    {"job_type": job_type, "requested_by": requested_by, "detail": detail},
                )
                .mappings()
                .one()
            )
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise JobAlreadyPendingError(
                "A job is already queued or running; wait for it to finish."
            ) from exc
        return self._job_row(row)

    def get_health(self, run_limit: int = 20) -> dict:
        return {
            "pipeline": self.get_pipeline(),
            "sources": self.get_source_health(),
            "freshness": self.get_freshness(),
            "dbt": self.get_dbt(),
            "ml": self.get_ml(),
            "recent_runs": self.get_recent_runs(run_limit),
            "jobs": self.get_jobs(),
        }
