#!/usr/bin/env bash
# refresh-daily.sh — scrape (gated by source.scrape_pipeline), dbt, then model scoring.
#
# Default: honors source.scrape_pipeline.enabled.
# NBA daily also needs season_active / window. r/nba always runs when the
# pipeline is enabled (or FORCE=1), including off-season. Missing REDDIT_*
# skips HTTP. enabled=false → skipped, no dbt.
# Manual test: FORCE=1 ./scripts/refresh-daily.sh
#   FORCE bypasses enabled + the NBA season window and also runs reddit.
#   Or: make refresh-daily-once
#
# Safe next to `tilt up`: `docker compose run --rm --no-deps` so Tilt's
# postgres is not reconciled or recreated. Base compose bind-mounts host
# scraper/dbt/ml src and dbt YAML onto /app, so code edits do not
# need `compose build` (Tilt live_update also never rewrites `compose run`
# images). Rebuild only for Dockerfile / lockfile / package changes:
#   BUILD=1 ./scripts/refresh-daily.sh
# Production callers set COMPOSE to the prod overlay so these jobs use the
# registry-tagged, baked images and the production environment.
# Do not `compose up postgres` from here — recreating on an existing
# pgdata volume does not re-run init.sql.
#
# Scheduling is NOT enabled by default. Wire host cron / Compose profile
# `cron` yourself after `make pipeline-enable`.
#
# Optional SLACK_WEBHOOK_URL is inherited from the host / compose `.env` (scraper env_file).
# At most one Slack post per failed refresh: the scrape sync posts its own, and
# a failed scrape exits before dbt. A dbt or ml failure posts once through the
# scraper's `pipeline mark-dbt|mark-ml --notify`, which also records the exit
# code on the run row. dbt failing stops the refresh before ml, so those two
# never stack either.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Same pinned project as the Makefile, not the directory name: compose
# namespaces volumes by project, so deriving it would point a renamed checkout
# at an empty pgdata.
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"

COMPOSE="${COMPOSE:-docker compose}"
FORCE="${FORCE:-0}"
SKIP_DBT="${SKIP_DBT:-0}"
# Bind mounts pick up host YAML/SQL/Python. Default: do not rebuild images.
# BUILD=1 (or SKIP_BUILD=0) for Dockerfile / lockfile / package changes.
BUILD="${BUILD:-0}"
if [[ "$BUILD" == "1" ]]; then
  SKIP_BUILD="${SKIP_BUILD:-0}"
else
  SKIP_BUILD="${SKIP_BUILD:-1}"
fi
RUN_DBT_TEST="${RUN_DBT_TEST:-1}"

# Never start/reconcile depends_on (postgres). `compose run` without
# --no-deps recreates Tilt-managed nba-postgres-1 when labels/config differ.
compose_run() {
  $COMPOSE --profile tools run --rm --no-deps "$@"
}

wait_for_existing_postgres() {
  echo "==> waiting for existing postgres (will not create or recreate it)"
  local i
  for i in $(seq 1 60); do
    if $COMPOSE exec -T postgres \
      sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "error: postgres is not running in compose project ${COMPOSE_PROJECT_NAME}." >&2
  echo "Start it with \`make up\` / \`tilt up\`. This script will not \`compose up postgres\`" >&2
  echo "(that recreates Tilt's container; init.sql does not re-run on existing pgdata)." >&2
  exit 1
}

wait_for_existing_postgres

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "==> build migrate, scraper, dbt, and ml images"
  $COMPOSE build migrate
  $COMPOSE --profile tools build scraper dbt ml
fi

echo "==> alembic upgrade head (source schema)"
$COMPOSE run --rm --no-deps migrate alembic upgrade head

SCRAPER_ARGS=(pipeline run-once)
if [[ "$FORCE" == "1" ]]; then
  SCRAPER_ARGS+=(--force)
fi

echo "==> pipeline scrape (${SCRAPER_ARGS[*]})"
SCRAPE_OUT="$(compose_run scraper python -m main "${SCRAPER_ARGS[@]}")"
echo "$SCRAPE_OUT"

RUN_ID="$(echo "$SCRAPE_OUT" | sed -n 's/^run_id=//p' | tail -n1)"
STATUS="$(echo "$SCRAPE_OUT" | sed -n 's/^status=//p' | tail -n1)"

if [[ "$STATUS" == "skipped" ]]; then
  echo "==> skipped (disabled, or no season/reddit work). dbt not run."
  exit 0
fi

if [[ "$STATUS" == "failed" ]]; then
  echo "==> scrape failed; aborting before dbt."
  exit 1
fi

if [[ "$SKIP_DBT" == "1" ]]; then
  echo "==> SKIP_DBT=1; leaving run_id=${RUN_ID} without dbt."
  exit 0
fi

echo "==> dbt build"
# Full project (including stg/fct play-by-play, scoring series, and fct_game_flow).
# Daily scrape already wrote today's Finals into source.play_by_play; this run
# is the enrichment step — not a separate PBP job.
# `dbt build` runs seeds, models, and each model's tests together in DAG order,
# so a failing test stops that model's descendants instead of publishing them
# and reporting the failure afterwards. RUN_DBT_TEST=0 drops the tests only.
# deps + build share one container: `compose run --rm` would otherwise
# discard a runtime `dbt deps`. Production images already bake dbt_packages;
# deps is a no-op then, and covers development images that might not.
DBT_BUILD_ARGS=""
if [[ "$RUN_DBT_TEST" != "1" ]]; then
  DBT_BUILD_ARGS=" --exclude-resource-type test"
fi
# dbt-build.sh records the exit code and failed node names on the run row.
set +e
COMPOSE="$COMPOSE" DBT_BUILD_ARGS="$DBT_BUILD_ARGS" RUN_ID="$RUN_ID" NOTIFY=1 LABEL="refresh-daily" \
  ./scripts/dbt-build.sh
DBT_EXIT=$?
set -e

if [[ "$DBT_EXIT" -ne 0 ]]; then
  echo "==> dbt failed (exit ${DBT_EXIT})"
  exit "$DBT_EXIT"
fi

# The ml stage is scoring plus the gold copy, the same pair `make ml` runs.
# ML_STEP names whichever half failed so the alert points at the right one.
set +e
echo "==> ml score (Elo + logit pregame)"
compose_run ml python -m main score
ML_EXIT=$?
ML_STEP="ml score"
if [[ "$ML_EXIT" -eq 0 ]]; then
  echo "==> dbt copy source.game_predictions → gold.fct_game_predictions"
  compose_run dbt sh -c \
    'dbt deps --profiles-dir . && dbt run --profiles-dir . --select stg_game_predictions+'
  ML_EXIT=$?
  ML_STEP="dbt predictions copy"
fi
set -e

if [[ -n "$RUN_ID" ]]; then
  compose_run scraper python -m main pipeline mark-ml --notify \
    --run-id "$RUN_ID" --ml-exit "$ML_EXIT" --detail "${ML_STEP} finished with exit ${ML_EXIT}" \
    >/dev/null || true
fi

if [[ "$ML_EXIT" -ne 0 ]]; then
  echo "==> ${ML_STEP} failed (exit ${ML_EXIT})"
  exit "$ML_EXIT"
fi

echo "==> refresh-daily complete (run_id=${RUN_ID})"
