#!/usr/bin/env bash
# test-admin-jobs.sh — end-to-end checks for scripts/admin-job-runner.sh.
#
# Exercises the real runner against the real Postgres in the local Compose
# project. Not a unit test: the runner is shell + SQL, and the parts that are
# easy to get wrong (atomic claim, flock contention, reaping an abandoned job)
# only exist when a database and a lock file do.
#
#   make test-admin-jobs      # needs `make up` / a running postgres
#
# Uses its own LOCK_FILE so it can never collide with a real refresh, and
# restores source.admin_jobs to empty on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
export LOCK_FILE="${LOCK_FILE:-/tmp/nba-admin-jobs-test.lock}"

PASS=0
FAIL=0

psql_query() {
  $COMPOSE exec -T postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$0"' "$1"
}

cleanup() {
  psql_query "DELETE FROM source.admin_jobs" >/dev/null 2>&1 || true
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT

reset_jobs() { psql_query "DELETE FROM source.admin_jobs" >/dev/null; }

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "${actual// /}" == "${expected// /}" ]]; then
    echo "  ok   ${label}"
    PASS=$((PASS + 1))
  else
    echo "  FAIL ${label}: expected '${expected}', got '${actual}'" >&2
    FAIL=$((FAIL + 1))
  fi
}

if ! psql_query "SELECT 1" >/dev/null 2>&1; then
  echo "test-admin-jobs: postgres is not reachable in project ${COMPOSE_PROJECT_NAME}." >&2
  echo "Start it with \`make up\` first." >&2
  exit 1
fi

echo "==> empty queue is a silent no-op"
reset_jobs
./scripts/admin-job-runner.sh >/dev/null 2>&1
assert_eq "exit status" 0 "$?"
assert_eq "no rows created" 0 "$(psql_query 'SELECT count(*) FROM source.admin_jobs')"

echo "==> every tick records a host snapshot"
psql_query "DELETE FROM source.host_snapshots" >/dev/null
./scripts/admin-job-runner.sh >/dev/null 2>&1
assert_eq "one snapshot row" 1 "$(psql_query 'SELECT count(*) FROM source.host_snapshots')"
assert_eq "host memory captured" "t" \
  "$(psql_query "SELECT (payload->'host'->>'mem_total_bytes')::bigint > 0 FROM source.host_snapshots")"
assert_eq "no collector errors" 0 \
  "$(psql_query "SELECT jsonb_array_length(payload->'errors') FROM source.host_snapshots")"

echo "==> a queued job is claimed, executed and recorded"
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by) VALUES ('dbt','e2e')" >/dev/null
# prod-dbt exits non-zero immediately without IMAGE_PREFIX, which is a fine
# stand-in for a failing job: what matters is that the outcome is recorded.
./scripts/admin-job-runner.sh >/dev/null 2>&1 || true
assert_eq "terminal status" "failed" "$(psql_query "SELECT status FROM source.admin_jobs")"
assert_eq "exit code recorded" "t" "$(psql_query "SELECT exit_code IS NOT NULL FROM source.admin_jobs")"
assert_eq "log tail captured" "t" "$(psql_query "SELECT log_tail IS NOT NULL AND length(log_tail) > 0 FROM source.admin_jobs")"
assert_eq "finished_at set" "t" "$(psql_query "SELECT finished_at IS NOT NULL FROM source.admin_jobs")"

echo "==> only one job may be pending at a time"
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by) VALUES ('dbt','e2e')" >/dev/null
second_insert_failed=0
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by) VALUES ('ml','e2e')" >/dev/null 2>&1 \
  || second_insert_failed=1
assert_eq "second pending insert rejected" 1 "$second_insert_failed"

echo "==> a busy lock re-queues instead of failing the job"
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by) VALUES ('refresh','e2e')" >/dev/null
flock "$LOCK_FILE" -c 'sleep 6' &
lock_pid=$!
sleep 1
./scripts/admin-job-runner.sh >/dev/null 2>&1
assert_eq "runner exit status" 0 "$?"
assert_eq "job back to queued" "queued" "$(psql_query "SELECT status FROM source.admin_jobs")"
assert_eq "started_at cleared" "t" "$(psql_query "SELECT started_at IS NULL FROM source.admin_jobs")"
wait "$lock_pid" 2>/dev/null || true

echo "==> a running job inside the grace window is left alone"
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by, status, started_at)
            VALUES ('dbt','e2e','running', now() - interval '1 minute')" >/dev/null
./scripts/admin-job-runner.sh >/dev/null 2>&1 || true
assert_eq "still running" "running" "$(psql_query "SELECT status FROM source.admin_jobs")"

echo "==> an abandoned job past the grace window is reaped"
# Without this the partial unique index rejects every new job forever and the
# console can only be unwedged over SSH, which is what it exists to avoid.
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by, status, started_at)
            VALUES ('refresh','e2e','running', now() - interval '6 hours')" >/dev/null
./scripts/admin-job-runner.sh >/dev/null 2>&1 || true
assert_eq "reaped to failed" "failed" "$(psql_query "SELECT status FROM source.admin_jobs")"
assert_eq "reason recorded" "t" \
  "$(psql_query "SELECT log_tail LIKE '%exited without reporting%' FROM source.admin_jobs")"
assert_eq "queue reopened" "t" \
  "$(psql_query "SELECT count(*) = 0 FROM source.admin_jobs WHERE status IN ('queued','running')")"

echo "==> an abandoned job is NOT reaped while the lock is held"
reset_jobs
psql_query "INSERT INTO source.admin_jobs (job_type, requested_by, status, started_at)
            VALUES ('refresh','e2e','running', now() - interval '6 hours')" >/dev/null
flock "$LOCK_FILE" -c 'sleep 6' &
lock_pid=$!
sleep 1
./scripts/admin-job-runner.sh >/dev/null 2>&1 || true
assert_eq "left running while lock held" "running" "$(psql_query "SELECT status FROM source.admin_jobs")"
wait "$lock_pid" 2>/dev/null || true

echo
echo "test-admin-jobs: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
