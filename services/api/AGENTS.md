# AGENTS — services/api

FastAPI `/api/v1/*` over `gold` (plus the API-owned `source` tables: users, chat usage, picks, feature flags, feedback, admin jobs). Every page in the frontend reads through it, so a broken query or a renamed field is a broken page.

What each route does is documented per feature in [docs/features/](../../docs/features/). This file is how the service is put together, how its SQL is written, and what to check before calling a change done.

## Layout

A request goes router → repository → query, and back through a schema:

- `src/routers/<area>.py` — HTTP only: params, validation, status codes, response models. Mounted in `src/main.py` under `/api/v1/<area>`. No SQL here.
- `src/repositories/<area>.py` — one class per area taking a `Session`, each method running a named statement and returning plain dicts. Built per request by a dependency in `src/dependencies.py` (`get_teams_repository` for teams, and so on).
- `src/queries/<area>.py` — module-level `text()` statements, `UPPER_SNAKE` names, raw SQL against `gold` / `source`.
- `src/schemas/` — Pydantic response models. Lists use `PaginatedResponse[T]` (`data` + `meta.total/limit/offset`), single objects `ItemResponse[T]`.
- `src/services/` — logic that is not a query: the Ask rules engine (`src/services/nl_query.py`), the opt-in LLM adapter (`src/services/nlp/`), chat (`src/services/chat.py`). These go through Cube via `baseline_analytics`, never gold SQL.
- Named Cube tools live in `lib/baseline-analytics` (`lib/baseline-analytics/src/baseline_analytics/tools.py`), shared with MCP. Add or change a tool there, not here.

Imports are absolute from `src` (`from queries.teams import LIST_TEAMS`), never relative.

## Gotchas

- **Repositories map columns by hand.** A new `SELECT` column reaches the response only once the repository's dict and the schema both carry it. The unit tests mock the repository, so a missing mapping passes them; the Testcontainers integration test is what catches it. Add the field in all three: query, repository dict, schema.
- **Route order matters.** Static paths are declared before `/{id}` in the same router (`/games/upsets`, `/games/dates`, … before `/games/{game_id}`), or the static segment is parsed as an id. Keep new static routes above the parameterised one.
- **One season.** `season` params default to the newest season present and the SQL filters to it once. No cross-season fallbacks ([0001](../../docs/decisions/0001-single-season.md)).
- **Gates fail closed.** `require_admin_token`, `require_accounts_token` and `require_flag` return 503 when the secret or flag is missing, never open. New admin or account routes take the same dependency; never gate on "has a session".
- **No Next.js routes under `/api/*`.** Caddy sends all of `/api/*` except `/api/auth/*` here.
- **SQL substrings are asserted in tests.** Several unit tests check fragments of the query text, so renaming a CTE or column can fail them without changing behaviour. Update the assertion with the rename.
- **Early development.** Rename or drop response fields outright; no aliases or deprecation shims. The frontend types in `services/frontend/src/lib/types.ts` and its e2e mocks (`services/frontend/tests/e2e/helpers.ts`) move in the same change.

## SQL style

`services/api/src/queries/*.py` holds raw SQL against `gold` / `source`. The dbt rules in `services/dbt/AGENTS.md` apply here too, plus:

- Indent in 4 spaces. No tabs, no 2-space SQL.
- A clause with more than one field starts on its own line, one field per line. That covers `SELECT`, `WHERE`, and `ORDER BY`. A single-field clause may stay inline (`WHERE id = 1`, `SELECT season`). A comma inside a function call does not make a clause multi-field.

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

- No table aliases. Write `FROM gold.dim_teams` and qualify columns as `dim_teams.team_id`, never `FROM gold.dim_teams t` / `t.team_id`. Needing the same table twice is not a reason to alias: give each copy a named CTE (`home_teams`, `away_teams`), the way the dbt models already do.
- The only names that survive are ones SQL requires: CTE names, derived-table names on a subquery, and the name a correlated `LATERAL` needs to distinguish itself from the outer row. Name those for their role (`post_comments`, `window_comments`), not with an initial.
- Aliases in this codebase are load-bearing in tests: several assert on SQL substrings, so renaming one means updating those assertions. Run `uv run pytest -m integration` from `services/api` after any change here — the unit tests use a scripted session and will not catch a broken query, but the Testcontainers integration tests execute the real SQL.

## Tests

- `uv run pytest` (or `make test-api`) — unit and integration together, 90% coverage floor. Integration suites skip without Docker.
- `uv run pytest -m integration` — run after **any** change under `src/queries/` or `src/repositories/`. Unit tests use a scripted session and never execute SQL; these run it against Testcontainers Postgres with Alembic's `source` schema plus the shared gold schema and seed in `testing/analytics_integration*.sql`. A new gold column or table goes into that schema file, and into the seed if a test reads it.
- `make test-parity` — the API-vs-Cube parity checks (a real Cube container). Run when a query that Cube also answers changes.
- `uv run ty check` — shipped code only (`[tool.ty.src]`); also a pre-commit hook.

A change that adds a route or field together with the UI reading it follows the `full-stack-change` skill (`.claude/skills/full-stack-change`).
