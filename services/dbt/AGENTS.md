# AGENTS — services/dbt

dbt project `nba_analytics` (profile `nba`): `source` → staging / intermediate in schema `silver`, marts in schema `gold`.

## SQL style (required)

- **Prefer CTEs over subqueries.** Use `with … as (…)` instead of derived tables in `from` / `join`, and instead of scalar `(select …)` in `select` / `where` when a CTE is clearer.
- **No short table aliases.** Reference full CTE or relation names (`players.player_id`, not `p.player_id`). Same table twice → two CTEs (e.g. `home_teams` / `away_teams`), not `as ht`.
- sqlfluff enforces the above where it can (see below); still follow the CTE / no-short-alias convention for cases rules miss (e.g. scalar subqueries).

## sqlfluff

- Config: **`services/dbt/pyproject.toml`** `[tool.sqlfluff.*]` only — do **not** add a `.sqlfluff` file. Keep `.sqlfluffignore`.
- Dialect `postgres`, templater `dbt` (needs reachable Postgres + `POSTGRES_*` env, same as dbt).
- Enabled tightenings:
  - `aliasing.forbid` (AL07) with `force_enable = true` — no table aliases
  - `aliasing.table` / `aliasing.column` — explicit `as` if an alias exists
  - `structure.subquery` (ST05) with `forbid_subquery_in = both` — no subqueries in `from` / `join` (use CTEs)
- Lint from this directory: `uv run sqlfluff lint models tests`

## Python / tooling

- Pin: **Python 3.13** (`requires-python = ">=3.13,<3.14"`)
- Quality: dbt SQL + YAML tests / singular tests — **no** pytest suite
- Local: `uv run dbt deps|build --profiles-dir .`
- Docker: `dbt deps` during image build; `dbt_packages` is copied into runtime so `--no-deps` compose runs do not need Hub access
- E2E: `make test-dbt` (repo root) → `docker-compose.e2e.yml` + `e2e/run.sh` (still runs `dbt deps` as a development-target fallback)

## Materialization policy

Defaults in `dbt_project.yml`: staging + intermediate → `view`, marts → `table`. Override per model when the default costs real time.

- **Keep the view** for thin projections (every `stg_*` model, `int_player_contracts_matched`, `int_player_injuries_matched`). A view over a pure column list is free — Postgres inlines it and scans the source once. Fan-out alone is not a reason to materialize: `stg_teams` has eight consumers and 30 rows.
- **Move to `table`** when a model does real work (window functions, joins, regex) **and** has more than one downstream consumer. A view recomputes that work once per consumer. `int_play_by_play_scoring` (4 window functions, read by `fct_play_by_play_scoring` and `fct_game_flow`) and `int_player_game_logs_enriched` (4 window functions, read by three marts) are the current cases.
- **Move to `incremental`** when a full rebuild is expensive relative to the daily delta. Only `int_play_by_play_events` qualifies today: ~30 regex operations per row across the whole play-by-play history, ~132s to rebuild for one evening's games. Watermark on `scraped_at` with `delete+insert` on `game_id`, so a re-scraped game replaces its rows wholesale.
- **Incremental models need `--full-refresh` when their logic changes.** `dbt build --select int_play_by_play_events+ --full-refresh`. Editing the regexes and running a plain `dbt build` silently leaves every previously-built row on the old logic. `make prod-dbt` and `scripts/oracle-reset-and-backfill.sh` already pass `--full-refresh` because both exist for exactly that case; the daily `scripts/refresh-daily.sh` deliberately does not.
- **Incremental models do not propagate deletes.** A row removed from `source` stays in the model until a `--full-refresh`. Relevant only for corrections and resets, not the daily append.
- **Do not add a mart that is a bare `select` of one intermediate.** `fct_play_by_play_events` was exactly that — same 632k-row grain as `fct_play_by_play`, no transformation, and no consumer in Cube, the API, MCP, or another model. Merge the columns into the existing mart instead. Check consumers before adding a mart at all.
- Beware CTE inlining when profiling: Postgres inlines a non-recursive CTE referenced once, so each outer reference to a derived column re-evaluates its expression. `with … as materialized (…)` forces a single evaluation.

## Schemas

- Sources: schema `source` (`_staging__sources.yml`). Alembic owns this DDL.
- Staging + intermediate: `+schema: silver`
- Marts: `+schema: gold`
- `macros/generate_schema_name.sql` uses the custom schema as-is (avoids `gold_gold` concatenation)

## Layout

- `models/staging`, `models/intermediate`, `models/marts`, each with matching `*.yml`
- Singular tests: `tests/`
- Do not commit unless asked; avoid churning `uv.lock` unless deps change
