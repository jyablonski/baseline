# AGENTS

NBA analytics monorepo: scrape → Postgres → dbt → API / MCP / Cube → Next.js.

Prefer [docs/](docs/) and root [README.md](README.md) over inventing behavior.

## Service map

- `services/scraper` — Basketball-Reference (teams, players, schedule, game logs, standings, play-by-play, contracts, transactions, current injuries) → schema `source`. No NBA Stats / `nba_api`; Baseline owns UUID identities and providers map onto them. Optional `SLACK_WEBHOOK_URL`: one Incoming Webhook per failed sync (`pipeline` / `scrape-daily` / `scrape-all`), not per step; unset/empty skips HTTP. `refresh-daily.sh` also posts once for a failed dbt or ml stage (`pipeline mark-dbt|mark-ml --notify`, recorded in `pipeline_runs.dbt_exit` / `ml_exit`). A source that failed or returned zero rows `SOURCE_ALERT_STREAK` (default 3) runs in a row posts a degraded alert; skipped runs don't count. Optional `ODDS_API_KEY`: The Odds API upcoming slate (`scrape-odds` / daily); unset/empty skips odds HTTP. ESPN's public scoreboard JSON supplies national TV listings for the next two weeks (`scrape-broadcasts` / daily, no key; a failure is recorded but does not fail the run); it is the only ESPN field used. Optional `REDDIT_*`: everyday r/nba posts and top comments whenever the pipeline is enabled (not behind `season_active`); unset/empty skips reddit HTTP. Season-active daily: slate, Finals logs, PBP for Finals that lack it, standings, injuries, odds-if-keyed, broadcasts. Hourly catch-up (`make prod-catch-up`, 13:00–21:00 UTC) re-scrapes only last night's games still missing a score, box score, or PBP, then runs dbt + ml if anything landed. A single `psql` pre-check exits immediately when nothing is missing, and it alerts once, at the end of the window. Contracts, transactions, and Reddit run whenever the pipeline is enabled (not season-gated). `scrape-all` with no `--seasons` is the current season, the only one supported (see Season scope)
- `services/migrate` — Alembic for source tables only (`make db-migrate`); shared by all services
- `services/dbt` — dbt `source` → `silver` (staging/intermediate) + `gold` (marts). `fct_game_upsets` ranks moneyline upsets from retained pregame odds (empty until 2026-27 Finals with captured lines); Cube `game_upsets`, MCP `get_biggest_upsets`, REST `GET /api/v1/games/upsets`. `fct_daily_highlights` scores and ranks each day's notable events (season highs, streaks, blown leads, scoring duels, top-team meetings) into the lead line under each home-page score; knobs are the `highlight_*` vars in `dbt_project.yml`; Cube `daily_highlights`, MCP `get_daily_highlights`, REST `GET /api/v1/games/highlights`
- `services/ml` — pregame WP job: Elo v0 + Elo v1 + logit v1 (only once `make ml-train` has stored an artifact). `CHAMPION_MODEL_VERSION` picks the one the product shows, the rest run in shadow: code default `elo-v0`, production `.env` sets `elo-v1`; `make ml-backfill` grades past Finals for all three; Python 3.14, profile `tools`; reads gold Regular Season Finals + schedule, writes `source.game_predictions`
- `services/api` — FastAPI `/api/v1/*` over `gold`
- `lib/baseline-analytics` — shared Python package (`baseline_analytics`), not a service: the Cube client, the named operations (`CubeAnalytics`), and the one list of named tools (`tools.py`) that both the API's LLM adapter and the MCP server serve. Add or change a tool there, never in `services/api` or `services/mcp`. A uv path dependency of both (editable locally, built into the image)
- `services/frontend` — Next.js; `NEXT_PUBLIC_API_URL` → API
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
- `make ml-train` / `ml-eval` / `ml-snapshot` are manual only, never on the daily cron. `ml-snapshot` stores Elo ratings in `source.model_artifacts` so they survive deleting the seasons behind them (`docs/ml.md`).
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

## API surface

- `/admin` (frontend) and `/api/v1/admin/*` are current: ingestion / dbt / ML / VM health (VM from `source.host_snapshots`, written by the host runner via `scripts/host-snapshot.py`, plus live `pg_stat_activity`), plus `PUT /admin/pipeline` (the `enabled` / `season_active` switches on the Settings tab; nothing else in `source.scrape_pipeline`), plus `POST /admin/jobs` which queues work into `source.admin_jobs` for the host runner (the API never executes it). One pending job at a time, enforced by a partial unique index (409 otherwise). The API needs `Authorization: Bearer $ADMIN_API_TOKEN`. Both gates fail closed — unset secrets disable them (API returns 503), never open them. The token is server-side only, never `NEXT_PUBLIC_`.
- Sign-in (GitHub or Google) is open to anyone, so a session is not authority. The admin is whoever `isAdminUser` in `services/frontend/src/lib/admin-access.ts` accepts: a GitHub login in `ADMIN_GITHUB_LOGINS` or a verified Google address in `ADMIN_GOOGLE_EMAILS`. That check runs in the `authorized` callback (middleware), again in the admin page, and again in every admin server action. Never gate anything on "has a session".
- Feature flags are current: `source.feature_flags`, toggled from `/admin` (`GET` / `PUT /api/v1/admin/flags`), read publicly at `GET /api/v1/features`. `chatbot` and `picks` exist. The API enforces a flag (503); the UI only reflects it. New flags are added by migration.
- `/api/v1/account/*` is current and never called by a browser: accounts (including `PUT /account/me/timezone`), `POST /account/chat`, and `GET` / `PUT` / `DELETE /account/picks`. A Next.js server action checks the session and calls with `Authorization: Bearer $ACCOUNTS_API_TOKEN` plus `X-Baseline-User`; unset token returns 503. Do not add Next route handlers under `/api/*` — Caddy sends everything there except `/api/auth/*` to FastAPI — use server actions.
- `/chat`, `/picks`, `/account`, `/signin` (frontend) are current. Chat is per-user quota'd in `source.chat_usage` and never runs SQL. The header shows either Chat or Ask, never both: Chat when `GET /api/v1/features` reports `chatbot` (flag on and `NLP_LLM_API_KEY` set), Ask otherwise. Inside Chat a question is still answered by the rules backend once `CHAT_GLOBAL_DAILY_LIMIT` is spent; the full rules are in `docs/operations.md` under "Chat or Ask". Picks are a winner per game with an optional dollar stake, graded at read time from gold. There is deliberately no balance: accounts start at nothing and only the net of settled stakes is shown. Do not add a starting bankroll. Details in `docs/operations.md`.
- `make prod-scrape` / `prod-ml` / `prod-admin-jobs` — production one-shots; `prod-admin-jobs` drains `source.admin_jobs` (cron every minute). Runs on the host, never in a container: executing `make` needs the Docker socket, which the API must not have.
- `GET /api/v1/status` is current: `last_scraped_at` from `source.scrape_pipeline.last_success_at` plus warehouse coverage counts. Do not surface `GET /health` in the UI.
- `GET /api/v1/schedule/dates` is current: every date with a game still to play (not Final) from `from_date` (default today; the frontend sends the Eastern date three hours ago), oldest first, unpaginated, for the `/schedule` day picker. `/schedule` and `/games` share one `DayPicker` (`components/day-picker.tsx`) and `dayNavigation` (`lib/calendar.ts`), and both keep the day in `?date=`.
- `GET /api/v1/schedule` carries the champion pregame WP, a consensus moneyline and spread, `national_tv`, and each side's back-to-back flag with last night's opponent, venue and score (`*_is_back_to_back`, `*_last_night_*`, shared SQL with `GET /api/v1/games/{id}`); `GET /api/v1/predictions/scorecard` serves `gold.fct_prediction_scorecard`. Both read gold only; the frontend shows them on `/schedule` and `/predictions` (the latter not in the nav).
- `GET /api/v1/games/{game_id}` is current: one game in any state for `/games/[id]`, the schedule row (shared SQL with `GET /api/v1/schedule`) plus scores, each team's record entering the game, current form before tip, the lead highlight, and the upset fields (`is_upset`, `winner_market_wp`, `model_called_upset`). Declared after `/games/highlights`, `/games/collapses`, `/games/closest`, `/games/largest-margins`, `/games/dates` and `/games/upsets` so those are not read as ids.
- `/games` is the nav tab for finished games, `/schedule` for upcoming ones. Its day view reads `GET /api/v1/games/dates` (every date with a Final game, newest first, unpaginated: the date picker's dots and the season the notables use) and `GET /api/v1/games?game_date=` (that day's results, with each side's conference, `series_game_number` in the playoffs, the `lead_highlight` headline, and `largest_lead_blown` from `gold.fct_game_flow`, the winner's biggest deficit, null without play-by-play). `GET /api/v1/games/upsets`, `/games/collapses`, `/games/closest` and `/games/largest-margins` are current: the four "Season notables" tabs (Upsets, Comebacks, Closest games, Largest margins), each with `team` (either side of the game) and `offset` for the pager; `meta.total` is the page's length, not a count, so the UI asks for one row past the page to know there is a next. Upsets come from `gold.fct_game_upsets` biggest first (newest season with any by default) with the no-vig price, records entering the game and notable absences; empty, never an error, until Final games with captured lines exist. The other three read `gold.fct_game_flow`. Picks carry `is_upset` for the `/picks` "Called the upset" tag.
- `GET /api/v1/transactions` feeds team pages ("Recent moves") and player pages (shown only when there are any), as a table from one `TransactionList` component; not on the home page. Link only `linked_player_names` and team abbreviations, never the raw `player_names`.
- `GET /api/v1/teams/{team_id}/season-games` is current: every game of one team's season in any state, from that team's side (result, score, the champion's WP for that team, back-to-back flag read from `fct_games_schedule`), unpaginated, behind the `/teams/[id]` calendar. No `season` means the team's newest on the schedule.
- `GET /api/v1/injuries` and `GET /api/v1/games/{game_id}/injuries` are current: the current injury report (`fct_player_injuries`) and one game's report from the daily snapshots (`fct_game_injuries`), with parsed status and a notable flag. Schedule and game rows carry `home_notable_out` / `away_notable_out`. Shown on the game page, `/schedule`, and player and team pages; no injuries page. Details in `docs/data.md` under Injuries.
- `GET /api/v1/games/highlights` is current: each game's lead highlight for one day (default: the newest day with games) from `gold.fct_daily_highlights`; not called by the frontend, which reads each game's `lead_highlight` from `GET /api/v1/games`.
- `GET /api/v1/players/value` is current: every Regular Season MVP-ladder player with a salary on file (unpaginated), behind the `/players` Production vs Salary plot. Salary is the current contract season's, reported as `salary_season`.
- `POST /api/v1/query` and `/ask` are current. Default backend is rules (`NLP_BACKEND=rules`): B2B, season averages, player compare, team head-to-head, blown leads, arena-city record, salary/payroll, standings, win streaks — each family is a Cube query. Unrecognized questions return a capability message, not HTTP 501. `NLP_BACKEND=llm` is an opt-in adapter (an index of cube names in the prompt, `get_cube_schema` for members on demand, + `query_cube` / named Cube tools, needs `NLP_LLM_API_KEY`); it is not the public default and does not run SQL. MCP `query_cube` is Cube query JSON only. Cube down → clear Ask/MCP error; no gold SQL fallback. The prod overlay starts Cube internally for Ask/MCP and does not publish port 4000.

## SQL style (API)

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

## Season scope

- Only the current (latest) NBA season is supported. Production loads that one season; earlier seasons are not kept, and nothing in the product may depend on them.
- Every `season` / `since_season` parameter (API query params, the shared tools in `lib/baseline-analytics`, Cube filters, `?season=` in the frontend) is plumbing that defaults to the current season. Do not build features on choosing a different one: no season pickers, season-over-season comparisons, all-time or multi-season leaderboards, or historical backfills.
- "Career", "by season" and "history" in a tool or page name mean the loaded season, not a player's whole career. Don't describe them as anything more in prompts, tool descriptions or docs.
- Write SQL, dbt models and Cube queries for one season: resolve it once (newest season present) and filter to it. Don't add cross-season fallbacks, carry-overs or code paths that only exist for when several seasons are loaded.
- `scrape-all --seasons`, `scripts/oracle-reset-and-backfill.sh` and `make ml-backfill` stay as maintenance tools (reloading the current season, re-grading its games). Using them to load other seasons is unsupported. `make ml-snapshot` is how Elo ratings survive the previous season being deleted (`docs/ml.md`).

## Conventions

- Do not commit unless the user asks
- The app is in early development: nobody depends on any page or endpoint in production yet. Remove or rename pages, routes and response fields outright; no redirects, deprecation shims or backwards-compatible aliases
- Do not invent features; label planned vs current
- dbt owns SQL + YAML tests, not Python unit tests
- Scraper / dbt / ml → profile `tools`; MCP is on the default stack
- Frontend agent notes: `services/frontend/AGENTS.md`
- dbt agent notes: `services/dbt/AGENTS.md`
- Markdown: never impose a line-length / wrap limit. Do not hard-wrap prose in `.md` files. Do not reflow paragraphs to 80 (or any) columns. Coding agents must not “fix” wrapping by adding mid-paragraph newlines.
