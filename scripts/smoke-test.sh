#!/usr/bin/env bash
# smoke-test.sh — read-only checks against the public site after a deploy.
#
# prod-health already proves each container answers inside the compose network.
# This runs from outside (the CI runner), so it also covers what that cannot:
# DNS, the TLS certificate, Caddy's path routing, and that the commit we just
# shipped is the one actually being served.
#
#   PUBLIC_URL=https://baseline.jyablonski.dev EXPECTED_SHA=<sha> ./scripts/smoke-test.sh
#
# Checks, in order:
#   1. GET /                    -> 200 (frontend through Caddy + TLS)
#   2. GET /about               -> 200 containing "commit/<EXPECTED_SHA>" (only when EXPECTED_SHA is set)
#   3. GET /health              -> 200 containing "status":"ok" (API process up)
#   4. GET /api/v1/status       -> 200 containing "player_count" (API -> Postgres -> gold)
#   5. GET /api/v1/features     -> 200 (feature flags route)
#   6. GET /api/auth/providers  -> 200 (Caddy sends /api/auth/* to Next.js, not FastAPI)
#   7. GET /mcp                 -> 401 (MCP up behind Caddy and still demands its token)
#
# No credentials: every check hits a public route, or a gated one and asserts it
# stays closed. Exit 0 = all checks passed. Exit 1 = at least one failed.
set -euo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://baseline.jyablonski.dev}"
PUBLIC_URL="${PUBLIC_URL%/}"
EXPECTED_SHA="${EXPECTED_SHA:-}"
# Each check retries, so a container still warming behind Caddy is not a failure.
ATTEMPTS="${SMOKE_ATTEMPTS:-5}"
DELAY="${SMOKE_DELAY:-5}"

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
failures=0

# check <name> <path> <expected status> [<substring the body must contain>]
check() {
  local name="$1" path="$2" want_status="$3" want_body="${4:-}"
  local status=""
  for ((i = 1; i <= ATTEMPTS; i++)); do
    # No -f: a 401 is a pass for the gated routes. No -L either, so a redirect
    # (e.g. to sign-in) fails instead of passing as the page itself.
    status="$(curl -sS --max-time 10 -o "$body" -w '%{http_code}' "${PUBLIC_URL}${path}" || true)"
    if [[ "$status" == "$want_status" ]] && { [[ -z "$want_body" ]] || grep -qF -- "$want_body" "$body"; }; then
      echo "ok    ${name}"
      return 0
    fi
    ((i < ATTEMPTS)) && sleep "$DELAY"
  done
  echo "FAIL  ${name}: GET ${path} returned ${status:-no response}, wanted ${want_status}${want_body:+ with \"${want_body}\"}" >&2
  failures=$((failures + 1))
}

echo "smoke-test: ${PUBLIC_URL}"

check "frontend home" / 200
# The about page links the baked NEXT_PUBLIC_GIT_SHA; a stale container passes
# every other check, so this is the one that proves the new release is live.
if [[ -n "$EXPECTED_SHA" ]]; then
  check "deployed commit" /about 200 "commit/${EXPECTED_SHA}"
fi
check "api health" /health 200 '"status":"ok"'
# Goes through the API to Postgres and gold, unlike /health.
check "api status" /api/v1/status 200 '"player_count"'
check "api features" /api/v1/features 200
# Must reach Next.js, not FastAPI (the /api/auth/* block in the Caddyfile).
check "auth routing" /api/auth/providers 200
# 401 proves MCP is up behind Caddy and still demands its token; 502 means down.
check "mcp gated" /mcp 401

if ((failures > 0)); then
  echo "smoke-test: ${failures} check(s) failed" >&2
  exit 1
fi
echo "smoke-test: all checks passed"
