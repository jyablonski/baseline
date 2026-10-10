# syntax=docker/dockerfile:1.27.0
# Host-native by default (linux/amd64 or linux/arm64). python slim-bookworm and
# ghcr.io/astral-sh/uv:0.12.9 are multi-arch manifests — do not pin --platform.

FROM python:3.14.7-slim-bookworm AS builder
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
# Build context is the repo root, for lib/baseline-analytics. The builder
# mirrors the repo layout so the lockfile's ../../lib path resolves, and the
# venv is created at /app/.venv, where the later stages expect it.
WORKDIR /repo/services/mcp
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_PROJECT_ENVIRONMENT=/app/.venv
COPY services/mcp/pyproject.toml services/mcp/uv.lock ./
# Third-party packages first, so editing lib/ does not reinstall them.
RUN uv sync --frozen --no-dev --no-install-project --no-install-package baseline-analytics
COPY lib/baseline-analytics /repo/lib/baseline-analytics
# Not editable: the package is built into the venv, the only thing runtime copies.
RUN uv sync --frozen --no-dev --no-install-project --no-editable
COPY services/mcp/src /app/src

FROM python:3.14.7-slim-bookworm AS runtime
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
CMD ["python", "src/server.py"]

FROM builder AS development
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1
CMD ["python", "src/server.py"]
