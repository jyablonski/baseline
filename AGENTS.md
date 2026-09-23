# AGENTS

NBA analytics monorepo: scrape → Postgres → dbt → API / MCP / Cube → Next.js.

Prefer [docs/](docs/) and root [README.md](README.md) over inventing behavior.

## Service map

- `services/scraper` — Basketball-Reference (teams, players, schedule, game logs, standings, play-by-play, contracts, transactions, current injuries) → schema `source`. No NBA Stats / `nba_api`; Baseline owns UUID identities and providers map onto them. Optional `SLACK_WEBHOOK_URL`: one Incoming Webhook per failed sync (`pipeline` / `scrape-daily` / `scrape-all`), not per step; unset/empty skips HTTP. `refresh-daily.sh` also posts once for a failed dbt or ml stage (`pipeline mark-dbt|mark-ml --notify`, recorded in `pipeline_runs.dbt_exit` / `ml_exit`). A source that failed or returned zero rows `SOURCE_ALERT_STREAK` (default 3) runs in a row posts a degraded alert; skipped runs don't count. Optional `ODDS_API_KEY`: The Odds API upcoming slate (`scrape-odds` / daily); unset/empty skips odds HTTP. Optional `REDDIT_*`: everyday r/nba posts and top comments whenever the pipeline is enabled (not behind `season_active`); unset/empty skips reddit HTTP. Season-active daily: slate, Finals logs, those games’ PBP, standings, injuries, odds-if-keyed. Contracts, transactions, and Reddit run whenever the pipeline is enabled (not season-gated). `scrape-all` with no `--seasons` is the current season only; pass `--seasons` for a later backfill
- `services/migrate` — Alembic for **source** tables only (`make db-migrate`); shared by all services
- `services/dbt` — dbt `source` → `silver` (staging/intermediate) + `gold` (marts). `fct_game_upsets` ranks moneyline upsets from retained pregame odds (empty until 2026-27 Finals with captured lines); Cube `game_upsets`, MCP `get_biggest_upsets`
- `services/ml` — pregame WP job: Elo v0 (champion) + Elo v1 (shadow) + logit v1 (shadow, only once `make ml-train` has stored an artifact); `make ml-backfill` grades past Finals for all three; Python **3.14**, profile `tools`; reads gold Regular Season Finals + schedule, writes `source.game_predictions`
- `services/api` — FastAPI `/api/v1/*` over `gold`
- `services/frontend` — Next.js; `NEXT_PUBLIC_API_URL` → API
- `services/mcp` — FastMCP tools over Cube (named wrappers + `query_cube`; no gold SQL); stdio locally, Streamable HTTP in production behind Caddy at `https://<host>/mcp` with `MCP_API_TOKEN`. Not published to the host: a bearer token needs TLS
- `services/cube` — Cube YAML over gold; **required** for Ask/MCP (`make up` / Tilt locally). Also runs on the prod overlay, internal only (1 GB `mem_limit`, port 4000 not published)
- Schemas: `source` (ingest + pipeline gate), `silver` (dbt staging), `gold` (dims/facts)
- Init: `db/init.sql` creates those schemas empty; Alembic fills `source`

## Python / imports

- Pins: api, scraper, mcp, cube, migrate, ml → **3.14**
- Pins: dbt → **3.13**
- Pytest: `pythonpath = ["src"]` (api and scraper add `"../.."` for the shared `testing` package; migrate has only `"../.."`)
- Use absolute imports rooted at each service's `src` directory (`from queries import …`), never relative imports
- Env: copy `.env.example` → `.env`
- Keep `DATABASE_URL` in sync
- Docker: target `runtime` (prod) or `development` (Tilt)

## Commands

All workflows are Make targets: read the [Makefile](Makefile) rather than guessing. Every public target has a `## description` (`grep -E '^[a-z-]+:.*##' Makefile` lists them). Local stack is `make up` / `make down` (Tilt); `prod-*` targets use the Caddy overlay (`docker-compose.prod.yml`), not Tilt.

Gotchas the target names don't tell you:

- Never `compose down -v` in production; `prod-deploy` / `prod-release` never do.
- `make ml-train` / `ml-eval` are manual only, never on the daily cron.
- `make prod-record-deploy` writes `.env.deploy`, which every target `-include`s, so a bare `make prod-refresh` on cron gets the deployed sha. Precedence: command line > environment > `.env.deploy` > defaults. `prod-refresh` re-pulls the tool images first because `compose run` never pulls.
- `make prod-release IMAGE_TAG=<sha>` is the rollback path: no rebuild, no Alembic.
- `db-restore` / `prod-db-restore` replace the live DB and need `CONFIRM_RESTORE=RESTORE`.
- Compose profile `tools` holds scraper/dbt/ml; MCP and Cube are on the default stack. No `platform: linux/amd64` pins; bases are multi-arch.

## Testing

- Python: pytest + coverage (fail under 90% for every service except migrate, which has no floor); mostly unit
- Types: `ty` per service (`[tool.ty.src] include = ["src"]` — shipped code only, not tests); runs as a pre-commit hook
- Prefer real DB integration (e.g. Testcontainers) when adding DB tests
- dbt: no Python unit tests
- `make test-dbt` runs Alembic then seeds via `docker-compose.e2e.yml` + `services/dbt/e2e/run.sh`
- Frontend: Vitest coverage; Playwright e2e separately
- GitHub Actions (`.github/workflows/ci.yml`) runs `make quality` (pre-commit), `make test-frontend`, `make test-frontend-e2e` (Playwright), `make test-dbt` (dbt e2e), `make test-api|scraper|mcp|cube|ml|migrate` (unit and Testcontainers integration together), and `make test-admin-jobs` (job runner e2e against a real Postgres in its own Compose project) on PR/`main`. Then `images` bakes the `prod` bake group for `linux/arm64` on `ubuntu-24.04-arm` and pushes `:<sha>` + `:latest` to GHCR, and `deploy` SSHs `make prod-deploy IMAGE_PREFIX=… IMAGE_TAG=<sha>`. Both run on push to `main` or `workflow_dispatch` only when `ENABLE_OCI_DEPLOY=true` (never on pull_request). Public host is `baseline.jyablonski.dev`.

## API surface

- `/admin` (frontend) and `/api/v1/admin/*` are **current**: ingestion / dbt / ML health, plus `POST /admin/jobs` which **queues** work into `source.admin_jobs` for the host runner (the API never executes it). One pending job at a time, enforced by a partial unique index (409 otherwise). The page is behind GitHub OAuth with an `ADMIN_GITHUB_LOGINS` allowlist; the API needs `Authorization: Bearer $ADMIN_API_TOKEN`. Both fail closed — unset secrets disable them (API returns 503), never open them. The token is server-side only, never `NEXT_PUBLIC_`.
- `make prod-scrape` / `prod-ml` / `prod-admin-jobs` — production one-shots; `prod-admin-jobs` drains `source.admin_jobs` (cron every minute). Runs on the host, never in a container: executing `make` needs the Docker socket, which the API must not have.
- `GET /api/v1/status` is **current**: `last_scraped_at` from `source.scrape_pipeline.last_success_at` plus warehouse coverage counts. Do not surface `GET /health` in the UI.
- `GET /api/v1/schedule` carries the champion pregame WP plus a consensus moneyline and spread; `GET /api/v1/predictions/scorecard` serves `gold.fct_prediction_scorecard`. Both read gold only; the frontend shows them on `/schedule` and `/predictions` (not in the nav).
- `POST /api/v1/query` and `/ask` are **current**. Default backend is **rules** (`NLP_BACKEND=rules`): B2B, season averages, player compare, team head-to-head, blown leads, arena-city record, salary/payroll, standings — each family is a Cube query. Unrecognized questions return a capability message, not HTTP 501. `NLP_BACKEND=llm` is an opt-in adapter (Cube meta + `query_cube` / named Cube tools, needs `NLP_LLM_API_KEY`); it is not the public default and does not run SQL. MCP `query_cube` is Cube query JSON only. Cube down → clear Ask/MCP error; no gold SQL fallback. The prod overlay starts Cube internally for Ask/MCP and does not publish port 4000.

## SQL style (API)

`services/api/src/queries/*.py` holds raw SQL against `gold` / `source`. The dbt rules in `services/dbt/AGENTS.md` apply here too, plus:

- **Indent in 4 spaces.** No tabs, no 2-space SQL.
- **A clause with more than one field starts on its own line, one field per line.** That covers `SELECT`, `WHERE`, and `ORDER BY`. A single-field clause may stay inline (`WHERE id = 1`, `SELECT season`). A comma inside a function call does not make a clause multi-field.

```sql
SELECT
    dim_teams.team_id,
    dim_teams.team_name
FROM gold.dim_teams
WHERE
    dim_teams.conference = :conference
    AND dim_teams.division = :division
ORDER BY
    dim_teams.conference,
    dim_teams.team_name
```

- **No table aliases.** Write `FROM gold.dim_teams` and qualify columns as `dim_teams.team_id`, never `FROM gold.dim_teams t` / `t.team_id`. Needing the same table twice is not a reason to alias: give each copy a named CTE (`home_teams`, `away_teams`), the way the dbt models already do.
- The only names that survive are ones SQL requires: CTE names, derived-table names on a subquery, and the name a correlated `LATERAL` needs to distinguish itself from the outer row. Name those for their role (`post_comments`, `window_comments`), not with an initial.
- Aliases in this codebase are load-bearing in tests: several assert on SQL substrings, so renaming one means updating those assertions. Run `uv run pytest -m integration` from `services/api` after any change here — the unit tests use a scripted session and will not catch a broken query, but the Testcontainers integration tests execute the real SQL.

## Conventions

- Do not commit unless the user asks
- Do not invent features; label planned vs current
- dbt owns SQL + YAML tests, not Python unit tests
- Scraper / dbt / ml → profile `tools`; MCP is on the default stack
- Frontend agent notes: `services/frontend/AGENTS.md`
- dbt agent notes: `services/dbt/AGENTS.md`
- Markdown: never impose a line-length / wrap limit. Do not hard-wrap prose in `.md` files. Do not reflow paragraphs to 80 (or any) columns. Coding agents must not “fix” wrapping by adding mid-paragraph newlines.
