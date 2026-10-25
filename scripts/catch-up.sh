#!/usr/bin/env bash
# catch-up.sh — hourly retry for last night's games when BRef published late.
#
# The 12:00 UTC refresh usually finds last night's box scores and play-by-play.
# When BRef is late, those games are still 'Scheduled' (no score yet) or Final
# without one of the two pages, the refresh succeeds with nothing to load, and
# the data would otherwise wait for tomorrow's refresh. This closes the gap:
#
#   1. One SQL query against the running postgres: is the pipeline on, and is
#      any game dated yesterday (Eastern) not Final, or Final without a box
#      score or play-by-play? No → exit 0. No container, no HTTP, so the
#      normal day costs one psql call per cron tick.
#   2. `pipeline catch-up`: refresh the schedule, scrape the missing box
#      scores and play-by-play. Nothing else (no odds, reddit, standings).
#   3. Only if that changed anything: dbt build, then the ml stage. ML skips
#      games that have tipped, so a run during game time cannot overwrite a
#      graded pregame prediction.
#
# Cron, hourly through the afternoon, sharing the refresh lock so it never
# overlaps the 12:00 refresh or an /admin job (a held lock just skips the hour):
#
#   0 13-21 * * * cd /opt/nba && flock -n /tmp/nba-refresh.lock make prod-catch-up >> /opt/nba/logs/catch-up.log 2>&1
#
# The run at or after FINAL_HOUR_UTC (keep it equal to the cron's last hour)
# passes --final: if games are still missing then, one Slack post lists them.
# Every earlier attempt is silent apart from dbt/ml failures, which alert as
# they do in refresh-daily.sh. If the lock is held at the final tick, that
# day's give-up alert does not fire; the next day's 12:00 refresh still
# picks the games up.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
FINAL_HOUR_UTC="${FINAL_HOUR_UTC:-21}"

# shellcheck source=scripts/lib/psql.sh
source "$ROOT/scripts/lib/psql.sh"
# shellcheck source=scripts/lib/ml-stage.sh
source "$ROOT/scripts/lib/ml-stage.sh"

compose_run() {
  $COMPOSE --profile tools run --rm --no-deps "$@"
}

# Mirrors the gate in pipeline.decide_action (enabled, season window,
# scrape_mode daily) and SELECT_CATCH_UP_GAPS in
# services/scraper/src/queries/catch_up.py. Change them together. The scraper
# re-checks both, so drift here costs a wasted container start, not a wrong
# scrape.
pending_games() {
  psql_query "
    SELECT count(*)
    FROM source.scrape_pipeline
    INNER JOIN source.games
        ON games.game_date = (now() AT TIME ZONE 'America/New_York')::date - 1
    WHERE
        scrape_pipeline.id = 1
        AND scrape_pipeline.enabled
        AND scrape_pipeline.season_active
        AND (scrape_pipeline.season_start IS NULL OR current_date >= scrape_pipeline.season_start)
        AND (scrape_pipeline.season_end IS NULL OR current_date <= scrape_pipeline.season_end)
        AND lower(coalesce(scrape_pipeline.scrape_mode, 'daily')) NOT IN ('none', 'season')
        AND (
            games.status <> 'Final'
            OR NOT EXISTS (
                SELECT 1
                FROM source.player_game_logs
                WHERE player_game_logs.game_id = games.game_id
            )
            OR NOT EXISTS (
                SELECT 1
                FROM source.play_by_play
                WHERE play_by_play.game_id = games.game_id
            )
        )
  "
}

PENDING="$(pending_games)"
PENDING="${PENDING// /}"
if [[ "$PENDING" == "0" ]]; then
  echo "catch-up: nothing missing for last night (or the pipeline is off); exiting."
  exit 0
fi
echo "==> catch-up: ${PENDING} game(s) from last night still missing data"

# Images are not re-pulled here: the 12:00 prod-refresh already pulled the
# deployed tag today, and a deploy pulls its own.
CATCH_UP_ARGS=(pipeline catch-up)
if (( 10#$(date -u +%H) >= FINAL_HOUR_UTC )); then
  CATCH_UP_ARGS+=(--final)
fi

OUT="$(compose_run scraper python -m main "${CATCH_UP_ARGS[@]}")"
echo "$OUT"
RUN_ID="$(echo "$OUT" | sed -n 's/^run_id=//p' | tail -n1)"
CHANGED="$(echo "$OUT" | sed -n 's/^changed=//p' | tail -n1)"

# Partial progress still gets built: a failed play-by-play fetch should not
# hold back box scores that did land.
if [[ "$CHANGED" != "1" ]]; then
  echo "==> catch-up: nothing new from BRef yet; dbt not run."
  exit 0
fi

echo "==> dbt build"
set +e
COMPOSE="$COMPOSE" RUN_ID="$RUN_ID" NOTIFY=1 LABEL="catch-up" ./scripts/dbt-build.sh
DBT_EXIT=$?
set -e
if [[ "$DBT_EXIT" -ne 0 ]]; then
  echo "==> dbt failed (exit ${DBT_EXIT})"
  exit "$DBT_EXIT"
fi

ML_EXIT=0
run_ml_stage "$RUN_ID" || ML_EXIT=$?
if [[ "$ML_EXIT" -ne 0 ]]; then
  exit "$ML_EXIT"
fi

echo "==> catch-up complete (run_id=${RUN_ID})"
