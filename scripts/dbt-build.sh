#!/usr/bin/env bash
# dbt-build.sh — one `dbt deps && dbt build`, recorded on source.pipeline_runs
# with the names of whatever failed.
#
#   RUN_ID=<id> NOTIFY=1 ./scripts/dbt-build.sh   # refresh-daily: mark the scrape's run row
#   LABEL="make dbt" ./scripts/dbt-build.sh       # standalone: open a dbt-only run row
#
# Env: COMPOSE (default `docker compose`), DBT_BUILD_ARGS (appended to
# `dbt build`, e.g. " --full-refresh"). Exits with dbt's exit code; recording is
# best effort and never changes it.
#
# The failed nodes come from dbt's own summary lines ("Failure in test x",
# "Database Error in model y") rather than target/run_results.json, because
# `compose run --rm` discards the container and its target/ with it. Output is
# still streamed live; it is only tee'd so it can be read back.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
DBT_BUILD_ARGS="${DBT_BUILD_ARGS:-}"
RUN_ID="${RUN_ID:-}"
LABEL="${LABEL:-dbt}"
NOTIFY="${NOTIFY:-0}"
# Slack and the admin card want the gist, not every name; the detail line still
# carries the true total. /admin assumes this cap (DBT_FAILED_NODES_CAP).
MAX_FAILED_NODES=25

compose_run() {
  $COMPOSE --profile tools run --rm --no-deps "$@"
}

LOG_FILE="$(mktemp -t nba-dbt-build.XXXXXX)"
trap 'rm -f "$LOG_FILE"' EXIT

set +e
# -T: no pseudo-TTY, so the tee'd copy has no carriage returns.
compose_run -T dbt sh -c \
  "dbt deps --profiles-dir . && dbt build --profiles-dir .${DBT_BUILD_ARGS}" 2>&1 | tee "$LOG_FILE"
DBT_EXIT=${PIPESTATUS[0]}
set -e

# "<resource_type> <name>", first occurrence only: dbt prints each failure once
# as it happens and again in the end-of-run summary.
all_failed=()
if [[ "$DBT_EXIT" -ne 0 ]]; then
  mapfile -t all_failed < <(
    sed -e 's/\x1b\[[0-9;]*m//g' "$LOG_FILE" \
      | sed -nE 's/.*(Failure|Error) in (model|test|seed|snapshot|unit_test) ([^ ]+).*/\2 \3/p' \
      | awk '!seen[$0]++'
  )
fi
failed_nodes=("${all_failed[@]:0:$MAX_FAILED_NODES}")

DETAIL="dbt finished with exit ${DBT_EXIT}"
if [[ "${#all_failed[@]}" -gt 0 ]]; then
  DETAIL="${DETAIL}; failed: ${all_failed[0]}"
  if [[ "${#all_failed[@]}" -gt 1 ]]; then
    DETAIL="${DETAIL} (+$((${#all_failed[@]} - 1)) more)"
  fi
fi

node_args=()
for node in "${failed_nodes[@]}"; do
  node_args+=(--failed-node "$node")
done

if [[ -n "$RUN_ID" ]]; then
  notify_flag=()
  [[ "$NOTIFY" == "1" ]] && notify_flag=(--notify)
  compose_run scraper python -m main pipeline mark-dbt "${notify_flag[@]}" \
    --run-id "$RUN_ID" --dbt-exit "$DBT_EXIT" --detail "$DETAIL" "${node_args[@]}" \
    >/dev/null || true
else
  compose_run scraper python -m main pipeline record-dbt \
    --dbt-exit "$DBT_EXIT" --detail "${LABEL}: ${DETAIL}" "${node_args[@]}" >/dev/null || true
fi

exit "$DBT_EXIT"
