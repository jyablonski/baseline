# AGENTS

NBA analytics monorepo: scrape → Postgres → dbt → API / MCP / Cube → Next.js.

Prefer [docs/](docs/) and root [README.md](README.md) over inventing behavior.

## Read first

| Before changing                                      | Read                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Anything in `services/<name>/`                       | `services/<name>/AGENTS.md` when it exists (api, dbt, frontend)                                             |
| A user-facing feature, or any file under `services/` | Its doc in [docs/features/](docs/features/README.md). `python3 scripts/feature-docs.py for <path>` names it |
| A column, field, tool or page name, or product copy  | [docs/glossary.md](docs/glossary.md)                                                                        |
| Something that looks wrong but may be deliberate     | [docs/decisions/](docs/decisions/README.md)                                                                 |
| Deploys, cron, alerts, backups, the admin job runner | [docs/operations.md](docs/operations.md), [docs/deployment.md](docs/deployment.md)                          |
| Tests and CI                                         | [docs/testing.md](docs/testing.md)                                                                          |

## Rules

- **One season.** Only the current NBA season is loaded or supported: every `season` parameter defaults to it, no season pickers, multi-season views or cross-season fallbacks, and "career" / "history" mean the loaded season ([0001](docs/decisions/0001-single-season.md)).
- **Admin is not "signed in".** Sign-in (GitHub or Google) is open to anyone, so a session is not authority. The admin is whoever `isAdminUser` in `services/frontend/src/lib/admin-access.ts` accepts: a GitHub login in `ADMIN_GITHUB_LOGINS` or a verified Google address in `ADMIN_GOOGLE_EMAILS`. That check runs in the `authorized` callback (middleware), again in the admin page, and again in every admin server action. Never gate anything on "has a session".
- **No Next.js route handlers under `/api/*`.** Caddy sends everything there except `/api/auth/*` to FastAPI; use server actions. Account routes are called only from server actions with `ACCOUNTS_API_TOKEN` + `X-Baseline-User`, never by a browser.
- **Tools live in one place.** Named Cube tools are added or changed in `lib/baseline-analytics` (`tools.py`), never in `services/api` or `services/mcp`.
- **Docs move with the change.** If you change user-facing behaviour, update its feature doc in the same change; a new feature gets a doc. A deliberate choice that a future reader might "fix" gets a record in `docs/decisions/`. Plans are local, gitignored scratch, not documentation.
- **Respect recorded decisions** in [docs/decisions/](docs/decisions/README.md) (no pick bankroll, daily odds only, the live model set only from Admin, …). Supersede one with a new record rather than working around it.
- Do not commit unless the user asks
- Do not invent features; label planned vs current
- dbt owns SQL + YAML tests, not Python unit tests
- Scraper / dbt / ml → profile `tools`; MCP is on the default stack
- Markdown: never impose a line-length / wrap limit. Do not hard-wrap prose in `.md` files. Do not reflow paragraphs to 80 (or any) columns. Coding agents must not “fix” wrapping by adding mid-paragraph newlines.

## Service map

- `services/scraper` — Basketball-Reference only (no NBA Stats / `nba_api`; Baseline owns UUID identities and providers map onto them) → schema `source`, plus The Odds API, ESPN national TV and Reddit. Gating, schedules and alerts: [docs/operations.md](docs/operations.md)
- `services/migrate` — Alembic for source tables only (`make db-migrate`); shared by all services
- `services/dbt` — dbt `source` → `silver` (staging/intermediate) + `gold` (marts). Marts are described per feature in [docs/features/](docs/features/) and in [docs/data.md](docs/data.md). Agent notes: `services/dbt/AGENTS.md`
- `services/ml` — pregame win probability (Elo v0–v3, logit v1); Python 3.14, profile `tools`; reads gold, writes `source.game_predictions`. See [docs/features/predictions.md](docs/features/predictions.md) and [docs/ml.md](docs/ml.md)
- `services/api` — FastAPI `/api/v1/*` over `gold`. Agent notes and SQL style: `services/api/AGENTS.md`
- `lib/baseline-analytics` — shared Python package (`baseline_analytics`), not a service: the Cube client, the named operations (`CubeAnalytics`), and the one list of named tools (`tools.py`) that both the API's LLM adapter and the MCP server serve. Add or change a tool there, never in `services/api` or `services/mcp`. A uv path dependency of both (editable locally, built into the image)
- `services/frontend` — Next.js; `NEXT_PUBLIC_API_URL` → API. Agent notes: `services/frontend/AGENTS.md`
- `services/mcp` — FastMCP server over Cube: registers every tool in `baseline_analytics.tools` (named wrappers + `query_cube`; no gold SQL); stdio locally, Streamable HTTP in production behind Caddy at `https://<host>/mcp` with `MCP_API_TOKEN`. Not published to the host: a bearer token needs TLS
- `services/cube` — Cube YAML over gold; required for Ask/MCP (`make up` / Tilt locally). Also runs on the prod overlay, internal only (1 GB `mem_limit`, port 4000 not published)
- Schemas: `source` (ingest + pipeline gate), `silver` (dbt staging), `gold` (dims/facts)
- `source.users`, `source.chat_usage`, `source.picks`, `source.feature_flags` are written by the API, not scraped. They are never a dbt source or a Cube model. Picks join to gold for grading; nothing flows from them into `silver` or `gold`
- Init: `db/init.sql` creates those schemas empty; Alembic fills `source`

## Python / imports

- Pins: api, scraper, mcp, cube, migrate, ml, `lib/baseline-analytics` → 3.14
- Pins: dbt → 3.13
- Pytest: `pythonpath = ["src"]` (api and scraper add `"../.."` for the shared `testing` package; migrate has only `"../.."`)
- Use absolute imports rooted at each service's `src` directory (`from queries import …`), never relative imports
- Env: copy `.env.example` → `.env`
- Keep `DATABASE_URL` in sync
- Docker: target `runtime` (prod) or `development` (Tilt)
- The `api` and `mcp` images build from the repo root context (they copy `lib/baseline-analytics`); every other service builds from its own folder. The root `.dockerignore` applies only to those two. Keep Compose, `docker-bake.hcl` and the Tiltfile in step when changing either

## Commands

All workflows are Make targets: read the [Makefile](Makefile) rather than guessing. Every public target has a `## description` (`grep -E '^[a-z-]+:.*##' Makefile` lists them). Local stack is `make up` / `make down` (Tilt); `prod-*` targets use the Caddy overlay (`docker-compose.prod.yml`), not Tilt.

Gotchas the target names don't tell you:

- Never `compose down -v` in production; `prod-deploy` / `prod-release` never do.
- `make ml-train` / `ml-eval` / `ml-value` / `ml-snapshot` are manual only, never on the daily cron. `ml-value` is read-only: changing a threshold means editing the `value_*` vars in `dbt_project.yml`, which re-flags past games. `ml-snapshot` stores Elo ratings in `source.model_artifacts` so they survive deleting the seasons behind them (`docs/ml.md`).
- `make prod-record-deploy` writes `.env.deploy`, which every target `-include`s, so a bare `make prod-refresh` on cron gets the deployed sha. Precedence: command line > environment > `.env.deploy` > defaults. `prod-refresh` re-pulls the tool images first because `compose run` never pulls.
- `make prod-release IMAGE_TAG=<sha>` is the rollback path: no rebuild, no Alembic.
- `prod-release` ends by queueing a `dbt` admin job when `services/dbt` changed since the previously deployed tag (`scripts/queue-dbt-if-changed.sh`); the host runner does the rebuild, not the deploy.
- `db-restore` / `prod-db-restore` replace the live DB and need `CONFIRM_RESTORE=RESTORE`.
- Compose profile `tools` holds scraper/dbt/ml; MCP and Cube are on the default stack. No `platform: linux/amd64` pins; bases are multi-arch.

## Testing

- Python: pytest + coverage (fail under 90% for every service except migrate, which has no floor); mostly unit
- Types: `ty` per service (`[tool.ty.src] include = ["src"]` — shipped code only, not tests); runs as a pre-commit hook
- Prefer real DB integration (e.g. Testcontainers) when adding DB tests
- dbt: no Python unit tests
- `make test-dbt` runs Alembic then seeds via `docker-compose.e2e.yml` + `services/dbt/e2e/run.sh`
- Frontend: Vitest coverage; Playwright e2e separately
- GitHub Actions (`.github/workflows/ci.yml`) runs `make quality` (pre-commit), `make test-frontend`, `make test-frontend-e2e` (Playwright), `make test-dbt` (dbt e2e), `make test-lib|api|scraper|mcp|cube|ml|migrate` (unit and Testcontainers integration together; `test-lib` is `lib/baseline-analytics`; `test-api` includes the API-vs-Cube parity checks, which start a real Cube container, `make test-parity` to run them alone), and `make test-admin-jobs` (job runner e2e against a real Postgres in its own Compose project) on PR/`main`. Then `images` bakes the `prod` bake group for `linux/arm64` on `ubuntu-24.04-arm` and pushes `:<sha>` + `:latest` to GHCR, and `deploy` SSHs `make prod-deploy IMAGE_PREFIX=… IMAGE_TAG=<sha>`. Both run on push to `main` or `workflow_dispatch` only when `ENABLE_OCI_DEPLOY=true` (never on pull_request). Public host is `baseline.jyablonski.dev`.
