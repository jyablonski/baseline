#!/usr/bin/env bash
# admin-job-runner.sh — claim and execute one queued job from source.admin_jobs.
#
# The /admin console enqueues; this runs. It has to live on the host because
# executing `make` means talking to the Docker socket, and the API container
# must never be given one: it is reachable from the internet through Caddy, so
# docker.sock there would be root-equivalent on the box.
#
# Runs one job per invocation and exits, so a stuck job cannot wedge a loop.
# Wire it to cron (or a systemd timer) every minute:
#
#   * * * * * cd /opt/nba && make prod-admin-jobs >> /opt/nba/logs/admin-jobs.log 2>&1
#
# Shares LOCK_FILE with the daily refresh so an operator button press can never
# overlap the 08:15 cron. If the lock is held the job goes back to 'queued' and
# is retried on the next tick rather than being reported as a failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
LOCK_FILE="${LOCK_FILE:-/tmp/nba-refresh.lock}"
LOG_TAIL_LINES="${LOG_TAIL_LINES:-50}"
# Cap the stored log so a single pathological line cannot blow past ARG_MAX
# when the UPDATE is passed to psql on the command line.
LOG_TAIL_BYTES="${LOG_TAIL_BYTES:-8000}"
# A 'running' row older than this whose lock is free belongs to a runner that
# died. The free lock is the real signal, so this only has to exceed the gap
# between claiming a row and taking the flock (microseconds). Kept short so a
# crashed runner unblocks the queue in minutes rather than leaving the console
# returning 409 for half an hour.
STALE_JOB_GRACE="${STALE_JOB_GRACE:-5 minutes}"
# Distinct from any make exit code, so "lock was busy" is unambiguous.
LOCK_BUSY_EXIT=75
# /admin's VM panel reads the newest row; older ones are only for looking back
# at an incident. One row a minute is ~10k rows a week.
HOST_SNAPSHOT_RETENTION="${HOST_SNAPSHOT_RETENTION:-7 days}"

psql_query() {
  $COMPOSE exec -T postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$0"' "$1"
}

# Claim exactly one job. FOR UPDATE SKIP LOCKED means a second runner takes the
# next row instead of blocking or double-running this one.
# A runner killed mid-job (OOM, reboot, dropped SSH) leaves its row 'running'
# forever. The partial unique index then rejects every new job and the runner
# never claims one, so the console wedges permanently and the only way out is
# the SSH session this whole feature exists to avoid.
#
# Two conditions, both required. The flock being free is the real signal that
# no job is actually executing; the age grace covers the microsecond gap
# between claiming a row and taking the lock.
reap_stale_jobs() {
  if ! flock -n "$LOCK_FILE" true 2>/dev/null; then
    return 0
  fi
  local reaped
  reaped="$(psql_query "
    WITH stale AS (
      UPDATE source.admin_jobs
      SET status = 'failed',
          exit_code = NULL,
          finished_at = now(),
          log_tail = coalesce(log_tail || E'\n', '')
              || 'Marked failed by admin-job-runner: the runner holding this job '
              || 'exited without reporting (started '
              || to_char(started_at, 'YYYY-MM-DD HH24:MI:SS') || ').'
      WHERE status = 'running'
        AND started_at < now() - interval '${STALE_JOB_GRACE}'
      RETURNING job_id
    )
    SELECT count(*) FROM stale
  ")" || return 0
  if [[ "${reaped// /}" != "0" && -n "${reaped// /}" ]]; then
    echo "admin-job-runner: reaped ${reaped// /} abandoned job(s)" >&2
  fi
}

claim_job() {
  # Wrapped in a CTE so the top-level statement is a SELECT: a bare
  # UPDATE ... RETURNING also prints psql's "UPDATE 1" command tag, which
  # would be parsed as part of the job type.
  psql_query "
    WITH claimed AS (
      UPDATE source.admin_jobs
      SET status = 'running', started_at = now()
      WHERE job_id = (
        SELECT queued.job_id
        FROM source.admin_jobs AS queued
        WHERE queued.status = 'queued'
        ORDER BY queued.requested_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING job_id, job_type
    )
    SELECT claimed.job_id || '|' || claimed.job_type FROM claimed
  "
}

finish_job() {
  local job_id="$1" status="$2" exit_code="$3" log_file="$4"
  # base64 so arbitrary log output cannot break out of the SQL literal.
  local encoded
  encoded="$(tail -n "$LOG_TAIL_LINES" "$log_file" | tail -c "$LOG_TAIL_BYTES" | base64 | tr -d '\n')"
  psql_query "
    UPDATE source.admin_jobs
    SET status = '${status}',
        exit_code = ${exit_code},
        finished_at = now(),
        log_tail = convert_from(decode('${encoded}', 'base64'), 'UTF8')
    WHERE job_id = ${job_id}
  " >/dev/null
}

requeue_job() {
  psql_query "
    UPDATE source.admin_jobs
    SET status = 'queued', started_at = NULL
    WHERE job_id = $1
  " >/dev/null
}

# Piggybacks on this every-minute cron because it is already the host-side
# process with Docker access. Best effort: a missing python3, a Docker hiccup,
# or a not-yet-migrated table must never stop the queue from draining.
record_host_snapshot() {
  local encoded
  encoded="$(python3 "$ROOT/scripts/host-snapshot.py" | base64 | tr -d '\n')" || encoded=""
  if [[ -z "$encoded" ]]; then
    echo "admin-job-runner: host snapshot collection failed" >&2
    return 0
  fi
  psql_query "
    WITH pruned AS (
      DELETE FROM source.host_snapshots
      WHERE captured_at < now() - interval '${HOST_SNAPSHOT_RETENTION}'
    )
    INSERT INTO source.host_snapshots (payload)
    VALUES (convert_from(decode('${encoded}', 'base64'), 'UTF8')::jsonb)
  " >/dev/null || echo "admin-job-runner: could not record host snapshot" >&2
}

record_host_snapshot
reap_stale_jobs

# Distinguish "no work" from "cannot reach the database". Swallowing the
# latter would make an outage look like a permanently idle queue.
if ! claimed="$(claim_job)"; then
  echo "admin-job-runner: could not reach postgres in project ${COMPOSE_PROJECT_NAME}" >&2
  exit 1
fi
if [[ -z "${claimed// /}" ]]; then
  exit 0
fi

JOB_ID="${claimed%%|*}"
JOB_TYPE="${claimed##*|}"

# Explicit allow-list. The job_type CHECK constraint already bounds this, but
# the mapping stays closed here too so a new enum value can never fall through
# to an unintended target.
case "$JOB_TYPE" in
  scrape) TARGET="prod-scrape" ;;
  dbt) TARGET="prod-dbt" ;;
  ml) TARGET="prod-ml" ;;
  refresh) TARGET="prod-refresh" ;;
  *)
    echo "admin-job-runner: unknown job_type '${JOB_TYPE}' for job ${JOB_ID}" >&2
    printf 'unknown job_type %s\n' "$JOB_TYPE" >"/tmp/nba-admin-job-${JOB_ID}.log"
    finish_job "$JOB_ID" failed 1 "/tmp/nba-admin-job-${JOB_ID}.log"
    rm -f "/tmp/nba-admin-job-${JOB_ID}.log"
    exit 1
    ;;
esac

LOG_FILE="$(mktemp -t "nba-admin-job-${JOB_ID}.XXXXXX")"
trap 'rm -f "$LOG_FILE"' EXIT

echo "admin-job-runner: job ${JOB_ID} (${JOB_TYPE}) -> make ${TARGET}"
set +e
flock -n -E "$LOCK_BUSY_EXIT" "$LOCK_FILE" make "$TARGET" >"$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

if [[ "$EXIT_CODE" -eq "$LOCK_BUSY_EXIT" ]]; then
  echo "admin-job-runner: refresh lock busy; re-queueing job ${JOB_ID}"
  requeue_job "$JOB_ID"
  exit 0
fi

if [[ "$EXIT_CODE" -eq 0 ]]; then
  finish_job "$JOB_ID" succeeded "$EXIT_CODE" "$LOG_FILE"
  echo "admin-job-runner: job ${JOB_ID} succeeded"
else
  finish_job "$JOB_ID" failed "$EXIT_CODE" "$LOG_FILE"
  echo "admin-job-runner: job ${JOB_ID} failed (exit ${EXIT_CODE})" >&2
fi

exit "$EXIT_CODE"
