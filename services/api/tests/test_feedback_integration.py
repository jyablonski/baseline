"""Feedback against a real Postgres: the insert, both limits, and the admin list.

Alembic builds `source.feedback`; every statement in queries/feedback.py runs.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from config import Settings, get_settings
from dependencies import get_db
from main import create_app
from routers import feedback as feedback_router

pytestmark = pytest.mark.integration

ACCOUNTS_TOKEN = "integration-accounts-token"
ADMIN_TOKEN = "integration-admin-token"
ADMIN = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
VALID = {"kind": "bug", "message": "The standings table never finishes loading."}


def _server(ip: str = "198.51.100.1", user_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {ACCOUNTS_TOKEN}", "X-Baseline-Client-IP": ip}
    if user_id:
        headers["X-Baseline-User"] = user_id
    return headers


@pytest.fixture(autouse=True)
def clean(postgres_engine, monkeypatch):
    monkeypatch.setattr(feedback_router, "post_to_slack", lambda *_: None)
    yield
    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM source.feedback"))
        conn.execute(text("UPDATE source.feature_flags SET enabled = TRUE"))


@pytest.fixture
def make_client(postgres_engine):
    session_factory = sessionmaker(bind=postgres_engine, autocommit=False, autoflush=False)

    def _make(**overrides) -> TestClient:
        app = create_app()

        def override_db():
            db = session_factory()
            try:
                yield db
            finally:
                db.close()

        settings = Settings(
            **{
                "accounts_api_token": ACCOUNTS_TOKEN,
                "admin_api_token": ADMIN_TOKEN,
                "feedback_ip_hourly_limit": 2,
                "feedback_global_daily_limit": 100,
                **overrides,
            }
        )
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_settings] = lambda: settings
        return TestClient(app)

    return _make


def test_a_report_round_trips_to_the_admin_list(make_client, postgres_engine) -> None:
    client = make_client()
    sent = client.post(
        "/api/v1/feedback",
        headers=_server(),
        json={**VALID, "reply_email": "fan@example.com", "page_path": "/teams"},
    )
    assert sent.status_code == 201, sent.text

    listed = client.get("/api/v1/admin/feedback", headers=ADMIN).json()
    assert listed["meta"]["total"] == 1
    [report] = listed["data"]
    assert report["kind"] == "bug"
    assert report["message"] == VALID["message"]
    assert report["reply_email"] == "fan@example.com"
    assert report["page_path"] == "/teams"
    assert report["signed_in"] is False
    assert report["resolved_at"] is None
    assert "ip_hash" not in report

    with postgres_engine.connect() as conn:
        stored = conn.execute(text("SELECT ip_hash FROM source.feedback")).scalar_one()
    assert "198.51.100.1" not in stored
    assert len(stored) == 64


def test_the_hourly_limit_counts_each_address_separately(make_client) -> None:
    client = make_client()
    for _ in range(2):
        assert client.post("/api/v1/feedback", headers=_server(), json=VALID).status_code == 201
    assert client.post("/api/v1/feedback", headers=_server(), json=VALID).status_code == 429
    other = _server("198.51.100.2")
    assert client.post("/api/v1/feedback", headers=other, json=VALID).status_code == 201


def test_reports_older_than_an_hour_no_longer_count(make_client, postgres_engine) -> None:
    client = make_client()
    for _ in range(2):
        client.post("/api/v1/feedback", headers=_server(), json=VALID)
    with postgres_engine.begin() as conn:
        conn.execute(text("UPDATE source.feedback SET created_at = NOW() - INTERVAL '61 minutes'"))
    assert client.post("/api/v1/feedback", headers=_server(), json=VALID).status_code == 201


def test_the_daily_cap_counts_every_address(make_client) -> None:
    client = make_client(feedback_global_daily_limit=2)
    assert (
        client.post("/api/v1/feedback", headers=_server("1.1.1.1"), json=VALID).status_code == 201
    )
    assert (
        client.post("/api/v1/feedback", headers=_server("2.2.2.2"), json=VALID).status_code == 201
    )
    capped = client.post("/api/v1/feedback", headers=_server("3.3.3.3"), json=VALID)
    assert capped.status_code == 429
    assert "today" in capped.json()["detail"]


def test_a_honeypot_report_is_not_stored(make_client, postgres_engine) -> None:
    client = make_client()
    response = client.post("/api/v1/feedback", headers=_server(), json={**VALID, "website": "x"})
    assert response.status_code == 201
    with postgres_engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM source.feedback")).scalar_one() == 0


def test_a_signed_in_report_survives_deleting_the_account(make_client, postgres_engine) -> None:
    client = make_client()
    user = client.post(
        "/api/v1/account/users",
        headers={"Authorization": f"Bearer {ACCOUNTS_TOKEN}"},
        json={"provider": "github", "provider_subject": uuid4().hex, "display_name": "Pat"},
    ).json()["data"]
    client.post("/api/v1/feedback", headers=_server(user_id=user["user_id"]), json=VALID)
    [report] = client.get("/api/v1/admin/feedback", headers=ADMIN).json()["data"]
    assert report["signed_in"] is True

    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM source.users WHERE user_id = :id"), {"id": user["user_id"]})
    [report] = client.get("/api/v1/admin/feedback", headers=ADMIN).json()["data"]
    assert report["signed_in"] is False


def test_resolving_moves_a_report_out_of_the_open_list(make_client) -> None:
    client = make_client(feedback_ip_hourly_limit=10)
    for message in ("First report about a page.", "Second report about a page."):
        client.post("/api/v1/feedback", headers=_server(), json={**VALID, "message": message})
    newest, oldest = client.get("/api/v1/admin/feedback", headers=ADMIN).json()["data"]
    assert newest["message"] == "Second report about a page."

    resolved = client.put(
        f"/api/v1/admin/feedback/{newest['feedback_id']}", headers=ADMIN, json={"resolved": True}
    )
    first_resolved_at = resolved.json()["data"]["resolved_at"]
    assert first_resolved_at is not None
    # Resolving again keeps the first time.
    again = client.put(
        f"/api/v1/admin/feedback/{newest['feedback_id']}", headers=ADMIN, json={"resolved": True}
    )
    assert again.json()["data"]["resolved_at"] == first_resolved_at

    open_only = client.get("/api/v1/admin/feedback", headers=ADMIN).json()
    assert [row["feedback_id"] for row in open_only["data"]] == [oldest["feedback_id"]]
    assert open_only["meta"]["total"] == 1

    everything = client.get("/api/v1/admin/feedback?include_resolved=true", headers=ADMIN).json()
    # Open first, then resolved.
    assert [row["feedback_id"] for row in everything["data"]] == [
        oldest["feedback_id"],
        newest["feedback_id"],
    ]

    reopened = client.put(
        f"/api/v1/admin/feedback/{newest['feedback_id']}", headers=ADMIN, json={"resolved": False}
    )
    assert reopened.json()["data"]["resolved_at"] is None
    assert (
        client.put(
            f"/api/v1/admin/feedback/{uuid4()}", headers=ADMIN, json={"resolved": True}
        ).status_code
        == 404
    )


def test_the_feedback_flag_closes_the_form(make_client) -> None:
    client = make_client()
    assert client.get("/api/v1/features").json()["data"]["feedback"] is True
    client.put(
        "/api/v1/admin/flags/feedback", headers=ADMIN, json={"enabled": False, "updated_by": "me"}
    )
    assert client.get("/api/v1/features").json()["data"]["feedback"] is False
    assert client.post("/api/v1/feedback", headers=_server(), json=VALID).status_code == 503
