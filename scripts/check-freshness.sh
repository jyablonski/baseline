#!/usr/bin/env bash
# check-freshness.sh — alert when the daily refresh has not succeeded recently.
#
# Deliberately independent of the refresh path. Every other signal in this
# system is emitted *by* the pipeline: Slack posts come from SyncAlert, and
# source.pipeline_runs rows are written by the scraper. A pipeline that never
# starts is therefore completely silent — which is exactly what happened when
# cron ran `make refresh-daily` instead of `make prod-refresh` and died at the
# Alembic step before the scraper ever opened a session.
#
# This needs only a running postgres and curl, so it survives the failure modes
# that break the refresh (wrong make target, missing IMAGE_PREFIX, unpullable
# or unbuildable tools image). Run it from a SEPARATE cron entry, hours after
# the refresh window:
#
#   30 12 * * * cd /opt/nba && ./scripts/check-freshness.sh >> /opt/nba/logs/freshness.log 2>&1
#
# Exit 0 = healthy or intentionally disabled. Exit 1 = stale (alert posted).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"

# Hours since the last successful scrape before this is considered a problem.
# 26 gives a daily job one missed run of slack without crying wolf on a late start.
STALE_HOURS="${STALE_HOURS:-26}"
if ! [[ "$STALE_HOURS" =~ ^[0-9]+$ ]]; then
  echo "check-freshness: STALE_HOURS must be a whole number, got '${STALE_HOURS}'" >&2
  exit 2
fi

# SLACK_WEBHOOK_URL normally reaches services through compose env_file; this
# script runs on the host, so read it from .env unless already exported.
if [[ -z "${SLACK_WEBHOOK_URL:-}" && -f .env ]]; then
  SLACK_WEBHOOK_URL="$(sed -n 's/^SLACK_WEBHOOK_URL=//p' .env | tail -n1)"
fi

psql_query() {
  $COMPOSE exec -T postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$0"' "$1"
}

# One row: verdict|last_success_at|hours_since|last_run_status|last_run_started
read_state() {
  psql_query "
    SELECT
      CASE
        WHEN NOT pipeline.enabled THEN 'disabled'
        WHEN pipeline.last_success_at IS NULL THEN 'never'
        WHEN now() - pipeline.last_success_at > interval '${STALE_HOURS} hours' THEN 'stale'
        ELSE 'ok'
      END,
      coalesce(pipeline.last_success_at::text, ''),
      coalesce(round(extract(epoch FROM now() - pipeline.last_success_at) / 3600.0, 1)::text, ''),
      coalesce((SELECT runs.status FROM source.pipeline_runs AS runs
                ORDER BY runs.started_at DESC LIMIT 1), 'none'),
      coalesce((SELECT runs.started_at::text FROM source.pipeline_runs AS runs
                ORDER BY runs.started_at DESC LIMIT 1), '')
    FROM source.scrape_pipeline AS pipeline
    WHERE pipeline.id = 1
  "
}

post_slack() {
  local text="$1"
  if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
    echo "check-freshness: SLACK_WEBHOOK_URL unset; not posting" >&2
    return 0
  fi
  # Never let a webhook problem mask the staleness itself.
  curl -sS -m 10 -X POST -H 'Content-type: application/json' \
    --data "$(printf '{"text": %s}' "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    "$SLACK_WEBHOOK_URL" >/dev/null || echo "check-freshness: Slack POST failed" >&2
}

if ! state="$(read_state 2>/dev/null)"; then
  message="nba freshness check could not reach postgres in compose project ${COMPOSE_PROJECT_NAME}."
  echo "$message" >&2
  post_slack "$message"
  exit 1
fi

IFS='|' read -r verdict last_success hours_since last_run_status last_run_started <<<"$state"

case "$verdict" in
  disabled)
    echo "check-freshness: pipeline disabled in source.scrape_pipeline; nothing expected."
    exit 0
    ;;
  ok)
    echo "check-freshness: ok (last success ${last_success}, ${hours_since}h ago)."
    exit 0
    ;;
  never)
    detail="the pipeline has never recorded a successful scrape"
    ;;
  stale)
    detail="last success was ${last_success} (${hours_since}h ago, threshold ${STALE_HOURS}h)"
    ;;
  *)
    echo "check-freshness: unexpected verdict '${verdict}'" >&2
    exit 2
    ;;
esac

message="nba daily refresh is stale: ${detail}. Most recent pipeline_runs row: ${last_run_status}"
if [[ -n "$last_run_started" ]]; then
  message="${message} at ${last_run_started}"
fi
message="${message}. The scrape may not be running at all — check cron and /opt/nba/logs/refresh-daily.log."

echo "$message" >&2
post_slack "$message"
exit 1
