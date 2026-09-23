.PHONY: up down stop logs \
	test test-api test-scraper test-mcp test-cube test-ml test-frontend test-frontend-e2e test-dbt \
	test-migrate \
	build build-multiarch ensure-buildx-builder remove-buildx-builder sync db-migrate migrate \
	pipeline-status pipeline-enable pipeline-disable scrape dbt ml ml-train ml-eval ml-backfill refresh \
	refresh-daily refresh-daily-once seed-demo seed-demo-clean \
	prod-config prod-up prod-migrate prod-dbt prod-deploy prod-release prod-build prod-pull prod-pull-tools prod-record-deploy \
	prod-pipeline-status prod-pipeline-enable prod-pipeline-disable prod-refresh prod-refresh-daily prod-refresh-daily-once \
	prod-health prod-prune prod-check-freshness check-freshness prod-caddy-reload \
	prod-scrape prod-ml prod-ml-backfill prod-ml-train admin-jobs prod-admin-jobs test-admin-jobs quality \
	db-backup prod-db-backup db-restore-test db-restore prod-db-restore test-backups

COMPOSE ?= docker compose
TILT ?= tilt
DOCKER_TARGET ?= runtime
# Same compose project as Tilt. Pinned, not derived from the directory name:
# Compose namespaces volumes by project, so renaming the checkout would point at
# a fresh, empty `<dir>_pgdata` and the warehouse would look wiped. Changing this
# value has the same effect — migrate the volume first if you ever do.
COMPOSE_PROJECT_NAME ?= nba
export COMPOSE_PROJECT_NAME
# One-shots must not reconcile depends_on postgres (recreates Tilt's container).
COMPOSE_RUN_TOOLS = $(COMPOSE) --profile tools run --rm --no-deps
COMPOSE_PROD = $(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml
# Host-native `make build` leaves this unset. Multi-arch bake uses both.
PLATFORMS ?= linux/amd64,linux/arm64
BUILDX_BUILDER ?= nba
# Public origin. Caddyfile hardcodes the same host (Caddy needs it for ACME).
PUBLIC_HOST ?= baseline.jyablonski.dev
PUBLIC_URL ?= https://$(PUBLIC_HOST)
export PUBLIC_URL
# Written by `prod-release` on the server: the exact registry coordinates the
# last successful deploy installed. Host cron and one-shot scripts pick them up
# from here, so the daily job cannot run a different build than the containers
# serving traffic, and the crontab never has to hardcode a tag. Absent on a dev
# checkout, hence `-include`. The file uses `?=` so precedence stays
# command line > environment > deployed tag > the defaults below.
DEPLOY_ENV ?= .env.deploy
-include $(DEPLOY_ENV)

# Registry coordinates for bake tags and the prod overlay's `image:` refs.
# Empty IMAGE_PREFIX = local images (`nba-api:latest`) built on this machine;
# set it (e.g. ghcr.io/jyablonski/) to deploy prebuilt images instead.
IMAGE_PREFIX ?=
IMAGE_TAG ?= latest
export IMAGE_PREFIX
export IMAGE_TAG

up: ## Start the stack with Tilt (hot reload)
	DOCKER_TARGET=development $(TILT) up

prod-config: ## Validate prod overlay
	$(COMPOSE_PROD) config

prod-up: ## Runtime images + cube + caddy (needs DOCKER_TARGET=runtime)
	DOCKER_TARGET=runtime $(COMPOSE_PROD) up -d postgres api frontend mcp cube caddy

prod-migrate: ## Alembic upgrade head via prod overlay (one-shot; does not recreate postgres)
	DOCKER_TARGET=runtime $(COMPOSE_PROD) run --rm --no-deps migrate alembic upgrade head

# Registry deploys pull prebuilt images; without IMAGE_PREFIX we build on the box.
# Command-line overrides reach the sub-make in prod-deploy through MAKEFLAGS.
ifeq ($(strip $(IMAGE_PREFIX)),)
PROD_IMAGES := prod-build
else
PROD_IMAGES := prod-pull
endif

# Server entrypoint for CI SSH (`cd /opt/nba && make prod-deploy`).
# Pull first, then re-invoke make so a newly pulled Makefile is used.
# Never `compose down -v` (wipes pgdata).
prod-deploy: ## Server: ff-only pull main, then prod-release
	git fetch origin main
	git checkout main
	git pull --ff-only origin main
	$(MAKE) prod-release

prod-release: $(PROD_IMAGES) ## Images, migrate, up, caddy reload, health gate, record tag, prune
	DOCKER_TARGET=runtime $(COMPOSE_PROD) up -d postgres --wait
	$(MAKE) prod-migrate
	$(MAKE) prod-up
	$(MAKE) prod-caddy-reload
	$(MAKE) prod-health
	$(MAKE) prod-record-deploy
	$(MAKE) prod-prune

# `caddy reload` cannot pick up a changed Caddyfile here. It is a single-file
# bind mount, and `git pull` replaces the file rather than editing it in place,
# so the container keeps reading the original inode and reloads stale config.
# Recreating rebinds the mount. `--no-deps` so this touches only Caddy: caddy
# depends_on api, and without it a recreate drags the whole chain along.
# Not prefixed with `-`: a routing change that silently fails to apply is worse
# than a deploy that stops and says so.
prod-caddy-reload: ## Recreate Caddy so a changed Caddyfile actually takes effect
	DOCKER_TARGET=runtime $(COMPOSE_PROD) up -d --force-recreate --no-deps caddy

# After prod-health on purpose: a deploy that never came up must not repoint
# tomorrow's cron at the images that failed it.
prod-record-deploy: ## Persist the deployed registry coordinates for cron and one-shot scripts
	@printf 'IMAGE_PREFIX ?= %s\nIMAGE_TAG ?= %s\n' '$(IMAGE_PREFIX)' '$(IMAGE_TAG)' > $(DEPLOY_ENV)
	@echo "prod-record-deploy: $(DEPLOY_ENV) -> IMAGE_PREFIX=$(IMAGE_PREFIX) IMAGE_TAG=$(IMAGE_TAG)"

# `--parallel 1` keeps the Next.js build (2-4GB peak) from racing the others.
prod-build: ## Build runtime images on this machine (on-box deploy path)
	DOCKER_TARGET=runtime $(COMPOSE_PROD) build --parallel 1 api frontend migrate mcp cube scraper dbt ml

prod-pull: ## Pull prebuilt runtime images (registry deploy path; needs IMAGE_PREFIX)
	$(COMPOSE_PROD) pull postgres caddy migrate api frontend mcp cube scraper dbt ml

# `compose run` resolves a tag from the local store and never contacts the
# registry, so a refresh between deploys would otherwise keep running whatever
# was cached. Cheap no-op when the digest already matches.
prod-pull-tools: ## Pull the one-shot images the refresh job runs
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-pull-tools requires IMAGE_PREFIX=ghcr.io/<owner>/" >&2; exit 1; }
	$(COMPOSE_PROD) pull migrate scraper dbt ml

prod-pipeline-status: ## Show the production scrape gate using registry images
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-pipeline-status requires IMAGE_PREFIX=ghcr.io/<owner>/" >&2; exit 1; }
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) pipeline-status

prod-pipeline-enable: ## Enable the production daily scrape gate
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-pipeline-enable requires IMAGE_PREFIX=ghcr.io/<owner>/" >&2; exit 1; }
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) pipeline-enable

prod-pipeline-disable: ## Disable the production daily scrape gate
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-pipeline-disable requires IMAGE_PREFIX=ghcr.io/<owner>/" >&2; exit 1; }
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) pipeline-disable

prod-refresh: ## Run the production scrape -> dbt -> ml job on the deployed registry images
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-refresh requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" FORCE=0 ./scripts/refresh-daily.sh

# --full-refresh because this target exists for changed model SQL, which is
# precisely when an incremental model must be rebuilt instead of appended to.
# Costs a full int_play_by_play_events rebuild (~2 min); that is the point.
prod-scrape: ## Production pipeline scrape only (no dbt, no ML)
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-scrape requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) scrape

prod-ml: ## Production Elo/logit scoring then the gold predictions copy
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-ml requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) ml

# Safe on real history: games that already have a live pregame prediction for a
# model version are skipped, so this only fills gaps (e.g. a new shadow model).
prod-ml-backfill: ## Production walk-forward backfill for the scorecard (SEASON=, LOGIT=1 as for ml-backfill)
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-ml-backfill requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) ml-backfill

prod-ml-train: ## Fit and persist the logit artifact in production; run deliberately, never on cron
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-ml-train requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" $(MAKE) ml-train

# Drains source.admin_jobs. Runs on the host (cron/systemd), never in a
# container: executing `make` needs the Docker socket, which the API must not
# have. See docs/operations.md.
admin-jobs: ## Claim and run one queued /admin job
	./scripts/admin-job-runner.sh

# Shell + SQL, so the parts worth testing (atomic claim, flock contention,
# reaping an abandoned job) only exist against a real database.
test-admin-jobs: ## E2E the admin job runner against the local stack
	./scripts/test-admin-jobs.sh

prod-admin-jobs: ## Claim and run one queued /admin job against the prod stack
	COMPOSE="$(COMPOSE_PROD)" ./scripts/admin-job-runner.sh

prod-dbt: ## Rebuild gold on the server without scraping (needed after new/changed dbt models)
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-dbt requires IMAGE_PREFIX=ghcr.io/<owner>/" >&2; exit 1; }
	@set +e; \
	DOCKER_TARGET=runtime $(COMPOSE_PROD) --profile tools run --rm --no-deps dbt sh -c \
		'dbt deps --profiles-dir . && dbt build --profiles-dir . --full-refresh'; \
	dbt_exit=$$?; \
	DOCKER_TARGET=runtime $(COMPOSE_PROD) --profile tools run --rm --no-deps scraper \
		python -m main pipeline record-dbt --dbt-exit $$dbt_exit --detail "make prod-dbt" \
		>/dev/null || true; \
	exit $$dbt_exit

prod-refresh-daily: prod-refresh ## Alias for prod-refresh

prod-refresh-daily-once: ## Force one production scrape -> dbt -> ml cycle
	@test -n "$(IMAGE_PREFIX)" || { echo "prod-refresh-daily-once requires IMAGE_PREFIX=ghcr.io/<owner>/ or a $(DEPLOY_ENV) written by prod-release" >&2; exit 1; }
	$(MAKE) prod-pull-tools
	COMPOSE="$(COMPOSE_PROD)" FORCE=1 ./scripts/refresh-daily.sh

# Intentionally does not need IMAGE_PREFIX or any tools image: it talks to the
# already-running postgres, so it still works when the thing that broke the
# refresh is the registry, the images, or the make target itself.
check-freshness: ## Alert if the daily refresh has not succeeded recently
	./scripts/check-freshness.sh

prod-check-freshness: ## Freshness check against the production stack
	COMPOSE="$(COMPOSE_PROD)" ./scripts/check-freshness.sh

# Local pg_dump backups (no object storage). Like check-freshness these need no
# tools image, only the running postgres. See docs/operations.md.
db-backup: ## pg_dump the warehouse to backups/ (verified, rotated)
	./scripts/backup-postgres.sh

prod-db-backup: ## pg_dump the production warehouse to backups/
	COMPOSE="$(COMPOSE_PROD)" ./scripts/backup-postgres.sh

db-restore-test: ## Restore a dump (DUMP=..., default newest) into a throwaway container and sanity-check it
	./scripts/restore-postgres.sh $(DUMP)

db-restore: ## Replace the live DB from DUMP=... (needs CONFIRM_RESTORE=RESTORE)
	RESTORE_TARGET=live ./scripts/restore-postgres.sh $(DUMP)

prod-db-restore: ## Replace the production DB from DUMP=... (needs CONFIRM_RESTORE=RESTORE)
	COMPOSE="$(COMPOSE_PROD)" RESTORE_TARGET=live ./scripts/restore-postgres.sh $(DUMP)

test-backups: ## E2E backup + restore against a throwaway compose project
	./scripts/test-backups.sh

# Probe from inside the compose network: a deploy must not depend on public DNS
# or on Caddy already holding a cert. Caddy's alpine image ships busybox wget.
define wait_ok
for i in $$(seq 1 20); do \
	if $(COMPOSE_PROD) exec -T caddy wget -q -O /dev/null -T 3 "$(1)"; then exit 0; fi; \
	sleep 3; \
done; \
echo "prod-health: $(2) never answered at $(1)" >&2; exit 1
endef

prod-health: ## Fail the deploy if api, frontend, cube, or mcp did not come back up
	@$(call wait_ok,http://api:8000/health,api)
	@$(call wait_ok,http://frontend:3000/,frontend)
	@for i in $$(seq 1 20); do \
		if $(COMPOSE_PROD) exec -T api python -c 'import http.client; c=http.client.HTTPConnection("cube", 4000, timeout=3); c.request("GET", "/cubejs-api/v1/meta"); raise SystemExit(0 if c.getresponse().status < 500 else 1)' >/dev/null 2>&1; then exit 0; fi; \
		sleep 3; \
	done; \
	echo "prod-health: cube never answered at http://cube:4000/cubejs-api/v1/meta" >&2; exit 1
	@for i in $$(seq 1 20); do \
		if $(COMPOSE_PROD) exec -T api python -c 'import socket; s=socket.create_connection(("mcp", 8000), timeout=3); s.close()' >/dev/null 2>&1; then exit 0; fi; \
		sleep 3; \
	done; \
	echo "prod-health: mcp never answered on mcp:8000" >&2; exit 1

# Dangling layers only. `-a` would delete the previous release's images and
# with them the fast rollback path.
prod-prune: ## Drop dangling layers left behind by the last build
	docker image prune -f

down: ## Stop Tilt and tear down compose resources (also drops the nba buildx builder)
	-$(TILT) down
	$(COMPOSE) --profile tools --profile cube --profile cron down --remove-orphans
	-./scripts/remove-buildx-builder.sh

stop: down

logs: ## Tail compose logs
	$(COMPOSE) logs -f

# Compose has no `platform:` pin — Docker builds for this machine's CPU.
# Include tools so `make build` covers the full image set (not only
# api/frontend/cube). refresh-daily rebuilds nba-scraper and nba-dbt.
# `--profile cube` is kept for older compose files that still profile Cube.
build: ## Build runtime images for this machine's CPU (amd64 or arm64)
	DOCKER_TARGET=$(DOCKER_TARGET) $(COMPOSE) --profile tools --profile cube build

# docker-container driver can emit a multi-arch manifest; classic `docker load`
# cannot. Without PUSH=1 the images stay in the buildx builder cache.
# Qemu: Docker Desktop usually has it; Linux may need:
#   docker run --privileged --rm tonistiigi/binfmt --install amd64,arm64
build-multiarch: ensure-buildx-builder ## Build linux/amd64 and linux/arm64 (buildx)
ifeq ($(PUSH),1)
ifeq ($(IMAGE_PREFIX),)
	$(error PUSH=1 requires IMAGE_PREFIX, e.g. IMAGE_PREFIX=ghcr.io/org/)
endif
endif
	DOCKER_TARGET=$(DOCKER_TARGET) \
	PLATFORMS=$(PLATFORMS) \
	IMAGE_PREFIX=$(IMAGE_PREFIX) \
	IMAGE_TAG=$(IMAGE_TAG) \
	NEXT_PUBLIC_API_URL=$(or $(NEXT_PUBLIC_API_URL),http://localhost:8000) \
	docker buildx bake --builder $(BUILDX_BUILDER) --file docker-bake.hcl \
		$(if $(filter 1,$(PUSH)),--push,)

ensure-buildx-builder:
	@if ! docker buildx inspect $(BUILDX_BUILDER) >/dev/null 2>&1; then \
		echo "Creating buildx builder $(BUILDX_BUILDER) (docker-container driver)"; \
		docker buildx create --name $(BUILDX_BUILDER) --driver docker-container --bootstrap; \
	fi

remove-buildx-builder: ## Remove the docker-container buildx builder (BuildKit) if it exists
	./scripts/remove-buildx-builder.sh

sync: ## Refresh uv locks for all Python services
	uv lock --python 3.14
	cd services/migrate && uv lock --python 3.14
	cd services/api && uv lock --python 3.14
	cd services/scraper && uv lock --python 3.14
	cd services/mcp && uv lock --python 3.14
	cd services/cube && uv lock --python 3.14
	cd services/ml && uv lock --python 3.14
	cd services/dbt && uv lock --python 3.13

db-migrate migrate: ## Apply Alembic source-schema revisions (does not recreate postgres)
	$(COMPOSE) run --rm --no-deps migrate alembic upgrade head

pipeline-status: ## Show source.scrape_pipeline gate flags (enabled, season_active)
	$(COMPOSE_RUN_TOOLS) scraper python -m main pipeline status

pipeline-enable: ## Enable daily scrape gate (season_active; reddit always runs when enabled)
	$(COMPOSE_RUN_TOOLS) scraper python -m main pipeline enable \
		--season-active --reason "Enabled via make pipeline-enable" \
		$(PIPELINE_FLAGS)

pipeline-disable: ## Disable scrape gate (safe default / off-season)
	$(COMPOSE_RUN_TOOLS) scraper python -m main pipeline disable

scrape: ## pipeline scrape honoring source.scrape_pipeline (does not run dbt)
	$(COMPOSE_RUN_TOOLS) scraper python -m main pipeline run-once $(if $(filter 1,$(FORCE)),--force,)

# Records the outcome so /admin reflects a standalone build. Without it the
# admin view keeps showing the last refresh-daily exit code and a fixed
# failure never clears. `|| true` on the recording: bookkeeping must not
# change the exit status of the build itself.
dbt: ## dbt deps + build (seed, models, and tests in DAG order; does not scrape)
	@set +e; \
	$(COMPOSE_RUN_TOOLS) dbt sh -c \
		'dbt deps --profiles-dir . && dbt build --profiles-dir .'; \
	dbt_exit=$$?; \
	$(COMPOSE_RUN_TOOLS) scraper python -m main pipeline record-dbt \
		--dbt-exit $$dbt_exit --detail "make dbt" >/dev/null || true; \
	exit $$dbt_exit

ml: ## Score Elo and logit (when trained) into source.game_predictions
	$(COMPOSE_RUN_TOOLS) ml python -m main score
	$(COMPOSE_RUN_TOOLS) dbt sh -c \
		'dbt deps --profiles-dir . && dbt run --profiles-dir . --select stg_game_predictions+'

# Deliberately not part of `ml` or the daily refresh: training on the shared box
# beside the always-on stack is how the refresh starts OOMing, and a model that
# retrains nightly is one whose output cannot be reproduced. See docs/ml.md.
ml-train: ## Fit logit v1 from silver.int_game_features and persist its artifact
	$(COMPOSE_RUN_TOOLS) ml python -m main train

ml-eval: ## Expanding-window logit v1 metrics against the Elo and always-home baselines
	$(COMPOSE_RUN_TOOLS) ml python -m main eval-logit

# fct_prediction_scorecard reads the source table directly, so `stg_game_predictions+`
# (what `ml` rebuilds) would miss it; select everything downstream of the source.
ml-backfill: ## Walk-forward pregame WP for past Finals so the scorecard grades them (SEASON=2025-26; LOGIT=1 adds logit, slow)
	$(COMPOSE_RUN_TOOLS) ml python -m main backfill $(if $(SEASON),--season $(SEASON),) \
		$(if $(filter 1,$(LOGIT)),--with-logit,)
	$(COMPOSE_RUN_TOOLS) dbt sh -c \
		'dbt deps --profiles-dir . && dbt run --profiles-dir . --select source:source.game_predictions+'

refresh: ## scrape then dbt then ml; bind-mounts host files; does not recreate postgres
	FORCE=0 ./scripts/refresh-daily.sh

refresh-daily: refresh ## alias for refresh

refresh-daily-once: ## Force one scrape→dbt→ml cycle; bind-mounts host files; does not recreate postgres
	FORCE=1 ./scripts/refresh-daily.sh

# Local only: there is deliberately no prod- variant. The seed clears the old
# demo rows first, so rerunning it rolls the fake schedule forward to today.
DEMO_PSQL = $(COMPOSE) exec -T postgres \
	sh -c 'psql -X -q -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -v ON_ERROR_STOP=1'

seed-demo: ## Fake upcoming games and odds for /schedule, plus real Elo backfill for /predictions (local only)
	cat scripts/demo/clean.sql scripts/demo/seed.sql | $(DEMO_PSQL)
	$(MAKE) dbt
	$(MAKE) ml
	$(MAKE) ml-backfill

seed-demo-clean: ## Delete everything seed-demo inserted, then rebuild gold
	$(DEMO_PSQL) < scripts/demo/clean.sql
	$(MAKE) dbt

# Every suite runs its integration tests inline: the Testcontainers fixtures skip
# themselves when Docker is not reachable, so there is nothing to deselect.
test: test-api test-scraper test-mcp test-cube test-ml test-migrate test-frontend test-dbt ## Run all automated suites (unit + integration + dbt e2e)

test-migrate: ## Alembic unit tests + upgrade head on throwaway Postgres
	cd services/migrate && uv sync --group dev && uv run pytest

quality: ## Repo pre-commit hooks on all files (ruff --fix fails CI if it leaves a dirty tree)
	@if [ ! -x services/frontend/node_modules/prettier/bin/prettier.cjs ]; then \
		cd services/frontend && npm ci; \
	fi
	uv run --group local pre-commit run --all-files

test-api: ## API tests with coverage (Testcontainers suites skip without Docker)
	cd services/api && uv sync --group dev && uv run pytest

test-scraper: ## Scraper tests with coverage (Testcontainers suites skip without Docker)
	cd services/scraper && uv sync --group dev && uv run pytest

test-mcp: ## MCP unit tests with coverage (Cube-only; never opens Postgres)
	cd services/mcp && uv sync --group dev && uv run pytest

test-cube: ## Cube schema unit tests with coverage
	cd services/cube && uv sync --group dev && uv run pytest

test-ml: ## ML Elo unit tests with coverage
	cd services/ml && uv sync --group dev && uv run pytest

test-frontend: ## Frontend unit tests with coverage
	cd services/frontend && npm install && npm run test:coverage

test-frontend-e2e: ## Frontend Playwright e2e
	cd services/frontend && npm install && npx playwright install chromium && CI=1 FORCE_COLOR=1 npm run test:e2e

test-dbt: ## dbt e2e against a seeded ephemeral Postgres
	COMPOSE_PROJECT_NAME=nba-e2e $(COMPOSE) -p nba-e2e -f docker-compose.e2e.yml build migrate dbt
	COMPOSE_PROJECT_NAME=nba-e2e $(COMPOSE) -p nba-e2e -f docker-compose.e2e.yml up -d postgres --wait
	COMPOSE_PROJECT_NAME=nba-e2e $(COMPOSE) -p nba-e2e -f docker-compose.e2e.yml run --rm migrate
	COMPOSE_PROJECT_NAME=nba-e2e $(COMPOSE) -p nba-e2e -f docker-compose.e2e.yml run --rm \
		--entrypoint bash dbt e2e/run.sh
	COMPOSE_PROJECT_NAME=nba-e2e $(COMPOSE) -p nba-e2e -f docker-compose.e2e.yml down -v --remove-orphans
