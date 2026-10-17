---
name: full-stack-change
description: Checklist for a change that crosses Baseline's layers — a gold mart or new field surfaced through a FastAPI route and shown in the Next.js frontend. Covers API SQL style, route ordering, the shared integration seed, frontend types and client, e2e API mocks, tests to run, and the docs that must move with it. Use when adding or changing an /api/v1 route or response field together with the UI that reads it.
---

# Full-stack change (gold → API → frontend)

The layers are `gold` (dbt) → `services/api` (FastAPI, raw SQL) → `services/frontend` (Next.js, TanStack Query). Work down the stack in this order, and keep each step's tests green before the next. Read `AGENTS.md` and `services/frontend/AGENTS.md` first; this skill is the checklist, those are the rules.

## 1. Confirm the data exists

- Find the mart in `services/dbt/models/marts/` and read its `.yml` for column meaning and nullability. Do not invent columns.
- If the mart is a new source of truth for the UI, note where it is empty (for example `fct_game_upsets` before lines are captured). Every surface needs an honest empty state.
- Cube or MCP may already serve it (`services/cube/model/cubes/`, `lib/baseline-analytics`). That is a separate path; the frontend never calls Cube or MCP.

## 2. API (`services/api/src`)

Follow the layering every router uses: `queries/<area>.py` (SQL `text()`), `repositories/<area>.py` (execute, `dict(row._mapping)`), `schemas/<area>.py` (Pydantic, exported from `schemas/__init__.py`), `routers/<area>.py` (validate params, wrap in `PaginatedResponse` / `ItemResponse`).

SQL rules (from `AGENTS.md`, "SQL style (API)"):

- 4-space indent. A multi-field `SELECT` / `WHERE` / `ORDER BY` starts on its own line, one field per line.
- No table aliases in new SQL: `FROM gold.fct_game_upsets`, columns qualified as `fct_game_upsets.game_id`. Need a table twice? Use named CTEs. Some older files (e.g. `queries/transactions.py`) use aliases; match the file you are editing rather than half-converting it.
- Optional filters bind as `(CAST(:x AS text) IS NULL OR table.col = :x)`. A "newest season by default" filter uses a `latest_*` CTE plus `coalesce(CAST(:season AS text), latest.season)` (see `LIST_DAILY_HIGHLIGHTS`, `LIST_UPSETS`).
- Several unit tests assert on SQL substrings, so renaming an alias or column can break them.

Route ordering: fixed paths under `/api/v1/games` (`/collapses`, `/highlights`, `/upsets`) must be declared before `/{game_id}`, or they are parsed as a UUID and 422. Same for `/transactions/seasons` before `/{transaction_key}`. Update the comment above `/{game_id}` and the line in `AGENTS.md` that lists them.

A new field on an existing response: add it to the query, the schema (with a comment saying when it is null), and any shared SQL. `GET_GAME` reuses `SCHEDULE_COLUMNS`, so a schedule-row change shows up there too.

Tests:

- Unit (`tests/test_<area>.py`, `@pytest.mark.unit`): the `client` fixture uses a `ScriptedSession`. Queue `query_result([mapping_row({...})])` per `execute` call, then assert on the response and on `session.calls[-1]` params (what the router bound). Cover: the happy path, the empty list (never an error), bad enum params (400), and that a fixed path is not captured by `/{id}`.
- Integration (`@pytest.mark.integration`, Testcontainers): gold tables come from the shared `testing/analytics_integration.sql` (DDL) and `testing/analytics_integration_seed.sql` (rows). If the mart is not there, add its `CREATE TABLE` with the mart's real columns (Cube models may read them), add it to the seed's `TRUNCATE`, and seed a few rows that exercise the edge cases (include one that should be filtered out). Use the ids in `tests/ids.py`. Not every seeded game is in `fct_games_schedule`; check before asserting on `/games/{id}`.
- Test-specific rows inserted in a fixture must be deleted in its teardown: the engine is shared by the whole session and other modules count rows.

Run from `services/api`: `uv run pytest -q` (unit + integration + the Cube parity checks; needs Docker). Format and lint with the pinned ruff from the repo root: `uvx ruff@0.16.5 check --fix services/api` and `uvx ruff@0.16.5 format services/api`. Types: `uv run ty check`.

## 3. Frontend (`services/frontend/src`)

- Types: add or extend the type in `lib/types.ts`, with a doc comment on anything nullable and why.
- Client: add a method to `api` in `lib/api.ts` using `buildQuery({...})` and `asPaginated<T>` / `asData<T>`. Import the type at the top of the file.
- Calling it: the browser calls FastAPI directly for public `/api/v1/*` routes. Account routes go through a server action with the bearer token; never add Next route handlers under `/api/*` (Caddy sends those to FastAPI).
- Components: `useQuery` for one page of data, `useInfiniteQuery` for "Show more" offset paging (`components/transactions/transaction-list.tsx`). Loading, error, and empty states come from `components/query-state.tsx`. Tables use the `data-table` class.
- Pages: a `page.tsx` that reads search params (`useSeason`, `useSearchParams`) must wrap its body in `<Suspense>`. A page file may only export its default component and Next's config exports; put helpers and constants in `lib/`, not `export const` in the page.
- Copy: short and plain (the user prefers smart brevity). No operator jargon in empty states: say what is true about the data, never name a scraper, dbt, or a Make target. Null renders `—`.

Tests:

- Vitest (`tests/unit/`): each page test mocks `@/lib/api` with a hand-written `api` object. Add every new client method to every page test that renders a component calling it. A missing mock does not fail loudly: the query errors and the assertion may still pass. Assert the bound params (`toHaveBeenCalledWith`) and the empty state.
- Pure logic goes in `lib/` with its own test (e.g. `lib/team-form.ts` + `team-form.test.ts`). Date-dependent logic takes a `now` parameter; page tests that depend on the date pin it with `vi.useFakeTimers({ toFake: ["Date"] })`.
- Playwright (`tests/e2e/`): every API call goes through `mockApi` in `tests/e2e/helpers.ts`, matched by `url.includes(...)` in order. Add the new route's mock before any broader match that would swallow it (anything under `/games/` must come before the `singleGame` regex). Mock data is fixed in 2024-2026; anything that depends on today's date needs `page.clock.setFixedTime(...)`. Use `{ exact: true }` for short text that also appears inside longer strings.

Run from `services/frontend`: `npx tsc --noEmit -p .`, `npx eslint src tests`, `npx prettier --check src tests`, `npx vitest run --coverage` (coverage floor 90%), then `CI=1 npx playwright test` (the specs you touched, then the full suite).

## 4. Docs that move with it

- `AGENTS.md` "API surface": a new route or user-visible behaviour gets a line marked current, with its route ordering if it shares a prefix.
- `docs/data.md`: the mart's section says how it is served (REST, Cube, MCP) and what the UI shows.
- `docs/frontend.md`: the page's bullet under Pages; remove it from "Not built" if it was there.
- `docs/plans/<plan>.md`: update the `**Status:**` line with the date and the deviations from the plan, keeping the plan text as written.
- Markdown is never hard-wrapped.

## 5. Finish

- `pre-commit run --files $(git diff --name-only)` from the repo root (it runs ruff, ty, prettier, the frontend eslint and tsc, and dbt-score; not the tests).
- Report what changed per layer, what was tested and how, and anything not verified (for example "not checked in a browser").
- Never commit or push. Leave changes for the user to review.
