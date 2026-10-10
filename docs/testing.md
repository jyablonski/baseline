# Testing

Every suite runs from the repo root through `make`. `make test` runs all of them; the targets below run one at a time.

| Target                   | Covers                                       | Needs Docker                 |
| ------------------------ | -------------------------------------------- | ---------------------------- |
| `make test-lib`          | Shared Cube client, operations, named tools  | no                           |
| `make test-api`          | FastAPI routers, repositories, services      | for `integration` tests only |
| `make test-parity`       | Only the API-vs-Cube parity checks           | yes                          |
| `make test-scraper`      | Basketball-Reference / odds / Reddit parsers | for `integration` tests only |
| `make test-migrate`      | Alembic revision chain, `upgrade head`       | for `integration` tests only |
| `make test-mcp`          | FastMCP server wiring over the shared tools  | no                           |
| `make test-cube`         | Cube schema definitions                      | no                           |
| `make test-ml`           | Elo and logit scoring                        | no                           |
| `make test-frontend`     | Next.js components and lib (Vitest)          | no                           |
| `make test-frontend-e2e` | Browser journeys (Playwright)                | no                           |
| `make test-dbt`          | silver/gold models end to end                | yes                          |
| `make test-admin-jobs`   | `/admin` job runner against a live Postgres  | yes                          |

## Python service suites

Each service owns its pytest config in `services/<name>/pyproject.toml` and runs from its own directory via `uv run pytest`. `lib/baseline-analytics` is the one Python project outside `services/` and works the same way; the Cube query and tool tests live there, not in the API or MCP suites. Unit and integration tests run together in one command. There is no deselection and no separate integration target.

Tests that need a real database are marked `@pytest.mark.integration`. They spin up a throwaway Postgres with Testcontainers, and `testing.postgres_tc.docker_available()` skips them when the Docker daemon does not answer, so the suites still pass on a machine without Docker.

Every service except `migrate` fails its suite below a line-coverage floor, set per service by `--cov-fail-under` in its `pyproject.toml`. `migrate` has no floor, because it asserts on migration files and applied schema rather than on branches.

## The `testing/` package

Three suites (`api`, `scraper`, and `migrate`) need the same thing: a throwaway Postgres carrying the _real_ schema. That word is the whole point. The container is built from `db/init.sql` and the actual Alembic revision chain, so a test fails when a revision stops applying or a query drifts from the columns it reads. A hand-written mock schema per service would sail through exactly those breakages, which is the class of bug that historically reached production here.

Keeping one copy is the second reason. The bootstrap is container startup, Alembic invocation, and SQL-statement splitting; three copies would drift, and the drift would be silent because each service's tests would still be green against its own stale copy.

- `postgres_tc.py`: starts the container and bootstraps a schema
- `analytics_integration.sql`: the `gold` tables integration tests read from
- `analytics_integration_seed.sql`: rows for those tables

`bootstrap_engine()` applies, in order: `db/init.sql` (creates the empty `source`, `silver`, `gold` schemas), then `alembic upgrade head` from `services/migrate` (fills `source`), then optionally the gold schema and seed above.

The fixture SQL exists because dbt owns `silver` and `gold` in production and cannot run inside a pytest process. So these two files stand in for dbt's output, and they live next to the helper that applies them rather than in `db/`, which is what Compose bootstraps for real. Mixing test fixtures into that directory invites someone to mount one.

It is deliberately not an installed dependency. It is test-only and must never reach an image, and images already exclude it twice over: build contexts are `services/<name>`, and the Dockerfiles sync `--no-dev`. Making it a path dependency would instead write it into every service's `uv.lock` and risk resolution failures inside containers that can't see the repo root. A `pythonpath` entry in each pytest config is cheaper and has no runtime footprint, and it is why `from testing.postgres_tc import ...` resolves with no install step.

## API vs Cube parity

The pages read `gold` with SQL; Ask, Chat and MCP read it through Cube. Four families are defined on both sides: standings, team records, player season averages, and back-to-backs. `services/api/tests/test_cube_parity_integration.py` runs both against the same seeded Postgres and fails when a number differs.

It starts a real Cube container beside the Testcontainers Postgres, on a shared Docker network, using the image version from `services/cube/Dockerfile` and the model mounted from `services/cube/model`. So it also catches a cube YAML that no longer compiles or no longer matches the gold columns. It is an ordinary `integration` test: `make test-api` runs it, CI runs it in the `api` job of the `python` matrix, and it skips without Docker. `make test-parity` runs it alone.

When adding a metric that both a page and a Cube operation report, add a case there. The gold tables in this fixture are hand-written (`testing/analytics_integration.sql`), not built by dbt, so logic that lives in a dbt model is covered by the dbt e2e below, not here.

## dbt

`dbt build` runs the schema tests declared in the model YAML (`not_null`, `unique`, `relationships`) interleaved with the models, plus the singular tests in `services/dbt/tests/`. Interleaving matters: a failing test skips that model's descendants rather than publishing them and failing at the end.

`make test-dbt` is the end-to-end pass. It uses `docker-compose.e2e.yml` under its own Compose project (`nba-e2e`, never the default `nba`, because the teardown is `down -v`), builds the migrate and dbt images, starts an ephemeral Postgres, applies Alembic, then runs `services/dbt/e2e/run.sh`: seed `e2e/seed.sql`, `dbt deps && dbt build`, and assert on the resulting `gold` marts in SQL. The target tears the stack down afterwards.

## Frontend

Vitest covers components and `src/lib` from `services/frontend/tests/unit`. Its coverage floor is set in `vitest.config.ts`.

Playwright lives in `services/frontend/tests/e2e` and starts its own dev server on port 3100. No database or API is involved: `tests/e2e/helpers.ts` exports `mockApi(page, options)`, which patches `window.fetch` through an init script and answers every `/api/v1` call from fixtures. Options are `empty` (a bare warehouse), `fail` (500s, for `ErrorState` paths), `delayMs` (so loading states actually paint), and `collapseRows` (pad the blown-leads table).

The same helper records every intercepted URL, so specs assert on the query params a control really sent rather than on mock rows that never change: `apiCalls`, `waitForApiCall`, and `lastApiCall`. Note that Playwright's web-first assertions retry, so a transient state needs a one-shot read (`await locator.count()`) instead.

## Admin job runner

`scripts/test-admin-jobs.sh` exercises `source.admin_jobs` claiming, `flock` contention, and reaping an abandoned job. It is shell and SQL against a running Compose Postgres rather than Testcontainers, because that is what the runner itself is.

## CI

One workflow, `.github/workflows/ci.yml`. `quality` runs the pre-commit hooks; `python` is a matrix over the service suites and `lib/baseline-analytics` (the `api` entry pulls the Cube image for the parity checks); `frontend`, `frontend-e2e`, `dbt-e2e`, and `admin-jobs-e2e` each run their target. Image build and deploy are gated behind all of them.
