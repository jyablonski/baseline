#!/usr/bin/env bash
# backup-postgres.sh — pg_dump the whole warehouse to a local directory.
#
# Local only, on purpose: no object storage. This protects against the failures
# that actually happen on a single box (a stray `compose down -v`, a bad
# migration, a reset script run against the wrong host), not against losing the
# VM itself. Copy $BACKUP_DIR off the box yourself if you need that.
#
# The dump is custom format (-Fc): compressed, and restorable per table with
# pg_restore. It streams out of the postgres container over `compose exec`, so
# the host needs no Postgres client. A dump is only kept once `pg_restore --list`
# can read it back, and old dumps are only rotated after that check passes, so a
# broken run can never delete the last good backup.
#
#   make db-backup             # local stack
#   make prod-db-backup        # production overlay
#
# Cron, before the 08:15 refresh (see docs/operations.md):
#
#   30 7 * * * cd /opt/nba && make prod-db-backup >> /opt/nba/logs/backup.log 2>&1
#
# It deliberately does NOT take the refresh lock. The refresh cron uses
# `flock -n`, so a backup holding that lock at 08:15 would silently skip the
# day's refresh. pg_dump reads one MVCC snapshot, so a dump taken beside a
# refresh is still consistent; the schedule only keeps them apart for memory.
#
# Layout: $BACKUP_DIR/daily/nba-<UTC timestamp>.dump, plus a hardlink in
# $BACKUP_DIR/weekly/ for the first dump of each ISO week (no extra disk).
# Exit 0 = new verified dump written. Non-zero = no new dump; Slack alert posted.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-nba}"
COMPOSE="${COMPOSE:-docker compose}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/nba-backup.lock}"

for knob in KEEP_DAILY KEEP_WEEKLY; do
  if ! [[ "${!knob}" =~ ^[1-9][0-9]*$ ]]; then
    echo "backup-postgres: ${knob} must be a positive whole number, got '${!knob}'" >&2
    exit 2
  fi
done

# Same host-side .env read as check-freshness.sh.
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
    "$SLACK_WEBHOOK_URL" >/dev/null || echo "backup-postgres: Slack POST failed" >&2
}

fail() {
  local message="nba postgres backup failed: $1"
  echo "$message" >&2
  post_slack "$message"
  exit 1
}

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "backup-postgres: another backup holds ${LOCK_FILE}; skipping." >&2
  exit 0
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" || fail "cannot create ${BACKUP_DIR}"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/daily/nba-${stamp}.dump"
# Dot-prefixed so rotation (which globs nba-*.dump) can never count or delete it.
tmp="$BACKUP_DIR/daily/.nba-${stamp}.dump.tmp"
trap 'rm -f "$tmp"' EXIT

echo "==> pg_dump -> ${final}"
if ! $COMPOSE exec -T postgres \
  sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >"$tmp"; then
  fail "pg_dump exited non-zero in compose project ${COMPOSE_PROJECT_NAME} (is postgres running?)"
fi

# An empty or truncated archive is the failure worth catching: pg_dump can die
# mid-stream (OOM, disk full) after writing a valid header.
if ! toc="$($COMPOSE exec -T postgres pg_restore --list <"$tmp" 2>&1)"; then
  fail "pg_restore --list could not read the new dump: ${toc}"
fi
if ! grep -q 'SCHEMA - source' <<<"$toc"; then
  fail "new dump has no source schema; refusing to keep it"
fi
table_count="$(grep -c ' TABLE DATA ' <<<"$toc" || true)"

mv "$tmp" "$final"
size="$(du -h "$final" | cut -f1)"
echo "==> verified: ${table_count} tables, ${size}"

week="$(date -u +%G-W%V)"
if ! compgen -G "$BACKUP_DIR/weekly/nba-${week}-*.dump" >/dev/null; then
  ln "$final" "$BACKUP_DIR/weekly/nba-${week}-${stamp}.dump"
  echo "==> weekly copy for ${week}"
fi

# Newest first by name (timestamps sort lexically); drop everything past KEEP.
rotate() {
  local dir="$1" keep="$2" old
  while IFS= read -r old; do
    echo "==> rotate out ${old}"
    rm -f -- "$old"
  done < <(find "$dir" -maxdepth 1 -name 'nba-*.dump' -printf '%f\n' | sort -r | tail -n +"$((keep + 1))" | sed "s|^|$dir/|")
}
rotate "$BACKUP_DIR/daily" "$KEEP_DAILY"
rotate "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"

echo "backup-postgres: ok (${final})"
