# Dependency updates

[Renovate](https://docs.renovatebot.com/) (the Mend GitHub app) keeps every dependency current through a small number of PRs a month. Config: [`renovate.json5`](../renovate.json5).

## Cadence

- **Monthly**, before 4am Pacific on the 1st.
- Two PRs land then: **all minor and patch updates** in one, and **lock-file maintenance** (refreshes transitive deps in every `uv.lock` and `package-lock.json`) in the other. Renovate always keeps lock-file maintenance on its own branch.
- Nothing merges itself. CI runs on each PR; you review and merge.

## What it covers

Every ecosystem in the repo, in the same PRs:

- Python: all 9 `pyproject.toml` + `uv.lock` pairs (each service, `lib/baseline-analytics`, the root)
- Frontend: `package.json` + `package-lock.json`
- Docker base images (Python, Node, uv, Cube) and Compose images (Postgres, Caddy)
- GitHub Actions and the CI runner
- pre-commit hooks (ruff stays in step with the ruff pin in `pyproject.toml`)

Not covered: dbt packages (`services/dbt/packages.yml`) and versions written in prose, such as `uvx ruff@…` in agent skills. Bump those by hand.

## What waits for you

The [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) issue on GitHub lists everything pending. Ticking a box there opens its PR right away. These never open on their own:

- **Major versions.** One PR each, so one breaking upgrade can't hold back the rest.
- **Language toolchains.** Python (`.python-version`, `requires-python`, the `python` images), Python for dbt (its own group, since dbt stays on an older Python), and Node (the image, CI, `@types/node`). Python patch releases of the image still ride the monthly PR.

Postgres majors are a data migration (dump and restore or `pg_upgrade` on the prod volume), not a tag bump. Don't approve one as a routine update.

## Safeguards

- **7-day wait.** A release must be a week old before Renovate proposes it. Registries that report no release date (ghcr.io, some Docker Hub tags) skip the wait instead of being held forever.
- **Exact pins stay exact.** Renovate rewrites `==1.2.3` to `==1.2.4`; it never loosens a pin into a range.
- **Locally built images** (`nba-*` in Compose) are ignored.

## Running it early

Merge `renovate.json5` to `main` with the app installed. Then open the Dependency Dashboard and tick the boxes under **Awaiting Schedule** to create those PRs now instead of on the 1st.

## Turning on automerge later

Add a rule with `automerge: true` for `minor`, `patch`, `pin` and `digest`, and require the CI checks on `main`. Every merge to `main` deploys, so an automerged PR ships to production.
