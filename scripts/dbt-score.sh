#!/usr/bin/env bash
# dbt-score over the dbt project's manifest. Shared by `make dbt-score`, the
# pre-commit hook, and CI. Thresholds and custom rules live in
# services/dbt/pyproject.toml [tool.dbt-score] and services/dbt/dbt_score_rules/.
#
# `dbt parse` renders profiles.yml but never connects, so placeholder
# credentials are enough and no Postgres is needed. dbt deps hits dbt Hub, so it
# only runs when dbt_packages is missing (fresh clone or CI runner).
# uv lookup mirrors scripts/ty-check.sh: GUI git clients run hooks with a
# minimal PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/services/dbt"

UV="${UV:-$(command -v uv || true)}"
if [[ -z "$UV" ]]; then
  for candidate in \
    "$HOME/.local/bin/uv" \
    "$HOME/.cargo/bin/uv" \
    /usr/local/bin/uv \
    /opt/homebrew/bin/uv
  do
    if [[ -x "$candidate" ]]; then
      UV="$candidate"
      break
    fi
  done
fi
if [[ -z "$UV" ]]; then
  echo "dbt-score: uv is not on PATH. Install uv, or run 'make sync'." >&2
  exit 1
fi

export POSTGRES_USER="${POSTGRES_USER:-parse}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-parse}"
export POSTGRES_DB="${POSTGRES_DB:-parse}"

if [[ ! -d dbt_packages/dbt_expectations ]]; then
  "$UV" run dbt deps --profiles-dir .
fi
"$UV" run dbt parse --profiles-dir . --quiet
"$UV" run dbt-score lint --manifest target/manifest.json
