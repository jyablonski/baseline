#!/usr/bin/env bash
# ty type-check, one invocation per Python project (each service, plus lib/).
#
# Per service, not repo-wide: each has its own venv and its own src on the module
# path, so a single invocation would resolve third-party imports against the
# wrong environment. Shipped source only ([tool.ty.src] in each pyproject);
# tests pass duck-typed doubles where a concrete class is annotated.
#
# `uv run` provisions a missing venv, which is what CI needs on a fresh runner.
# Editors and GUI git clients commonly run hooks with a minimal PATH that lacks
# uv, so look in the usual install locations, then fall back to a venv that has
# already been built.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PROJECTS=(
  lib/baseline-analytics
  services/api
  services/scraper
  services/mcp
  services/cube
  services/ml
  services/migrate
)

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

status=0
for project in "${PROJECTS[@]}"; do
  echo "-- ty $project"
  if [[ -n "$UV" ]]; then
    "$UV" run --directory "$project" ty check || status=1
  elif [[ -x "$project/.venv/bin/ty" ]]; then
    (cd "$project" && ./.venv/bin/ty check) || status=1
  else
    echo "ty: uv is not on PATH and $project/.venv is missing." >&2
    echo "    Install uv, or run 'make sync' to build the service venvs." >&2
    status=1
  fi
done

exit "$status"
