"""The public feedback route and its admin views, with the repositories faked.

The SQL itself runs in test_feedback_integration.py.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from services.feedback import hash_ip, post_to_slack, slack_text

from config import Settings, get_settings
from dependencies import (
    get_account_repository,
    get_feedback_repository,
    get_flags_repository,
)
from main import create_app
from routers import feedback as feedback_router
from services import feedback as feedback_service

pytestmark = pytest.mark.unit

ACCOUNTS_TOKEN = "accounts-token"
ADMIN_TOKEN = "admin-token"
SERVER = {"Authorization": f"Bearer {ACCOUNTS_TOKEN}", "X-Baseline-Client-IP": "203.0.113.7"}
ADMIN = {"Authorization": f"Bearer {ADMIN_TOKEN}"}
VALID = {"kind": "data", "message": "Curry's 3PA looks doubled on the Nov 3 game."}


class FakeFeedbackRepository:
    def __init__(self, *, from_ip: int = 0, today: int = 0) -> None:
        self.from_ip = from_ip
        self.today = today
        self.inserted: list[dict] = []
        self.counted_hashes: list[str] = []
        self.listed: dict | None = None
        self.resolved: dict | None = None
        self.locked = False

    def lock_limits(self) -> None:
        self.locked = True

    def count_from_ip_last_hour(self, ip_hash: str) -> int:
        self.counted_hashes.append(ip_hash)
        return self.from_ip

    def count_today(self) -> int:
        return self.today

    def insert(self, **values) -> dict:
        self.inserted.append(values)
        return _row(
            kind=values["kind"],
            message=values["message"],
            page_path=values["page_path"],
            signed_in=values["user_id"] is not None,
        )

    def list_feedback(self, *, include_resolved: bool, limit: int, offset: int):
        self.listed = {"include_resolved": include_resolved, "limit": limit, "offset": offset}
        return [_row()], 1

    def set_resolved(self, feedback_id: UUID, *, resolved: bool):
        self.resolved = {"feedback_id": feedback_id, "resolved": resolved}
        if feedback_id.int == 0:
            return None
        return _row(feedback_id=feedback_id, resolved_at=datetime.now(UTC) if resolved else None)


class FakeFlags:
    def __init__(self, enabled: bool = True) -> None:
        self.enabled = enabled

    def is_enabled(self, flag_key: str) -> bool:
        return self.enabled


class FakeAccounts:
    def __init__(self, users: dict[UUID, dict] | None = None) -> None:
        self.users = users or {}

    def get_user(self, user_id: UUID) -> dict | None:
        return self.users.get(user_id)


def _row(**overrides) -> dict:
    row = {
        "feedback_id": uuid4(),
        "kind": "data",
        "message": "Something looks off here.",
        "reply_email": None,
        "page_path": "/data",
        "signed_in": False,
        "created_at": datetime.now(UTC),
        "resolved_at": None,
        "ip_hash": "x" * 64,
    }
    return {**row, **overrides}


@pytest.fixture
def slack_posts(monkeypatch) -> list[tuple]:
    posts: list[tuple] = []
    monkeypatch.setattr(feedback_router, "post_to_slack", lambda *args: posts.append(args))
    return posts


def _client(
    repo: FakeFeedbackRepository | None = None,
    *,
    flag: bool = True,
    accounts: FakeAccounts | None = None,
    **settings,
) -> tuple[TestClient, FakeFeedbackRepository]:
    app = create_app()
    fake = repo or FakeFeedbackRepository()
    values = {
        "accounts_api_token": ACCOUNTS_TOKEN,
        "admin_api_token": ADMIN_TOKEN,
        "feedback_ip_hourly_limit": 5,
        "feedback_global_daily_limit": 100,
        "slack_webhook_url": "https://hooks.slack.test/abc",
    }
    resolved = Settings(**{**values, **settings})
    app.dependency_overrides[get_feedback_repository] = lambda: fake
    app.dependency_overrides[get_flags_repository] = lambda: FakeFlags(flag)
    app.dependency_overrides[get_account_repository] = lambda: accounts or FakeAccounts()
    app.dependency_overrides[get_settings] = lambda: resolved
    return TestClient(app), fake


# --- sending -----------------------------------------------------------------


def test_a_report_is_stored_and_posted_to_slack(slack_posts) -> None:
    client, repo = _client()
    response = client.post(
        "/api/v1/feedback",
        headers=SERVER,
        json={**VALID, "reply_email": " me@example.com ", "page_path": "/data"},
    )
    assert response.status_code == 201
    assert response.json() == {"data": {"received": True}}
    assert repo.locked
    [stored] = repo.inserted
    assert stored["kind"] == "data"
    assert stored["reply_email"] == "me@example.com"
    assert stored["page_path"] == "/data"
    assert stored["user_id"] is None
    [(webhook, report)] = slack_posts
    assert webhook == "https://hooks.slack.test/abc"
    assert report["kind"] == "data"


def test_the_stored_hash_is_keyed_and_never_the_address(slack_posts) -> None:
    client, repo = _client()
    client.post("/api/v1/feedback", headers=SERVER, json=VALID)
    stored = repo.inserted[0]["ip_hash"]
    assert "203.0.113.7" not in stored
    assert len(stored) == 64
    assert stored == hash_ip("203.0.113.7", ACCOUNTS_TOKEN)
    assert stored != hash_ip("203.0.113.7", "another-key")
    assert repo.counted_hashes == [stored]


def test_a_filled_honeypot_looks_accepted_but_stores_nothing(slack_posts) -> None:
    client, repo = _client()
    response = client.post(
        "/api/v1/feedback", headers=SERVER, json={**VALID, "website": "http://spam"}
    )
    assert response.status_code == 201
    assert response.json() == {"data": {"received": True}}
    assert repo.inserted == []
    assert repo.counted_hashes == []
    assert slack_posts == []


@pytest.mark.parametrize(
    "body",
    [
        {**VALID, "message": "too short"},
        {**VALID, "message": "          padded          "},
        {**VALID, "message": "x" * 2001},
        {**VALID, "kind": "rant"},
        {**VALID, "reply_email": "not-an-email"},
        {**VALID, "page_path": "https://evil.example/"},
        {**VALID, "page_path": "//evil.example/"},
        {**VALID, "page_path": "data"},
    ],
)
def test_bad_reports_are_refused(body, slack_posts) -> None:
    client, repo = _client()
    response = client.post("/api/v1/feedback", headers=SERVER, json=body)
    assert response.status_code == 422
    assert repo.inserted == []


def test_a_message_is_trimmed_and_an_empty_email_is_none(slack_posts) -> None:
    client, repo = _client()
    client.post(
        "/api/v1/feedback",
        headers=SERVER,
        json={**VALID, "message": f"  {VALID['message']}  ", "reply_email": "  "},
    )
    assert repo.inserted[0]["message"] == VALID["message"]
    assert repo.inserted[0]["reply_email"] is None


def test_a_long_page_path_is_cut_to_fit(slack_posts) -> None:
    client, repo = _client()
    client.post("/api/v1/feedback", headers=SERVER, json={**VALID, "page_path": "/" + "a" * 900})
    assert len(repo.inserted[0]["page_path"]) == 512


def test_the_hourly_limit_per_address_is_a_429(slack_posts) -> None:
    client, repo = _client(FakeFeedbackRepository(from_ip=5))
    response = client.post("/api/v1/feedback", headers=SERVER, json=VALID)
    assert response.status_code == 429
    assert "hour" in response.json()["detail"]
    assert repo.inserted == []
    assert slack_posts == []


def test_the_daily_cap_is_a_429(slack_posts) -> None:
    client, repo = _client(FakeFeedbackRepository(from_ip=0, today=100))
    response = client.post("/api/v1/feedback", headers=SERVER, json=VALID)
    assert response.status_code == 429
    assert "today" in response.json()["detail"]
    assert repo.inserted == []


def test_the_client_address_is_required(slack_posts) -> None:
    client, repo = _client()
    response = client.post(
        "/api/v1/feedback",
        headers={"Authorization": SERVER["Authorization"]},
        json=VALID,
    )
    assert response.status_code == 400
    assert repo.inserted == []


def test_the_flag_turns_the_route_off(slack_posts) -> None:
    client, repo = _client(flag=False)
    response = client.post("/api/v1/feedback", headers=SERVER, json=VALID)
    assert response.status_code == 503
    assert "turned off" in response.json()["detail"]


@pytest.mark.parametrize("token", [None, "", "   "])
def test_the_route_fails_closed_without_the_accounts_token(token, slack_posts) -> None:
    client, _ = _client(accounts_api_token=token)
    assert client.post("/api/v1/feedback", headers=SERVER, json=VALID).status_code == 503


def test_a_browser_without_the_token_is_refused(slack_posts) -> None:
    client, repo = _client()
    response = client.post(
        "/api/v1/feedback", headers={"X-Baseline-Client-IP": "203.0.113.7"}, json=VALID
    )
    assert response.status_code == 401
    assert repo.inserted == []


def test_an_active_account_is_credited(slack_posts) -> None:
    user_id = uuid4()
    accounts = FakeAccounts({user_id: {"user_id": user_id, "status": "active"}})
    client, repo = _client(accounts=accounts)
    client.post("/api/v1/feedback", headers={**SERVER, "X-Baseline-User": str(user_id)}, json=VALID)
    assert repo.inserted[0]["user_id"] == user_id


@pytest.mark.parametrize("header", ["not-a-uuid", str(uuid4()), "blocked"])
def test_an_unknown_or_blocked_account_reports_anonymously(header, slack_posts) -> None:
    blocked = uuid4()
    accounts = FakeAccounts({blocked: {"user_id": blocked, "status": "blocked"}})
    client, repo = _client(accounts=accounts)
    user_header = str(blocked) if header == "blocked" else header
    response = client.post(
        "/api/v1/feedback", headers={**SERVER, "X-Baseline-User": user_header}, json=VALID
    )
    assert response.status_code == 201
    assert repo.inserted[0]["user_id"] is None


# --- Slack -------------------------------------------------------------------


def test_slack_text_cannot_ping_or_forge_links() -> None:
    text = slack_text(
        _row(message="<!channel> see <https://evil.example|Admin> & more", page_path="/x<y>")
    )
    assert "<!channel>" not in text
    assert "&lt;!channel&gt;" in text
    assert "<https://evil.example|Admin>" not in text
    assert "&amp; more" in text
    assert "/x&lt;y&gt;" in text


def test_slack_text_quotes_every_line_and_trims_long_messages() -> None:
    text = slack_text(_row(message="first\nsecond"))
    assert "> first\n> second" in text
    long = slack_text(_row(message="y" * 500, signed_in=True))
    assert "y" * 300 + "…" in long
    assert "y" * 301 not in long
    assert "signed in" in long


def test_slack_is_skipped_without_a_webhook(monkeypatch) -> None:
    def explode(*_args, **_kwargs):
        raise AssertionError("no HTTP without a webhook")

    monkeypatch.setattr(feedback_service.urllib.request, "urlopen", explode)
    post_to_slack(None, _row())
    post_to_slack("  ", _row())


def test_slack_posts_json_to_the_webhook(monkeypatch) -> None:
    sent: list = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

    def fake_urlopen(request, timeout):
        sent.append((request, timeout))
        return Response()

    monkeypatch.setattr(feedback_service.urllib.request, "urlopen", fake_urlopen)
    post_to_slack("https://hooks.slack.test/abc", _row(kind="bug"))
    [(request, timeout)] = sent
    assert request.full_url == "https://hooks.slack.test/abc"
    assert request.get_method() == "POST"
    assert json.loads(request.data)["text"].startswith("*Feedback: Bug*")
    assert timeout == feedback_service.SLACK_TIMEOUT_SECONDS


def test_a_slack_failure_is_swallowed(monkeypatch, caplog) -> None:
    def fail(*_args, **_kwargs):
        raise OSError("slack is down")

    monkeypatch.setattr(feedback_service.urllib.request, "urlopen", fail)
    with caplog.at_level("WARNING"):
        post_to_slack("https://hooks.slack.test/abc", _row())
    assert "OSError" in caplog.text
    assert "hooks.slack.test" not in caplog.text


# --- admin -------------------------------------------------------------------


def test_admin_feedback_routes_need_the_admin_token(slack_posts) -> None:
    client, _ = _client()
    assert client.get("/api/v1/admin/feedback").status_code == 401
    assert client.get("/api/v1/admin/feedback", headers=SERVER).status_code == 401
    assert (
        client.put(f"/api/v1/admin/feedback/{uuid4()}", json={"resolved": True}).status_code == 401
    )
    unconfigured, _ = _client(admin_api_token=None)
    assert unconfigured.get("/api/v1/admin/feedback", headers=ADMIN).status_code == 503


def test_admin_lists_reports_without_the_ip_hash(slack_posts) -> None:
    client, repo = _client()
    response = client.get(
        "/api/v1/admin/feedback?include_resolved=true&limit=10&offset=20", headers=ADMIN
    )
    assert response.status_code == 200
    body = response.json()
    assert body["meta"] == {"total": 1, "limit": 10, "offset": 20}
    assert "ip_hash" not in body["data"][0]
    assert repo.listed == {"include_resolved": True, "limit": 10, "offset": 20}


def test_admin_list_defaults_to_open_reports(slack_posts) -> None:
    client, repo = _client()
    client.get("/api/v1/admin/feedback", headers=ADMIN)
    assert repo.listed == {"include_resolved": False, "limit": 25, "offset": 0}


def test_admin_resolves_and_reopens(slack_posts) -> None:
    client, repo = _client()
    report_id = uuid4()
    resolved = client.put(
        f"/api/v1/admin/feedback/{report_id}", headers=ADMIN, json={"resolved": True}
    )
    assert resolved.status_code == 200
    assert resolved.json()["data"]["resolved_at"] is not None
    reopened = client.put(
        f"/api/v1/admin/feedback/{report_id}", headers=ADMIN, json={"resolved": False}
    )
    assert reopened.json()["data"]["resolved_at"] is None
    assert repo.resolved == {"feedback_id": report_id, "resolved": False}


def test_admin_resolving_an_unknown_report_is_a_404(slack_posts) -> None:
    client, _ = _client()
    response = client.put(
        f"/api/v1/admin/feedback/{UUID(int=0)}", headers=ADMIN, json={"resolved": True}
    )
    assert response.status_code == 404
