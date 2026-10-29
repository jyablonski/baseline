# AGENTS — services/api

FastAPI `/api/v1/*` over `gold` (plus the API-owned `source` tables: users, chat usage, picks, feature flags, admin jobs). Every page in the frontend reads through it, so a broken query or a renamed field is a broken page.

The root [AGENTS.md](../../AGENTS.md) owns what the API surface is ("API surface") and how SQL is written ("SQL style (API)"). This file is how the service is put together and what to check before calling a change done.

## Layout

A request goes router → repository → query, and back through a schema:

- `src/routers/<area>.py` — HTTP only: params, validation, status codes, response models. Mounted in `src/main.py` under `/api/v1/<area>`. No SQL here.
- `src/repositories/<area>.py` — one class per area taking a `Session`, each method running a named statement and returning plain dicts. Built per request by `get_<area>_repository` in `src/dependencies.py`.
- `src/queries/<area>.py` — module-level `text()` statements, `UPPER_SNAKE` names, raw SQL against `gold` / `source`.
- `src/schemas/` — Pydantic response models. Lists use `PaginatedResponse[T]` (`data` + `meta.total/limit/offset`), single objects `ItemResponse[T]`.
- `src/services/` — logic that is not a query: the Ask rules engine (`nl_query.py`), the opt-in LLM adapter (`nlp/`), chat (`chat.py`). These go through Cube via `baseline_analytics`, never gold SQL.
- Named Cube tools live in `lib/baseline-analytics` (`tools.py`), shared with MCP. Add or change a tool there, not here.

Imports are absolute from `src` (`from queries.teams import LIST_TEAMS`), never relative.

## Gotchas

- **Repositories map columns by hand.** A new `SELECT` column reaches the response only once the repository's dict and the schema both carry it. The unit tests mock the repository, so a missing mapping passes them; the Testcontainers integration test is what catches it. Add the field in all three: query, repository dict, schema.
- **Route order matters.** Static paths are declared before `/{id}` in the same router (`/games/upsets`, `/games/dates`, … before `/games/{game_id}`), or the static segment is parsed as an id. Keep new static routes above the parameterised one.
- **One season.** `season` params default to the newest season present and the SQL filters to it once. No cross-season fallbacks (root "Season scope").
- **Gates fail closed.** `require_admin_token`, `require_accounts_token` and `require_flag` return 503 when the secret or flag is missing, never open. New admin or account routes take the same dependency; never gate on "has a session".
- **No Next.js routes under `/api/*`.** Caddy sends all of `/api/*` except `/api/auth/*` here.
- **SQL substrings are asserted in tests.** Several unit tests check fragments of the query text, so renaming a CTE or column can fail them without changing behaviour. Update the assertion with the rename.
- **Early development.** Rename or drop response fields outright; no aliases or deprecation shims. The frontend types in `services/frontend/src/lib/types.ts` and its e2e mocks (`tests/e2e/helpers.ts`) move in the same change.

## Tests

- `uv run pytest` (or `make test-api`) — unit and integration together, 90% coverage floor. Integration suites skip without Docker.
- `uv run pytest -m integration` — run after **any** change under `src/queries/` or `src/repositories/`. Unit tests use a scripted session and never execute SQL; these run it against Testcontainers Postgres with Alembic's `source` schema plus the shared gold schema and seed in `testing/analytics_integration*.sql`. A new gold column or table goes into that schema file, and into the seed if a test reads it.
- `make test-parity` — the API-vs-Cube parity checks (a real Cube container). Run when a query that Cube also answers changes.
- `uv run ty check` — shipped code only (`[tool.ty.src]`); also a pre-commit hook.

A change that adds a route or field together with the UI reading it follows the `full-stack-change` skill (`.claude/skills/full-stack-change`).
