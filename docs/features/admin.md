---
summary: The owner's console — pipeline health, job buttons, model promotion, scrape switches and feature flags.
status: current
code:
  - services/frontend/src/app/admin/
  - services/frontend/src/components/admin/
  - services/frontend/src/lib/admin.ts
  - services/frontend/src/lib/admin-access.ts
  - services/frontend/src/lib/admin-status.ts
  - services/api/src/routers/admin.py
  - services/api/src/routers/features.py
  - services/api/src/queries/admin.py
  - scripts/admin-job-runner.sh
  - scripts/host-snapshot.py
  - scripts/queue-dbt-if-changed.sh
related:
  - docs/operations.md
  - docs/features/predictions.md
  - docs/features/accounts-and-follows.md
  - docs/features/feedback.md
---

# Admin and feature flags

Setup, the job runner's guarantees and VM health rules of thumb are operator detail in [operations.md](../operations.md) (Admin console, Feature flags, Admin jobs, VM health). This doc is what the console is and the rules it must keep.

## What users see

Only the site owner sees `/admin`; it is not in the nav. It shows ingestion, dbt, ML and VM health, can re-run jobs, compares the prediction models and promotes one to live (Models tab, [predictions.md](predictions.md)), lists reports sent from `/feedback` with Resolve and Reopen (Feedback tab, with a grey count of open reports; [feedback.md](feedback.md)), and holds the scrape gate switches and the feature flags (Settings tab). Tabs live in `?tab=`.

Everyone else sees the effect of the flags:

- `chatbot`: the signed-in chat at `/chat`. Off makes `POST /api/v1/account/chat` return 503 and puts Ask back in the header ([ask-and-chat.md](ask-and-chat.md)).
- `picks`: game picks on `/schedule` and `/picks`. Off hides them and makes the picks routes return 503. Existing picks are kept ([picks.md](picks.md)).
- `feedback`: the public form at `/feedback`. Off makes `POST /api/v1/feedback` return 503 and shows the contact email instead. Existing reports are kept ([feedback.md](feedback.md)).

## How it works

- `/api/v1/admin/*` serves ingestion / dbt / ML / VM health (VM from `source.host_snapshots`, written by the host runner via `scripts/host-snapshot.py`, plus live `pg_stat_activity`).
- `PUT /admin/pipeline` flips the `enabled` / `season_active` switches and nothing else in `source.scrape_pipeline`.
- `POST /admin/jobs` queues work into `source.admin_jobs` (`scrape`, `dbt`, `ml`, `refresh`) for the host runner. The API never executes it: `make prod-admin-jobs` (cron every minute) drains the queue on the host, never in a container, because executing `make` needs the Docker socket, which the API must not have.
- `source.feature_flags` holds one row per switchable feature. A change applies to the next request, with no deploy or restart.

## Surfaces

- `/api/v1/admin/*`: `GET /admin/health`, `GET /admin/runs`, `GET` / `POST /admin/jobs`, `PUT /admin/pipeline`, `GET /admin/flags`, `PUT /admin/flags/{flag_key}`, `GET /admin/models`, `PUT /admin/models/champion`, `GET /admin/feedback`, `PUT /admin/feedback/{feedback_id}`.
- `GET /api/v1/features`: the public read. It reports what the UI should offer rather than the raw flags: `chatbot` is true only when the flag is on **and** `NLP_LLM_API_KEY` is set.

## Invariants

- **Feedback never makes the console unhealthy.** Open reports are a neutral count on their tab, not a review item, so they do not change the overall status.
- **Two gates, both fail closed.** The page: the admin is whoever `isAdminUser` in `services/frontend/src/lib/admin-access.ts` accepts (a GitHub login in `ADMIN_GITHUB_LOGINS` or a verified Google address in `ADMIN_GOOGLE_EMAILS`), checked in the `authorized` callback, again in the admin page, and again in every admin server action. The API: `Authorization: Bearer $ADMIN_API_TOKEN`. Unset secrets disable both (503), never open them.
- **Never gate anything on "has a session"**: sign-in is open to anyone.
- `ADMIN_API_TOKEN` is server-side only, never `NEXT_PUBLIC_`.
- **One pending job at a time**, enforced by a partial unique index (409 otherwise).
- **The API enforces a flag (503); the UI only reflects it**, so a page left open after a flag is switched off still gets refused.
- **Flags are created by Alembic migrations**, never through the API: setting an unknown key is a 404, and a flag with no row reads as off.
- Deploys are deliberately not a button.

## Gotchas

- The job buttons only work on the prod overlay (`ADMIN_JOBS_ENABLED=true`); locally they are disabled because nothing drains the queue.
- A deploy queues a `dbt` job itself when `services/dbt` changed since the last deployed tag; if another job is pending it warns in the deploy log instead.
- Sessions issued before Google sign-in was added carry no provider and are refused by the admin gate.

## Out of scope

A deploy button, flags created at runtime, and admin access for anyone but the owner.
