#!/usr/bin/env bash
# test-backups.sh — end-to-end checks for backup-postgres.sh and restore-postgres.sh.
#
# Runs against a real Postgres in its OWN compose project (never `nba`), so it
# cannot read or wipe the local warehouse, and tears that project down on exit.
#
#   make test-backups
#
# Needs Docker and the repo's .env (compose reads POSTGRES_* from it).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="nba-backup-test"
# Off the default port so it can run beside `make up`.
export POSTGRES_PORT="${TEST_POSTGRES_PORT:-55433}"
COMPOSE="${COMPOSE:-docker compose}"
export COMPOSE
WORK="$(mktemp -d)"
export BACKUP_DIR="$WORK/backups"
export BACKUP_LOCK_FILE="$WORK/backup.lock"
export LOCK_FILE="$WORK/refresh.lock"
# Never post test failures to the real channel.
export SLACK_WEBHOOK_URL=""

PASS=0
FAIL=0

cleanup() {
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

psql_query() {
  $COMPOSE exec -T postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$0"' "$1"
}

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

count_dumps() { find "$1" -maxdepth 1 -name 'nba-*.dump' 2>/dev/null | wc -l; }

echo "==> start throwaway postgres (project ${COMPOSE_PROJECT_NAME})"
$COMPOSE up -d --wait postgres >/dev/null 2>&1
# The healthcheck can pass on the image's init-time server, before init.sql has
# created the schemas; that server does not listen on TCP, so wait for TCP.
for _ in $(seq 1 60); do
  $COMPOSE exec -T postgres sh -c 'psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1"' >/dev/null 2>&1 && break
  sleep 1
done

# Stand-in for Alembic + a scrape: init.sql already made the three schemas.
psql_query "
  CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);
  INSERT INTO alembic_version VALUES ('test_head');
  CREATE TABLE source.backup_probe (id int PRIMARY KEY);
  INSERT INTO source.backup_probe SELECT generate_series(1, 500);
" >/dev/null

echo "==> backup writes one verified dump and a weekly link"
./scripts/backup-postgres.sh >/dev/null
assert_eq "daily dumps" 1 "$(count_dumps "$BACKUP_DIR/daily")"
assert_eq "weekly dumps" 1 "$(count_dumps "$BACKUP_DIR/weekly")"
assert_eq "no temp files left" 0 "$(find "$BACKUP_DIR" -name '*.tmp' | wc -l)"

echo "==> second backup in the same week adds no weekly copy"
sleep 1
./scripts/backup-postgres.sh >/dev/null
assert_eq "daily dumps" 2 "$(count_dumps "$BACKUP_DIR/daily")"
assert_eq "weekly dumps" 1 "$(count_dumps "$BACKUP_DIR/weekly")"

echo "==> rotation keeps the newest KEEP_DAILY"
for day in 01 02 03; do
  cp "$(find "$BACKUP_DIR/daily" -name 'nba-*.dump' | head -n1)" "$BACKUP_DIR/daily/nba-202001${day}T000000Z.dump"
done
KEEP_DAILY=2 ./scripts/backup-postgres.sh >/dev/null
assert_eq "daily dumps after rotation" 2 "$(count_dumps "$BACKUP_DIR/daily")"
assert_eq "old fixtures rotated out" 0 "$(find "$BACKUP_DIR/daily" -name 'nba-2020*' | wc -l)"

echo "==> restore-test restores the newest dump into a scratch container"
out="$(./scripts/restore-postgres.sh 2>&1)" && status=0 || status=$?
assert_eq "restore-test exit" 0 "$status"
assert_eq "probe table restored" 1 "$(grep -c 'source.backup_probe' <<<"$out")"

echo "==> restore-test rejects a truncated dump"
newest="$(find "$BACKUP_DIR/daily" -name 'nba-*.dump' | sort -r | head -n1)"
head -c 200 "$newest" >"$WORK/truncated.dump"
./scripts/restore-postgres.sh "$WORK/truncated.dump" >/dev/null 2>&1 && status=0 || status=$?
assert_eq "truncated dump fails" 1 "$status"

echo "==> live restore refuses without CONFIRM_RESTORE"
RESTORE_TARGET=live ./scripts/restore-postgres.sh >/dev/null 2>&1 && status=0 || status=$?
assert_eq "unconfirmed live restore fails" 1 "$status"

echo "==> live restore brings back dropped data"
psql_query "DELETE FROM source.backup_probe" >/dev/null
RESTORE_TARGET=live CONFIRM_RESTORE=RESTORE ./scripts/restore-postgres.sh >/dev/null
assert_eq "rows restored" 500 "$(psql_query 'SELECT count(*) FROM source.backup_probe')"
assert_eq "pre-restore safety dump" 1 "$(count_dumps "$BACKUP_DIR/pre-restore/daily")"

echo "==> backup fails loudly and keeps nothing when postgres is gone"
before="$(count_dumps "$BACKUP_DIR/daily")"
$COMPOSE stop postgres >/dev/null 2>&1
./scripts/backup-postgres.sh >/dev/null 2>&1 && status=0 || status=$?
assert_eq "backup exit" 1 "$status"
assert_eq "no new dump" "$before" "$(count_dumps "$BACKUP_DIR/daily")"
assert_eq "no temp files left" 0 "$(find "$BACKUP_DIR" -name '*.tmp' | wc -l)"

echo
echo "test-backups: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
