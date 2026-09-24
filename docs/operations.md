# Operations

What to run day to day. Scrape commands and marts are in [data.md](data.md).

## Bring-up

```bash
cp .env.example .env
make up             # Tilt: postgres, migrate, cube, api, frontend, mcp
make db-migrate     # after new Alembic revisions
```

Keep `DATABASE_URL` in sync with the Postgres settings. `docker compose down -v` deletes the warehouse — only run it deliberately.

Cube uses 400–800 MB, so production caps it at 1 GB. Watch VM memory when a refresh runs beside the always-on stack.

## The daily gate

`source.scrape_pipeline` is a single row that decides what runs. It ships **disabled**.

```bash
make pipeline-enable     # enabled + season_active
make pipeline-status
make scrape              # scrape only; FORCE=1 bypasses the gate
make dbt                 # deps + build
make ml                  # score Elo + logit, then the gold copy
make refresh             # scrape → dbt → ml
```

`enabled` is the master switch. `season_active` gates the NBA steps only:

|                             | NBA steps                                                         | Contracts | Transactions | Reddit  |
| --------------------------- | ----------------------------------------------------------------- | --------- | ------------ | ------- |
| `enabled` + `season_active` | slate, Finals logs, their PBP, standings, injuries, odds if keyed | yes       | yes          | yes     |
| `enabled` only              | skipped                                                           | yes       | yes          | yes     |
| not `enabled`               | skipped                                                           | skipped   | skipped      | skipped |

Contracts, transactions, and Reddit are not season-gated. Roster and payroll movement peaks in the offseason — free agency, trades, extensions — so gating those on `season_active` staled the data exactly when it changed fastest.

`FORCE=1` bypasses both. A skipped run exits 0 and does **not** run dbt.

Training is deliberately not on this path. `make ml-train` fits the logit artifact and `make ml-eval` prints its metrics against the Elo and always-home baselines; both are manual. See [ml.md](ml.md).

`refresh-daily.sh` runs Alembic, the gated scrape, `dbt build`, Elo, then the gold predictions copy. It waits for an existing healthy Postgres rather than starting one, because recreating Tilt's container would not re-run `init.sql`. `dbt build` interleaves each model's tests with the model, so a failing test skips that model's descendants instead of publishing them and failing at the end.

## Optional keys

| Variable              | Unset                              | Set                                                   |
| --------------------- | ---------------------------------- | ----------------------------------------------------- |
| `SLACK_WEBHOOK_URL`   | silent                             | one post per failed stage, never per step (see below) |
| `SOURCE_ALERT_STREAK` | 3                                  | unhealthy runs in a row before a source alerts        |
| `ODDS_API_KEY`        | odds skipped, daily still succeeds | The Odds API upcoming slate                           |
| `REDDIT_*`            | Reddit skipped                     | r/nba posts and top comments                          |

## Alerts

Each stage posts to Slack at most once, and a failed stage stops the ones after it, so a broken refresh produces one post. The single exception is a degraded-source post followed by a dbt or ml failure, since the scrape itself succeeded.

- **Scrape failed** — one post listing the failed steps. The refresh stops there, so dbt and ml never run and cannot add a second post.
- **dbt failed** — one post, and ml does not run. The exit code lands on the run's `pipeline_runs.dbt_exit`.
- **ml failed** — one post naming which half broke, `ml score` or the gold predictions copy. The exit code lands on `pipeline_runs.ml_exit`.
- **Scrape succeeded but a source is degraded** — one post when any source attempted this run has been unhealthy `SOURCE_ALERT_STREAK` runs in a row. When the scrape also failed, these lines ride along in its failure post instead.

**Unhealthy** means failed, or succeeded with zero rows from a source that always has some (`standings`, `injuries`, `odds`, `player_game_logs`, `play_by_play`, `contracts`, `reddit`), recorded as `expectation = 'below'` in `source.scrape_source_runs`. One empty night is usually "not published yet"; a streak is a parser that stopped matching, which is why only the streak alerts. Skipped runs (off-days, the off-season, a missing key) neither extend nor break a streak, and a source that was not attempted this run never alerts on old history. The same streak is the **Streak** column on `/admin`.

A successful refresh is otherwise silent. The freshness check below covers the one case none of this can see: a refresh that never starts.

## Scheduling

Five cron entries on the VM. None of this starts with `make up`.

```cron
15 8  * * * cd /opt/nba && flock -n /tmp/nba-refresh.lock make prod-refresh >> /opt/nba/logs/refresh-daily.log 2>&1
45 11 * * * cd /opt/nba && make prod-check-freshness >> /opt/nba/logs/freshness.log 2>&1
*     * * * * cd /opt/nba && make prod-admin-jobs >> /opt/nba/logs/admin-jobs.log 2>&1
30 7  * * * cd /opt/nba && make prod-db-backup >> /opt/nba/logs/backup.log 2>&1
0 12  * * 0 cd /opt/nba && make db-restore-test >> /opt/nba/logs/restore-test.log 2>&1
```

**Always use the `make prod-*` targets, never raw `docker compose`.** Without `IMAGE_PREFIX`/`IMAGE_TAG` the overlay resolves bare `nba-*:latest`, which does not exist on the box — so Compose silently _builds_ it from the working tree instead of failing. `make refresh-daily` has the same trap. `/opt/nba/logs/` must also exist, or cron's redirect fails before `make` runs.

The second entry is the **absence check**. Every other signal is emitted _by_ the pipeline, so a pipeline that never starts is completely silent — which is exactly how one outage went unnoticed. It needs only Postgres and `curl`, so it survives the failures that break the refresh. It alerts when `now() - last_success_at` exceeds `STALE_HOURS` (default 26) and exits 0 when the pipeline is intentionally disabled.

Cron carries no registry coordinates: `prod-release` writes the deployed tag to `.env.deploy`, which every make target includes. CI pins `IMAGE_TAG=<sha>`, so the nightly job and the API serving traffic are the same build. Precedence is command line > environment > `.env.deploy` > defaults, so a rollback still wins.

## Backups

`make prod-db-backup` writes a `pg_dump -Fc` of the whole database to `/opt/nba/backups/daily/`, keeping `KEEP_DAILY` (7) dumps, with the first dump of each ISO week hardlinked into `weekly/` and kept for `KEEP_WEEKLY` (4) weeks. Backups are **local only** — they cover a stray `down -v`, a bad migration, or a reset run against the wrong host, not losing the VM. Copy `backups/` off the box yourself if you need that.

A dump is kept only after `pg_restore --list` reads it back, and old dumps rotate only after that, so a failed run never deletes the last good one. Failure exits non-zero and posts to `SLACK_WEBHOOK_URL` when set.

The backup runs at 07:30, before the 08:15 refresh, and deliberately does **not** take the refresh lock: the refresh cron uses `flock -n`, so a backup holding it would silently skip that day's refresh. `pg_dump` reads one consistent snapshot either way; the gap is for memory.

`make db-restore-test` (weekly in cron; Slack on failure) restores the newest dump — or `DUMP=<path>` — into a throwaway Postgres container, checks that `source`/`silver`/`gold` and `alembic_version` came back, and prints the largest tables. It never touches the stack's database.

To replace the live database: `make prod-db-restore DUMP=<path> CONFIRM_RESTORE=RESTORE`. It restore-tests the dump first, refuses while the refresh lock is held, writes a safety dump to `backups/pre-restore/`, then drops and recreates the database (`dropdb --force` disconnects api, mcp, and cube; they reconnect on the next request). Refuses without `CONFIRM_RESTORE`.

`make test-backups` exercises all of this against a real Postgres in its own Compose project.

## Admin console

`/admin` shows ingestion, dbt, and ML health, and can re-run jobs. Two independent gates, both **fail closed**:

- **The page** uses GitHub OAuth with an `ADMIN_GITHUB_LOGINS` allowlist. Unset means nobody gets in, including you.
- **The API** (`/api/v1/admin/*`) needs `Authorization: Bearer $ADMIN_API_TOKEN`. Unset returns 503 — never open.

The token is held server-side and never reaches the browser. Setup: generate `ADMIN_API_TOKEN` and `AUTH_SECRET`, create a GitHub OAuth app with callback `<origin>/api/auth/callback/github`, then set `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_URL`, and `ADMIN_GITHUB_LOGINS`. All are commented in `.env.example`; with none set the console is simply unreachable.

## Admin jobs

The console queues work into `source.admin_jobs` and `scripts/admin-job-runner.sh` runs it on the host — four types: `scrape`, `dbt`, `ml`, `refresh`. The API cannot execute jobs itself: it has no Docker socket, and giving a publicly reachable process one would be root-equivalent on the box. It only ever inserts a row.

What the runner guarantees:

- **One job at a time**, enforced by a partial unique index. A second request gets 409.
- **Never overlaps the daily refresh** — it shares the same `flock`. A busy lock re-queues the job rather than failing it.
- **Abandoned jobs are reaped.** A runner killed mid-job would otherwise leave its row `running` forever, wedging the queue. Before claiming, it fails any `running` row whose lock is free and older than `STALE_JOB_GRACE` (default 5 minutes).

The buttons only work on the prod overlay, which sets `ADMIN_JOBS_ENABLED=true` on the frontend. Anywhere else (Tilt, `make up`) they are disabled and the server action refuses to queue: nothing drains the queue locally, and the runner only maps jobs to `prod-*` targets. Run `make scrape` / `make dbt` / `make ml` / `make refresh-daily-once` directly instead.

`make test-admin-jobs` covers all of this against a real Postgres; CI runs it in its own Compose project.

**Deploys are deliberately not a button.** CI runs `make prod-deploy` on push to `main` and `workflow_dispatch` is enabled, so a redeploy is one click in the Actions tab — no SSH, no extra code.

## Caddy and MCP

MCP is served at `https://<host>/mcp` through Caddy on the site certificate. The container port is not published: clients send `Authorization: Bearer $MCP_API_TOKEN`, and a bearer token over plain HTTP is a credential on the wire.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://baseline.jyablonski.dev/mcp   # 401 = healthy
```

A 401 is the right answer — it proves TLS terminates, Caddy routes to MCP, and auth is enforced.

`prod-release` **recreates** Caddy rather than reloading it. `Caddyfile` is a single-file bind mount and `git pull` replaces the file rather than editing it in place, so the container keeps reading the original inode and `caddy reload` would faithfully reload stale config.

## Also worth knowing

Postgres is published on `POSTGRES_PORT` for tools like DBeaver, while containers keep using `postgres:5432`. Allow it in the OCI security list and any host firewall; credentials live in `/opt/nba/.env`.

Not built: per-source retry. Basketball-Reference HTTP already retries inside the shared transport, and re-running a whole step would repeat every request against the same rate limit to reproduce what is usually a deterministic parse error.
