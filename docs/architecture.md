# Architecture

Who talks to whom. The root [README](../README.md) has the diagram.

The rule this doc exists to protect: **the browser never opens Postgres, scrape jobs never serve HTTP, and gold is the only product read path.**

## Services

`make up` (Tilt) starts **postgres**, **migrate** (one-shot), **cube**, **api**, **frontend**, and **mcp**.

| Profile | Services                                    | Runs                                                  |
| ------- | ------------------------------------------- | ----------------------------------------------------- |
| (none)  | postgres, migrate, cube, api, frontend, mcp | always on                                             |
| `tools` | scraper, dbt, ml                            | `compose run` only                                    |
| `cron`  | scrape-only container                       | prefer host cron — see [operations.md](operations.md) |

Production (`docker-compose.prod.yml`) adds Caddy and drops Tilt. Cube, MCP, the API, and the frontend stay internal to the Compose network. Only Caddy (80/443) and Postgres (`POSTGRES_PORT`, for database tools like DBeaver) publish a host port. MCP is served at `https://<host>/mcp` over the same certificate.

## Schemas and who writes them

`db/init.sql` creates `source`, `silver`, and `gold` empty. Nothing else bootstraps tables.

- **Alembic** (`services/migrate`) owns `source` DDL — `make db-migrate`
- **scraper** writes `source` only
- **ml** writes `source.game_predictions`, plus `source.model_artifacts` from `make ml-train` — see [ml.md](ml.md)
- **API** writes one table, `source.admin_jobs` (queued `/admin` jobs); the host runner updates it
- **dbt** owns `silver` and `gold`, reading `source`

Downstream never queries `source` for product data. The exceptions are operator-facing: `GET /api/v1/status` reads scrape watermarks, and `/api/v1/admin/*` reads pipeline runs and the job queue.

## Read paths

REST reads **gold** directly over SQL. Ask and MCP read gold **only through Cube**. The frontend calls neither Cube nor MCP.

A Cube outage takes out Ask and MCP alone — every page keeps working. There is deliberately no gold-SQL fallback.

## API layout (`services/api`)

FastAPI `/api/v1/*`, layered:

- `routers/` — HTTP · `repositories/` — sessions and row mapping · `queries/` — SQL constants
- `schemas/` — Pydantic responses · `cube/` — Cube client and named operations · `services/nlp/` — `/ask` backends

Routes cover players, teams, games, schedule (with champion win probability and consensus odds), predictions scorecard, standings, social, transactions, `GET /api/v1/status`, `POST /api/v1/query`, and `/api/v1/admin/*`. `GET /health` is liveness only — never surface it in the UI.

CORS allows `http://localhost:3000`; production is same-origin through Caddy.

## Frontend

`services/frontend` calls only `${NEXT_PUBLIC_API_URL}/api/v1/...`, which is a **build-time** ARG. Details in [frontend.md](frontend.md).

## Not built

A standalone per-game predictions API (win probability ships only as schedule columns), a transactions page, always-on scraper/dbt/ml on the VM.
