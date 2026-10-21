# shellcheck shell=bash
# psql.sh — sourced, not run. One SQL statement against the Compose postgres,
# unaligned and tuples-only so callers can read the result straight into a
# variable. Needs COMPOSE (and COMPOSE_PROJECT_NAME) set by the caller.
#
# The statement goes in as $0 of the inner shell so it reaches psql verbatim;
# the single quotes are deliberate.
# shellcheck disable=SC2016
psql_query() {
  $COMPOSE exec -T postgres \
    sh -c 'psql -X -A -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$0"' "$1"
}
