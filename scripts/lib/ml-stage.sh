# shellcheck shell=bash
# ml-stage.sh — sourced, not run. The ml stage shared by refresh-daily.sh and
# catch-up.sh: scoring plus the gold predictions copy, the same pair `make ml`
# runs. Needs a `compose_run` function from the caller.
#
#   run_ml_stage "$RUN_ID"   # returns the stage's exit code
#
# ML_STEP names whichever half failed so the alert points at the right one. A
# failure posts once through `pipeline mark-ml --notify`, which also records
# the exit code on the run row.
run_ml_stage() {
  local run_id="$1"
  local ml_exit ml_step
  set +e
  echo "==> ml score (Elo + logit pregame)"
  compose_run ml python -m main score
  ml_exit=$?
  ml_step="ml score"
  if [[ "$ml_exit" -eq 0 ]]; then
    echo "==> dbt copy source.game_predictions → gold.fct_game_predictions"
    compose_run dbt sh -c \
      'dbt deps --profiles-dir . && dbt run --profiles-dir . --select stg_game_predictions+'
    ml_exit=$?
    ml_step="dbt predictions copy"
  fi
  set -e

  if [[ -n "$run_id" ]]; then
    compose_run scraper python -m main pipeline mark-ml --notify \
      --run-id "$run_id" --ml-exit "$ml_exit" --detail "${ml_step} finished with exit ${ml_exit}" \
      >/dev/null || true
  fi

  if [[ "$ml_exit" -ne 0 ]]; then
    echo "==> ${ml_step} failed (exit ${ml_exit})"
  fi
  return "$ml_exit"
}
