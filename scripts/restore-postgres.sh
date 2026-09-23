#!/usr/bin/env bash
# restore-postgres.sh — prove a backup restores, or restore it over the live DB.
#
# A backup that has never been restored is a hope, not a backup. The default
# mode restores a dump into a THROWAWAY postgres container (never the compose
# stack's), checks the result looks like this warehouse, and removes it.
#
#   make db-restore-test                        # newest daily dump
#   make db-restore-test DUMP=backups/daily/nba-20260922T073000Z.dump
#
# Live restore replaces the running database. It is refused unless
# CONFIRM_RESTORE=RESTORE is set, and it always:
#   1. restore-tests the same dump first (a dump that fails that never goes live)
#   2. takes a safety backup of the current DB into $BACKUP_DIR/pre-restore/
#   3. holds the refresh lock so the daily refresh / admin jobs cannot run mid-restore
#
#   RESTORE_TARGET=live CONFIRM_RESTORE=RESTORE make prod-db-restore DUMP=...
#
# Services that hold connections (api, mcp, cube) are disconnected by
# `dropdb --force` and reconnect on their next request.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RESTORE_TARGET="${RESTORE_TARGET:-scratch}"
LOCK_FILE="${LOCK_FILE:-/tmp/nba-refresh.lock}"
# Same image the stack runs, so a dump from a newer pg_dump cannot pass here
# and then fail against production.
RESTORE_IMAGE="${RESTORE_IMAGE:-$(sed -n 's/^ *image: \(postgres:[^ ]*\)$/\1/p' docker-compose.yml | head -n1)}"

# Same host-side .env read as check-freshness.sh; a weekly restore-test that
# fails in cron is only useful if someone hears about it.
if [[ -z "${SLACK_WEBHOOK_URL:-}" && -f .env ]]; then
  SLACK_WEBHOOK_URL="$(sed -n 's/^SLACK_WEBHOOK_URL=//p' .env | tail -n1)"
fi

post_slack() {
  local text="$1"
  if [[ -z "${SLACK_WEBHOOK_URL:-}" ]]; then
    return 0
  fi
  curl -sS -m 10 -X POST -H 'Content-type: application/json' \
    --data "$(printf '{"text": %s}' "$(printf '%s' "$text" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    "$SLACK_WEBHOOK_URL" >/dev/null || echo "restore-postgres: Slack POST failed" >&2
}

DUMP="${1:-${DUMP:-}}"
if [[ -z "$DUMP" ]]; then
  DUMP="$(find "$BACKUP_DIR/daily" -maxdepth 1 -name 'nba-*.dump' 2>/dev/null | sort -r | head -n1)"
fi
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "restore-postgres: no dump found (pass DUMP=... or run make db-backup first)" >&2
  exit 1
fi

SCRATCH="nba-restore-test-$$"
trap 'docker rm -f "$SCRATCH" >/dev/null 2>&1 || true' EXIT

scratch_sql() {
  docker exec "$SCRATCH" psql -X -A -t -h 127.0.0.1 -U postgres -d nba -v ON_ERROR_STOP=1 -c "$1"
}

restore_test() {
  local container="$SCRATCH"
  echo "==> restore-test ${DUMP} into throwaway ${RESTORE_IMAGE} (${container})"
  docker run -d --rm --name "$container" \
    -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=nba \
    "$RESTORE_IMAGE" >/dev/null

  local ready=0
  for _ in $(seq 1 60); do
    # pg_isready passes during the image's init-time temporary server, so
    # probe with a real query over TCP, which that server does not accept.
    if docker exec "$container" psql -h 127.0.0.1 -U postgres -d nba -c 'SELECT 1' >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "restore-postgres: throwaway postgres never became ready" >&2
    return 1
  fi

  # --no-owner/--no-privileges: the scratch server has none of prod's roles.
  if ! docker exec -i "$container" pg_restore -h 127.0.0.1 -U postgres -d nba \
    --no-owner --no-privileges --exit-on-error <"$DUMP"; then
    echo "restore-postgres: pg_restore failed; this dump is NOT restorable" >&2
    return 1
  fi

  local schemas tables alembic
  schemas="$(scratch_sql "SELECT count(*) FROM pg_namespace WHERE nspname IN ('source', 'silver', 'gold')")"
  tables="$(scratch_sql "SELECT count(*) FROM pg_tables WHERE schemaname = 'source'")"
  alembic="$(scratch_sql "SELECT coalesce(max(version_num), '') FROM (SELECT version_num FROM alembic_version) AS versions" 2>/dev/null || true)"
  if [[ "$schemas" != 3 || "$tables" -eq 0 || -z "$alembic" ]]; then
    echo "restore-postgres: restored DB does not look like the warehouse" \
      "(schemas=${schemas}, source tables=${tables}, alembic='${alembic}')" >&2
    return 1
  fi

  scratch_sql "ANALYZE" >/dev/null
  echo "==> restored: alembic ${alembic}; largest tables (estimated rows):"
  scratch_sql "
    SELECT format('    %-45s %s', schemaname || '.' || relname, n_live_tup)
    FROM pg_stat_user_tables
    WHERE schemaname IN ('source', 'gold')
    ORDER BY n_live_tup DESC
    LIMIT 10
  "
  docker rm -f "$container" >/dev/null
  echo "restore-postgres: restore-test ok (${DUMP})"
}

case "$RESTORE_TARGET" in
  scratch)
    if ! restore_test; then
      post_slack "nba postgres restore-test failed for ${DUMP}; the backup may not be restorable."
      exit 1
    fi
    ;;
  live)
    if [[ "${CONFIRM_RESTORE:-}" != "RESTORE" ]]; then
      echo "restore-postgres: RESTORE_TARGET=live replaces the running database." >&2
      echo "Re-run with CONFIRM_RESTORE=RESTORE to proceed." >&2
      exit 1
    fi
    restore_test
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
      echo "restore-postgres: ${LOCK_FILE} is held (refresh or admin job running); try again later." >&2
      exit 1
    fi
    echo "==> safety backup of the current database"
    BACKUP_DIR="$BACKUP_DIR/pre-restore" KEEP_DAILY=3 KEEP_WEEKLY=1 COMPOSE="$COMPOSE" \
      ./scripts/backup-postgres.sh
    echo "==> dropping and recreating the live database"
    $COMPOSE exec -T postgres sh -c \
      'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
    echo "==> pg_restore into the live database"
    $COMPOSE exec -T postgres sh -c \
      'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error --single-transaction' <"$DUMP"
    echo "restore-postgres: live restore ok from ${DUMP}"
    ;;
  *)
    echo "restore-postgres: RESTORE_TARGET must be 'scratch' or 'live', got '${RESTORE_TARGET}'" >&2
    exit 2
    ;;
esac
