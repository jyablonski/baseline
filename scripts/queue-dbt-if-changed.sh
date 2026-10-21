#!/usr/bin/env bash
# queue-dbt-if-changed.sh — after a release, queue a dbt rebuild in
# source.admin_jobs when services/dbt changed between the commit prod was
# running and the one just deployed.
#
#   PREVIOUS_TAG=<sha> IMAGE_TAG=<sha> ./scripts/queue-dbt-if-changed.sh
#
# Queued rather than run inline: admin-job-runner.sh takes the refresh lock, so
# the rebuild never overlaps the daily refresh, it is recorded in /admin like a
# button press, and the deploy only pays for one INSERT.
#
# Diffs against the previous *deployed* commit, not the previous one on main:
# dbt changes in pushes that never deployed still count.
#
# When either commit cannot be resolved (first deploy, no .env.deploy, a tag
# that is not a commit in this checkout) it queues anyway. An unneeded rebuild
# costs a few minutes; a skipped one leaves gold built from the old SQL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
PREVIOUS_TAG="${PREVIOUS_TAG:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
# The e2e harness only runs in CI; changing it changes nothing in gold.
DBT_PATHS=(services/dbt ':(exclude)services/dbt/e2e')

# shellcheck source=scripts/lib/psql.sh
source "$ROOT/scripts/lib/psql.sh"

resolve_commit() {
  [[ -n "$1" ]] && git rev-parse --verify --quiet "$1^{commit}"
}

if [[ -z "$PREVIOUS_TAG" ]]; then
  reason="no previous deploy recorded"
elif ! previous="$(resolve_commit "$PREVIOUS_TAG")"; then
  reason="previous deploy '${PREVIOUS_TAG}' is not a known commit"
elif ! current="$(resolve_commit "$IMAGE_TAG")"; then
  reason="deployed tag '${IMAGE_TAG}' is not a known commit"
elif git diff --quiet "$previous" "$current" -- "${DBT_PATHS[@]}"; then
  echo "queue-dbt-if-changed: no dbt changes in ${previous:0:7}..${current:0:7}; nothing queued"
  exit 0
else
  reason="dbt changed in ${previous:0:7}..${current:0:7}"
fi

# Interpolated into SQL, so keep only characters a tag can legitimately hold.
tag_label="${IMAGE_TAG//[^A-Za-z0-9._-]/}"
requested_by="deploy ${tag_label:0:12}"

# ON CONFLICT covers the single-pending partial unique index: an empty result
# means another job is already queued or running. The CTE keeps psql from
# printing the INSERT command tag alongside the id.
queue_job() {
  psql_query "
    WITH queued AS (
      INSERT INTO source.admin_jobs (job_type, requested_by)
      VALUES ('dbt', '${requested_by% }')
      ON CONFLICT DO NOTHING
      RETURNING job_id
    )
    SELECT queued.job_id FROM queued
  "
}

pending_job() {
  psql_query "
    SELECT admin_jobs.job_id || ' (' || admin_jobs.job_type || ', ' || admin_jobs.status || ')'
    FROM source.admin_jobs
    WHERE admin_jobs.status IN ('queued', 'running')
  "
}

# Two tries: the pending job can finish between a rejected INSERT and the
# SELECT that names it, which leaves the queue free and nothing to report.
for _ in 1 2; do
  job_id="$(queue_job)"
  job_id="${job_id// /}"
  if [[ -n "$job_id" ]]; then
    echo "queue-dbt-if-changed: ${reason}; queued dbt job ${job_id}"
    exit 0
  fi
  pending="$(pending_job)"
  [[ -n "${pending// /}" ]] && break
done

# A dbt job still queued will run on the images just deployed, so it covers
# this release. Anything else, including a dbt job already running on the old
# images, does not.
if [[ "$pending" == *"(dbt, queued)"* ]]; then
  echo "queue-dbt-if-changed: ${reason}; dbt job ${pending%% *} is already queued"
else
  echo "queue-dbt-if-changed: WARNING ${reason}, but job ${pending:-(unknown)} is pending, so dbt was not queued." >&2
  echo "queue-dbt-if-changed: re-run dbt from /admin once it finishes." >&2
fi
