"""SQL for the operator admin view: ingestion, dbt, and ML health.

The only endpoints besides /api/v1/status that read the ``source`` schema.
Everything here is read-only and aggregate; the admin view reports, it does
not drive the pipeline.
"""

from sqlalchemy import text

# Gate row plus the same verdict decide_action() would reach, so the page can
# say "would not run right now" without reimplementing the rule in TypeScript.
ADMIN_PIPELINE_STATUS = text(
    """
    SELECT
        scrape_pipeline.enabled,
        scrape_pipeline.season_active,
        scrape_pipeline.season_start,
        scrape_pipeline.season_end,
        scrape_pipeline.scrape_mode,
        scrape_pipeline.target_season,
        scrape_pipeline.last_success_at,
        scrape_pipeline.last_scrape_date,
        scrape_pipeline.reason,
        scrape_pipeline.updated_at,
        CASE
            WHEN NOT scrape_pipeline.enabled THEN 'skipped_disabled'
            WHEN NOT scrape_pipeline.season_active THEN 'skipped_offseason'
            WHEN scrape_pipeline.season_start IS NOT NULL
                 AND CURRENT_DATE < scrape_pipeline.season_start THEN 'skipped_offseason'
            WHEN scrape_pipeline.season_end IS NOT NULL
                 AND CURRENT_DATE > scrape_pipeline.season_end THEN 'skipped_offseason'
            WHEN lower(coalesce(scrape_pipeline.scrape_mode, 'daily')) = 'none' THEN 'skipped_mode_none'
            WHEN lower(coalesce(scrape_pipeline.scrape_mode, 'daily')) = 'season'
                 AND scrape_pipeline.target_season IS NULL THEN 'noop'
            ELSE lower(coalesce(scrape_pipeline.scrape_mode, 'daily'))
        END AS action_today,
        scrape_pipeline.enabled AS reddit_would_run,
        EXTRACT(EPOCH FROM (now() - scrape_pipeline.last_success_at)) / 3600.0 AS hours_since_success
    FROM source.scrape_pipeline
    WHERE scrape_pipeline.id = 1
    """
)

ADMIN_RECENT_RUNS = text(
    """
    SELECT
        pipeline_runs.run_id,
        pipeline_runs.triggered_by,
        pipeline_runs.status,
        pipeline_runs.scrape_action,
        pipeline_runs.scrape_exit,
        pipeline_runs.reddit_ran,
        pipeline_runs.reddit_exit,
        pipeline_runs.dbt_exit,
        pipeline_runs.ml_exit,
        pipeline_runs.detail,
        pipeline_runs.started_at,
        pipeline_runs.finished_at,
        EXTRACT(EPOCH FROM (pipeline_runs.finished_at - pipeline_runs.started_at)) AS duration_seconds
    FROM source.pipeline_runs
    ORDER BY pipeline_runs.started_at DESC
    LIMIT :limit
    """
)

# Latest attempt per source, plus its unhealthy streak: how many of its most
# recent attempted runs in a row failed or came back below expectation. One bad
# night is noise; a streak is a parse break. Same rule as the scraper's
# SELECT_UNHEALTHY_SOURCE_STREAKS, which decides when Slack is told.
ADMIN_SOURCE_HEALTH = text(
    """
    WITH latest AS (
        SELECT DISTINCT ON (scrape_source_runs.source_name)
            scrape_source_runs.source_name,
            scrape_source_runs.run_id,
            scrape_source_runs.status,
            scrape_source_runs.expectation,
            scrape_source_runs.rows_written,
            scrape_source_runs.attempt,
            scrape_source_runs.error_type,
            scrape_source_runs.error_detail,
            scrape_source_runs.started_at,
            scrape_source_runs.finished_at
        FROM source.scrape_source_runs
        ORDER BY
            scrape_source_runs.source_name,
            scrape_source_runs.started_at DESC,
            scrape_source_runs.id DESC
    ),
    last_success AS (
        SELECT
            scrape_source_runs.source_name,
            max(scrape_source_runs.started_at) AS succeeded_at
        FROM source.scrape_source_runs
        WHERE scrape_source_runs.status = 'success'
        GROUP BY scrape_source_runs.source_name
    ),
    -- Latest attempt per (run, source), skipped runs dropped. A 'skipped' run
    -- is deliberate (off-day, off-season, no API key), so counting it would
    -- make every NBA source look like a growing streak through the off-season.
    attempted AS (
        SELECT DISTINCT ON (scrape_source_runs.run_id, scrape_source_runs.source_name)
            scrape_source_runs.id,
            scrape_source_runs.source_name,
            scrape_source_runs.started_at,
            (
                scrape_source_runs.status = 'failed'
                OR scrape_source_runs.expectation = 'below'
            ) AS unhealthy
        FROM source.scrape_source_runs
        WHERE scrape_source_runs.status <> 'skipped'
        ORDER BY
            scrape_source_runs.run_id,
            scrape_source_runs.source_name,
            scrape_source_runs.attempt DESC,
            scrape_source_runs.id DESC
    ),
    last_healthy AS (
        SELECT
            attempted.source_name,
            max(attempted.started_at) AS healthy_at
        FROM attempted
        WHERE NOT attempted.unhealthy
        GROUP BY attempted.source_name
    ),
    streaks AS (
        SELECT
            attempted.source_name,
            count(*) AS unhealthy_streak
        FROM attempted
        LEFT JOIN last_healthy ON last_healthy.source_name = attempted.source_name
        WHERE
            attempted.unhealthy
            AND (
                last_healthy.healthy_at IS NULL
                OR attempted.started_at > last_healthy.healthy_at
            )
        GROUP BY attempted.source_name
    )
    SELECT
        latest.source_name,
        latest.run_id,
        latest.status,
        latest.expectation,
        latest.rows_written,
        latest.attempt,
        latest.error_type,
        latest.error_detail,
        latest.started_at,
        latest.finished_at,
        last_success.succeeded_at AS last_success_at,
        coalesce(streaks.unhealthy_streak, 0) AS unhealthy_streak
    FROM latest
    LEFT JOIN last_success ON last_success.source_name = latest.source_name
    LEFT JOIN streaks ON streaks.source_name = latest.source_name
    ORDER BY latest.source_name
    """
)

# Per-table watermarks. Deliberately explicit rather than looping over
# information_schema: the set of tables that matter is a product decision.
ADMIN_FRESHNESS = text(
    """
    SELECT
        'games' AS table_name,
        max(scraped_at) AS scraped_at,
        count(*) AS row_count
    FROM source.games
    UNION ALL SELECT 'player_game_logs', max(scraped_at), count(*) FROM source.player_game_logs
    UNION ALL SELECT 'play_by_play', max(scraped_at), count(*) FROM source.play_by_play
    UNION ALL SELECT 'standings', max(scraped_at), count(*) FROM source.standings
    UNION ALL SELECT 'player_injuries', max(scraped_at), count(*) FROM source.player_injuries
    UNION ALL SELECT 'player_contracts', max(scraped_at), count(*) FROM source.player_contracts
    UNION ALL SELECT 'team_payroll', max(scraped_at), count(*) FROM source.team_payroll
    UNION ALL SELECT 'game_odds', max(scraped_at), count(*) FROM source.game_odds
    UNION ALL SELECT 'reddit_posts', max(scraped_at), count(*) FROM source.reddit_posts
    UNION ALL SELECT 'reddit_comments', max(scraped_at), count(*) FROM source.reddit_comments
    ORDER BY scraped_at DESC NULLS LAST
    """
)

# dbt health is inferred from the warehouse it produces. Gold table counts come
# from the catalog rather than count(*) per table on purpose: a fresh box has
# not run dbt yet, and a hardcoded `FROM gold.fct_x` fails to *parse* when the
# relation is missing, which would 500 the dashboard exactly when it is most
# needed. n_live_tup is approximate, which is fine at a glance.
ADMIN_DBT_STATUS = text(
    """
    SELECT
        (
            SELECT pipeline_runs.dbt_exit
            FROM source.pipeline_runs
            WHERE pipeline_runs.dbt_exit IS NOT NULL
            ORDER BY pipeline_runs.started_at DESC
            LIMIT 1
        ) AS last_dbt_exit,
        (
            SELECT pipeline_runs.started_at
            FROM source.pipeline_runs
            WHERE pipeline_runs.dbt_exit IS NOT NULL
            ORDER BY pipeline_runs.started_at DESC
            LIMIT 1
        ) AS last_dbt_run_at,
        (
            SELECT pipeline_runs.run_id
            FROM source.pipeline_runs
            WHERE pipeline_runs.dbt_exit IS NOT NULL
            ORDER BY pipeline_runs.started_at DESC
            LIMIT 1
        ) AS last_dbt_run_id
    """
)

ADMIN_GOLD_TABLES = text(
    """
    SELECT
        gold_tables.relname AS table_name,
        greatest(gold_tables.n_live_tup, 0) AS row_count,
        gold_tables.last_analyze,
        gold_tables.last_autoanalyze
    FROM pg_stat_user_tables AS gold_tables
    WHERE gold_tables.schemaname = 'gold'
    ORDER BY gold_tables.relname
    """
)

ADMIN_ML_STATUS = text(
    """
    SELECT
        game_predictions.model_name,
        game_predictions.model_version,
        count(*) AS prediction_count,
        max(game_predictions.as_of) AS latest_as_of,
        max(game_predictions.scraped_at) AS latest_scraped_at,
        count(*) FILTER (WHERE game_predictions.market_wp IS NOT NULL) AS with_market_wp
    FROM source.game_predictions
    GROUP BY game_predictions.model_name, game_predictions.model_version
    ORDER BY max(game_predictions.scraped_at) DESC
    """
)

# --- Operator job queue -------------------------------------------------
# The API enqueues only. A host-side runner claims and executes, because this
# process has no Docker socket and must never be given one.

INSERT_ADMIN_JOB = text(
    """
    INSERT INTO source.admin_jobs (job_type, requested_by, detail)
    VALUES (:job_type, :requested_by, :detail)
    RETURNING
        job_id,
        job_type,
        status,
        requested_by,
        exit_code,
        detail,
        log_tail,
        requested_at,
        started_at,
        finished_at
    """
)

SELECT_ADMIN_JOBS = text(
    """
    SELECT
        admin_jobs.job_id,
        admin_jobs.job_type,
        admin_jobs.status,
        admin_jobs.requested_by,
        admin_jobs.exit_code,
        admin_jobs.detail,
        admin_jobs.log_tail,
        admin_jobs.requested_at,
        admin_jobs.started_at,
        admin_jobs.finished_at
    FROM source.admin_jobs
    ORDER BY admin_jobs.requested_at DESC
    LIMIT :limit
    """
)
