# syntax=docker/dockerfile:1.28.0
# Host-native by default (linux/amd64 or linux/arm64). python slim-bookworm and
# ghcr.io/astral-sh/uv:0.12.9 are multi-arch manifests — do not pin --platform.

FROM python:3.13.14-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
# packages.yml + lock first so Hub downloads stay cached when models change.
# Dummy Postgres env satisfies profiles.yml; `dbt deps` does not connect.
COPY dbt_project.yml packages.yml package-lock.yml profiles.yml ./
RUN POSTGRES_HOST=localhost POSTGRES_USER=deps POSTGRES_PASSWORD=deps \
    POSTGRES_DB=deps .venv/bin/dbt deps --profiles-dir .
COPY macros ./macros
COPY models ./models
COPY seeds ./seeds
COPY tests ./tests
COPY e2e ./e2e
COPY .sqlfluffignore ./

FROM python:3.13.14-slim-bookworm AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/dbt_project.yml /app/packages.yml /app/package-lock.yml /app/profiles.yml ./
COPY --from=builder /app/dbt_packages ./dbt_packages
COPY --from=builder /app/macros ./macros
COPY --from=builder /app/models ./models
COPY --from=builder /app/seeds ./seeds
COPY --from=builder /app/tests ./tests
COPY --from=builder /app/e2e ./e2e
COPY --from=builder /app/.sqlfluffignore ./
CMD ["dbt", "--help"]

FROM builder AS development
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
RUN uv sync --frozen --no-install-project
CMD ["dbt", "--help"]
