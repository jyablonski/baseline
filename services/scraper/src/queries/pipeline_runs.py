"""SQL against ``source.pipeline_runs`` (run history)."""

from __future__ import annotations

from sqlalchemy import text

INSERT_PIPELINE_RUN = text(
    """
    INSERT INTO source.pipeline_runs (triggered_by, status, scrape_action)
    VALUES (:triggered_by, 'running', :scrape_action)
    RETURNING run_id
    """
)

# A dbt invocation with no scrape attached (`make dbt` / `make prod-dbt`).
# Without this, a standalone dbt run leaves no trace and the admin view keeps
# reporting the last refresh-daily exit code forever, so a fixed failure never
# clears on its own.
INSERT_DBT_ONLY_RUN = text(
    """
    INSERT INTO source.pipeline_runs (
        triggered_by, status, scrape_action, scrape_exit, dbt_exit, detail, finished_at
    )
    VALUES (
        :triggered_by,
        CASE WHEN :dbt_exit = 0 THEN 'success' ELSE 'failed' END,
        'dbt',
        NULL,
        :dbt_exit,
        :detail,
        NOW()
    )
    RETURNING run_id
    """
)

UPDATE_PIPELINE_RUN = text(
    """
    UPDATE source.pipeline_runs
    SET
        status = :status,
        scrape_exit = :scrape_exit,
        reddit_ran = :reddit_ran,
        reddit_exit = :reddit_exit,
        dbt_exit = COALESCE(:dbt_exit, dbt_exit),
        detail = :detail,
        finished_at = NOW()
    WHERE run_id = :run_id
    """
)

UPDATE_PIPELINE_RUN_DBT_EXIT = text(
    """
    UPDATE source.pipeline_runs
    SET
        dbt_exit = :dbt_exit,
        status = CASE
            WHEN :dbt_exit <> 0 THEN 'failed'
            WHEN status = 'failed' THEN status
            ELSE 'success'
        END,
        detail = CASE
            WHEN :detail IS NULL THEN detail
            ELSE concat_ws(' | ', detail, :detail)
        END,
        finished_at = NOW()
    WHERE run_id = :run_id
    """
)

# Same status rule as the dbt update: a failed stage fails the run, and a
# success never un-fails a run that an earlier stage already failed.
UPDATE_PIPELINE_RUN_ML_EXIT = text(
    """
    UPDATE source.pipeline_runs
    SET
        ml_exit = :ml_exit,
        status = CASE
            WHEN :ml_exit <> 0 THEN 'failed'
            WHEN status = 'failed' THEN status
            ELSE 'success'
        END,
        detail = CASE
            WHEN :detail IS NULL THEN detail
            ELSE concat_ws(' | ', detail, :detail)
        END,
        finished_at = NOW()
    WHERE run_id = :run_id
    """
)
