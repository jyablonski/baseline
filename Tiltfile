# Tilt local stack: hot-reload for app code, full rebuild on Dockerfile / lockfile changes.
# Production is compose + Caddy (`docker-compose.prod.yml`), not Tilt — see docs/plans/oci-caddy-hosting.md.
# Usage: `make up` (or `tilt up`) — postgres, migrate, cube, api, frontend, mcp.
# Optional compose profiles (do not enable by default; they start extra services):
#   tilt up -- --profiles tools (scraper, dbt, and ml)
#   tilt up -- --profiles tools --profiles cron
# docker_build has no platform pin — images match the host CPU (amd64 or arm64).

config.define_string_list("profiles")
cfg = config.parse()
profiles = []

# `tilt down` only (not Ctrl+C on `tilt up`). Drops the docker-container
# buildx builder so BuildKit does not outlive the compose stack.
if config.tilt_subcommand == "down":
    local("./scripts/remove-buildx-builder.sh")
for group in cfg.get("profiles", []):
    for name in group.split(","):
        name = name.strip()
        if name and name not in profiles:
            profiles.append(name)

docker_compose("./docker-compose.yml", profiles=profiles)

# --- Migrate (Alembic one-shot; source schema) -----------------------------
docker_build(
    "nba-migrate",
    context="./services/migrate",
    dockerfile="./services/migrate/Dockerfile",
    target="development",
    only=["migrations", "alembic.ini", "pyproject.toml", "uv.lock", "Dockerfile", ".python-version"],
    ignore=["**/__pycache__", "**/.pytest_cache", "**/.venv"],
)

# --- API (uvicorn --reload) -------------------------------------------------
docker_build(
    "nba-api",
    # Repo root: the image also needs lib/baseline-analytics. A change there
    # matches no sync below, so it rebuilds the image.
    context=".",
    dockerfile="./services/api/Dockerfile",
    target="development",
    only=[
        "services/api/src",
        "services/api/pyproject.toml",
        "services/api/uv.lock",
        "services/api/Dockerfile",
        "services/api/uvicorn-log-config.json",
        "services/api/.python-version",
        "lib/baseline-analytics",
    ],
    ignore=["**/__pycache__", "**/.pytest_cache", "**/htmlcov", "**/.venv"],
    live_update=[
        fall_back_on([
            "./services/api/Dockerfile",
            "./services/api/pyproject.toml",
            "./services/api/uv.lock",
        ]),
        sync("./services/api/src", "/app/src"),
    ],
)

# --- Frontend (next dev) ----------------------------------------------------
docker_build(
    "nba-frontend",
    context="./services/frontend",
    dockerfile="./services/frontend/Dockerfile",
    target="development",
    only=[
        "src",
        "public",
        "package.json",
        "package-lock.json",
        "next.config.ts",
        "tsconfig.json",
        "tsconfig.build.json",
        "postcss.config.mjs",
        "components.json",
        "eslint.config.mjs",
        "scripts",
        "Dockerfile",
    ],
    ignore=["**/node_modules", "**/.next", "**/coverage", "**/playwright-report", "**/test-results"],
    live_update=[
        fall_back_on([
            "./services/frontend/Dockerfile",
            "./services/frontend/package.json",
            "./services/frontend/package-lock.json",
        ]),
        sync("./services/frontend/src", "/app/src"),
        sync("./services/frontend/public", "/app/public"),
        sync("./services/frontend/next.config.ts", "/app/next.config.ts"),
        sync("./services/frontend/tsconfig.json", "/app/tsconfig.json"),
        sync("./services/frontend/tsconfig.build.json", "/app/tsconfig.build.json"),
        sync("./services/frontend/postcss.config.mjs", "/app/postcss.config.mjs"),
        sync("./services/frontend/components.json", "/app/components.json"),
        sync("./services/frontend/scripts", "/app/scripts"),
    ],
)

# Profiled images are omitted unless those compose profiles are requested.
# Default Tilt does not register scraper/dbt/ml or refresh-daily. MCP and Cube
# are on the default stack.
# `compose run --no-deps` still bind-mounts host models/src from docker-compose.yml
# (no rebuild after YAML/Python edits). live_update below only applies when the
# tools profile is on and those containers are running.

if "tools" in profiles or "cron" in profiles:
    docker_build(
        "nba-scraper",
        context="./services/scraper",
        dockerfile="./services/scraper/Dockerfile",
        target="development",
        only=["src", "pyproject.toml", "uv.lock", "Dockerfile", ".python-version"],
        ignore=["**/__pycache__", "**/.pytest_cache", "**/htmlcov", "**/.venv"],
        live_update=[
            fall_back_on([
                "./services/scraper/Dockerfile",
                "./services/scraper/pyproject.toml",
                "./services/scraper/uv.lock",
            ]),
            sync("./services/scraper/src", "/app/src"),
        ],
    )

if "tools" in profiles:
    docker_build(
        "nba-dbt",
        context="./services/dbt",
        dockerfile="./services/dbt/Dockerfile",
        target="development",
        only=[
            "models",
            "macros",
            "tests",
            "e2e",
            "dbt_project.yml",
            "packages.yml",
            "package-lock.yml",
            "profiles.yml",
            "pyproject.toml",
            "uv.lock",
            "Dockerfile",
            ".python-version",
            ".sqlfluffignore",
        ],
        ignore=[
            "**/__pycache__",
            "**/.pytest_cache",
            "**/htmlcov",
            "**/.venv",
            "**/target",
            "**/logs",
            "**/dbt_packages",
        ],
        live_update=[
            fall_back_on([
                "./services/dbt/Dockerfile",
                "./services/dbt/pyproject.toml",
                "./services/dbt/uv.lock",
                "./services/dbt/packages.yml",
                "./services/dbt/package-lock.yml",
            ]),
            sync("./services/dbt/models", "/app/models"),
            sync("./services/dbt/macros", "/app/macros"),
            sync("./services/dbt/tests", "/app/tests"),
            sync("./services/dbt/dbt_project.yml", "/app/dbt_project.yml"),
            sync("./services/dbt/profiles.yml", "/app/profiles.yml"),
            sync("./services/dbt/packages.yml", "/app/packages.yml"),
            sync("./services/dbt/e2e", "/app/e2e"),
        ],
    )

    docker_build(
        "nba-ml",
        context="./services/ml",
        dockerfile="./services/ml/Dockerfile",
        target="development",
        only=["src", "pyproject.toml", "uv.lock", "Dockerfile", ".python-version"],
        ignore=["**/__pycache__", "**/.pytest_cache", "**/htmlcov", "**/.venv"],
        live_update=[
            fall_back_on([
                "./services/ml/Dockerfile",
                "./services/ml/pyproject.toml",
                "./services/ml/uv.lock",
            ]),
            sync("./services/ml/src", "/app/src"),
        ],
    )
docker_build(
    "nba-mcp",
    # Repo root, like nba-api.
    context=".",
    dockerfile="./services/mcp/Dockerfile",
    target="development",
    only=[
        "services/mcp/src",
        "services/mcp/pyproject.toml",
        "services/mcp/uv.lock",
        "services/mcp/Dockerfile",
        "services/mcp/.python-version",
        "lib/baseline-analytics",
    ],
    ignore=["**/__pycache__", "**/.pytest_cache", "**/htmlcov", "**/.venv"],
    live_update=[
        fall_back_on([
            "./services/mcp/Dockerfile",
            "./services/mcp/pyproject.toml",
            "./services/mcp/uv.lock",
        ]),
        sync("./services/mcp/src", "/app/src"),
    ],
)

docker_build(
    "nba-cube",
    context="./services/cube",
    dockerfile="./services/cube/Dockerfile",
    target="development",
    only=["cube.js", "model", "Dockerfile"],
    ignore=["**/__pycache__", "**/.pytest_cache", "**/htmlcov", "**/.venv"],
    live_update=[
        fall_back_on(["./services/cube/Dockerfile"]),
        sync("./services/cube/cube.js", "/cube/conf/cube.js"),
        sync("./services/cube/model", "/cube/conf/model"),
    ],
)

dc_resource("postgres")
dc_resource("migrate", resource_deps=["postgres"])
dc_resource("cube", resource_deps=["migrate"])
dc_resource("api", resource_deps=["migrate"])
dc_resource("frontend", resource_deps=["api"])

dc_resource("mcp", resource_deps=["migrate"])

if "tools" in profiles:
    dc_resource("scraper", resource_deps=["migrate"])
    dc_resource("dbt", resource_deps=["migrate"])
    dc_resource("ml", resource_deps=["migrate"])

if "cron" in profiles:
    dc_resource("refresh-daily", resource_deps=["migrate"])
