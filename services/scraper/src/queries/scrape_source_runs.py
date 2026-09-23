"""SQL against ``source.scrape_source_runs`` (per-source run history)."""

from __future__ import annotations

from sqlalchemy import text

INSERT_SOURCE_RUN = text(
    """
    INSERT INTO source.scrape_source_runs (
        run_id,
        source_name,
        status,
        expectation,
        rows_written,
        season,
        attempt,
        error_type,
        error_detail,
        started_at,
        finished_at
    )
    VALUES (
        :run_id,
        :source_name,
        :status,
        :expectation,
        :rows_written,
        :season,
        :attempt,
        :error_type,
        :error_detail,
        :started_at,
        :finished_at
    )
    """
)

# Latest attempt per source for one run; drives retry selection and the digest.
SELECT_SOURCE_RUNS_FOR_RUN = text(
    """
    SELECT DISTINCT ON (source_name)
        source_name,
        status,
        expectation,
        rows_written,
        attempt,
        error_type,
        error_detail
    FROM source.scrape_source_runs
    WHERE run_id = :run_id
    ORDER BY source_name, attempt DESC, id DESC
    """
)

# Sources attempted in :run_id whose most recent attempted runs have been
# unhealthy (failed, or succeeded below expectation) at least :threshold times
# in a row. Skipped runs are ignored entirely: an off-day, the off-season, or a
# missing API key is deliberate and neither extends nor breaks a streak.
# Restricting to this run's sources keeps a source that stopped being scraped
# from re-alerting on stale history every night.
SELECT_UNHEALTHY_SOURCE_STREAKS = text(
    """
    WITH attempted AS (
        SELECT DISTINCT ON (scrape_source_runs.run_id, scrape_source_runs.source_name)
            scrape_source_runs.id,
            scrape_source_runs.run_id,
            scrape_source_runs.source_name,
            scrape_source_runs.status,
            scrape_source_runs.expectation,
            scrape_source_runs.error_type,
            scrape_source_runs.error_detail,
            scrape_source_runs.started_at
        FROM source.scrape_source_runs
        WHERE scrape_source_runs.status <> 'skipped'
        ORDER BY
            scrape_source_runs.run_id,
            scrape_source_runs.source_name,
            scrape_source_runs.attempt DESC,
            scrape_source_runs.id DESC
    ),
    ranked AS (
        SELECT
            attempted.source_name,
            attempted.status,
            attempted.expectation,
            attempted.error_type,
            attempted.error_detail,
            (attempted.status = 'failed' OR attempted.expectation = 'below') AS unhealthy,
            row_number() OVER (
                PARTITION BY attempted.source_name
                ORDER BY
                    attempted.started_at DESC,
                    attempted.id DESC
            ) AS recency
        FROM attempted
    ),
    last_healthy AS (
        SELECT
            ranked.source_name,
            min(ranked.recency) AS recency
        FROM ranked
        WHERE NOT ranked.unhealthy
        GROUP BY ranked.source_name
    ),
    this_run AS (
        SELECT DISTINCT scrape_source_runs.source_name
        FROM source.scrape_source_runs
        WHERE scrape_source_runs.run_id = :run_id
    )
    SELECT
        ranked.source_name,
        count(*) AS streak,
        count(*) FILTER (WHERE ranked.status = 'failed') AS failed_runs,
        count(*) FILTER (WHERE ranked.expectation = 'below') AS below_runs,
        (array_agg(ranked.error_type ORDER BY ranked.recency))[1] AS latest_error_type,
        (array_agg(ranked.error_detail ORDER BY ranked.recency))[1] AS latest_error_detail
    FROM ranked
    JOIN this_run ON this_run.source_name = ranked.source_name
    LEFT JOIN last_healthy ON last_healthy.source_name = ranked.source_name
    WHERE
        ranked.unhealthy
        AND (last_healthy.recency IS NULL OR ranked.recency < last_healthy.recency)
    GROUP BY ranked.source_name
    HAVING count(*) >= :threshold
    ORDER BY ranked.source_name
    """
)
