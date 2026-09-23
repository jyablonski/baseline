"""Admin API auth and payload shape.

The admin routes expose operational data over a publicly reachable API, so
the auth behaviour matters more than the payload: the default must be closed.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from config import Settings, get_settings
from dependencies import get_admin_repository
from main import create_app
from repositories.admin import JobAlreadyPendingError

ADMIN_TOKEN = "test-admin-token"


class FakeAdminRepository:
    def get_health(self, run_limit: int = 20) -> dict:
        return {
            "pipeline": {
                "enabled": True,
                "season_active": True,
                "season_start": None,
                "season_end": None,
                "scrape_mode": "daily",
                "target_season": None,
                "last_success_at": None,
                "last_scrape_date": None,
                "reason": None,
                "updated_at": None,
                "action_today": "daily",
                "reddit_would_run": True,
                "hours_since_success": 3.5,
                "is_stale": False,
            },
            "sources": [
                {
                    "source_name": "standings",
                    "run_id": 1,
                    "status": "success",
                    "expectation": "not_checked",
                    "rows_written": 30,
                    "attempt": 1,
                    "error_type": None,
                    "error_detail": None,
                    "started_at": None,
                    "finished_at": None,
                    "last_success_at": None,
                    "unhealthy_streak": 0,
                }
            ],
            "freshness": [{"table_name": "games", "scraped_at": None, "row_count": 5}],
            "dbt": {
                "last_dbt_exit": 0,
                "last_dbt_run_at": None,
                "gold_tables": [{"table_name": "fct_team_game_results", "row_count": 10}],
                "gold_table_count": 1,
            },
            "ml": [
                {
                    "model_name": "elo",
                    "model_version": "elo-v0",
                    "prediction_count": 12,
                    "latest_as_of": None,
                    "latest_scraped_at": None,
                    "with_market_wp": 3,
                }
            ],
            "recent_runs": [],
            "jobs": [],
        }

    def get_recent_runs(self, limit: int = 20) -> list[dict]:
        return []

    def get_jobs(self, limit: int = 20) -> list[dict]:
        return []

    def enqueue_job(self, job_type: str, *, requested_by: str, detail=None) -> dict:
        if getattr(self, "pending", False):
            raise JobAlreadyPendingError("already pending")
        return {
            "job_id": 1,
            "job_type": job_type,
            "status": "queued",
            "requested_by": requested_by,
            "exit_code": None,
            "detail": None,
            "log_tail": None,
            "requested_at": None,
            "started_at": None,
            "finished_at": None,
        }


def _client(token: str | None) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_admin_repository] = lambda: FakeAdminRepository()
    app.dependency_overrides[get_settings] = lambda: Settings(admin_api_token=token)
    return TestClient(app)


@pytest.mark.unit
def test_admin_requires_a_token() -> None:
    response = _client(ADMIN_TOKEN).get("/api/v1/admin/health")
    assert response.status_code == 401


@pytest.mark.unit
def test_admin_rejects_a_wrong_token() -> None:
    response = _client(ADMIN_TOKEN).get(
        "/api/v1/admin/health", headers={"Authorization": "Bearer nope"}
    )
    assert response.status_code == 401


@pytest.mark.unit
def test_admin_rejects_a_non_bearer_scheme() -> None:
    response = _client(ADMIN_TOKEN).get(
        "/api/v1/admin/health", headers={"Authorization": f"Basic {ADMIN_TOKEN}"}
    )
    assert response.status_code == 401


@pytest.mark.unit
@pytest.mark.parametrize("token", [None, "", "   "])
def test_admin_fails_closed_when_unconfigured(token: str | None) -> None:
    """No ADMIN_API_TOKEN must disable the routes, never open them.

    This API is served publicly through Caddy, so an unset secret defaulting
    to "no auth required" would publish operational data to the internet.
    """
    response = _client(token).get("/api/v1/admin/health")
    assert response.status_code == 503

    # Not bypassable by presenting the empty value as a credential.
    bypass = _client(token).get("/api/v1/admin/health", headers={"Authorization": "Bearer "})
    assert bypass.status_code == 503


@pytest.mark.unit
def test_admin_health_payload_with_a_valid_token() -> None:
    response = _client(ADMIN_TOKEN).get(
        "/api/v1/admin/health", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["pipeline"]["action_today"] == "daily"
    assert body["pipeline"]["is_stale"] is False
    assert body["sources"][0]["source_name"] == "standings"
    assert body["dbt"]["last_dbt_exit"] == 0
    assert body["ml"][0]["model_version"] == "elo-v0"


@pytest.mark.unit
def test_admin_runs_is_also_gated() -> None:
    assert _client(ADMIN_TOKEN).get("/api/v1/admin/runs").status_code == 401
    ok = _client(ADMIN_TOKEN).get(
        "/api/v1/admin/runs", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}
    )
    assert ok.status_code == 200


@pytest.mark.unit
def test_enqueue_job_requires_auth_and_returns_202() -> None:
    client = _client(ADMIN_TOKEN)
    # Mutating endpoints must be gated exactly like the read ones.
    assert (
        client.post(
            "/api/v1/admin/jobs", json={"job_type": "dbt", "requested_by": "someone"}
        ).status_code
        == 401
    )

    response = client.post(
        "/api/v1/admin/jobs",
        json={"job_type": "dbt", "requested_by": "jyablonski"},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    )
    # 202 rather than 200: nothing has run yet, a host runner picks it up.
    assert response.status_code == 202
    body = response.json()["data"]
    assert body["job_type"] == "dbt"
    assert body["status"] == "queued"
    assert body["requested_by"] == "jyablonski"


@pytest.mark.unit
def test_enqueue_job_rejects_an_unknown_type() -> None:
    """Unknown types are refused at the edge, not at the CHECK constraint."""
    response = _client(ADMIN_TOKEN).post(
        "/api/v1/admin/jobs",
        json={"job_type": "rm-rf", "requested_by": "jyablonski"},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    )
    assert response.status_code == 422


@pytest.mark.unit
def test_enqueue_job_conflicts_when_one_is_pending() -> None:
    app = create_app()
    repo = FakeAdminRepository()
    repo.pending = True
    app.dependency_overrides[get_admin_repository] = lambda: repo
    app.dependency_overrides[get_settings] = lambda: Settings(admin_api_token=ADMIN_TOKEN)
    response = TestClient(app).post(
        "/api/v1/admin/jobs",
        json={"job_type": "refresh", "requested_by": "jyablonski"},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
    )
    assert response.status_code == 409


@pytest.mark.unit
def test_jobs_listing_is_gated() -> None:
    assert _client(ADMIN_TOKEN).get("/api/v1/admin/jobs").status_code == 401
    ok = _client(ADMIN_TOKEN).get(
        "/api/v1/admin/jobs", headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}
    )
    assert ok.status_code == 200
