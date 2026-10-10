"""Accounts, chat quota, picks and feature flags against a real Postgres.

End to end through the HTTP layer: Alembic builds the account tables, the seeded
gold tables supply the schedule and odds, and every statement in
queries/account.py actually runs. The scripted-session unit tests cannot catch
a broken query, a missing constraint, or a race the database is meant to stop.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from ids import (
    GAME_SCHEDULE,
    GAME_SCHEDULE_TWO,
    MISSING_ID,
    PLAYER_CURRY,
    TEAM_GSW,
    TEAM_LAC,
    TEAM_LAL,
)
from services.nlp import llm_provider
from services.nlp.llm_client import LlmToolCall, LlmTurn, ScriptedLlmClient
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker
from test_nl_eval import FakeCubeAnalytics

from config import Settings, get_settings
from dependencies import get_cube_analytics, get_db
from main import create_app

pytestmark = pytest.mark.integration

ACCOUNTS_TOKEN = "integration-accounts-token"
ADMIN_TOKEN = "integration-admin-token"
ADMIN_AUTH = {"Authorization": f"Bearer {ADMIN_TOKEN}"}

GAME_WON = "00000000-0000-4000-8000-000000000301"
GAME_LOST = "00000000-0000-4000-8000-000000000302"
GAME_TIPPED = "00000000-0000-4000-8000-000000000303"
GAME_TONIGHT = "00000000-0000-4000-8000-000000000304"


def _settings(**overrides) -> Settings:
    values = {
        "accounts_api_token": ACCOUNTS_TOKEN,
        "admin_api_token": ADMIN_TOKEN,
        "nlp_llm_api_key": None,
        "chat_daily_limit": 3,
        "chat_global_daily_limit": 250,
        "chat_max_turns": 2,
        "chat_model_row_cap": 50,
    }
    return Settings(**{**values, **overrides})


@pytest.fixture(scope="module", autouse=True)
def extra_games(postgres_engine):
    """Finished and tipped-off games the shared seed does not carry."""
    rows = [
        # GSW 120, LAC 110: a GSW pick won.
        (GAME_WON, "CURRENT_DATE - 3", "NULL", "Final", 120, 110),
        # GSW 99, LAC 104: a GSW pick lost.
        (GAME_LOST, "CURRENT_DATE - 2", "NULL", "Final", 99, 104),
        # Still 'Scheduled' because the scrape has not caught up, but tip has passed.
        (GAME_TIPPED, "CURRENT_DATE - 1", "TIME '19:30'", "Scheduled", None, None),
    ]
    with postgres_engine.begin() as conn:
        for game_id, game_date, start_time, status, home_score, away_score in rows:
            conn.execute(
                text(
                    f"""
                    INSERT INTO gold.fct_games_schedule (
                        game_id, season, season_type, game_date, start_time_et, status,
                        home_team_id, home_team_abbreviation, home_team_name, home_score,
                        away_team_id, away_team_abbreviation, away_team_name, away_score
                    ) VALUES (
                        :game_id, '2024-25', 'Regular Season', {game_date}, {start_time}, :status,
                        :home, 'GSW', 'Golden State Warriors', :home_score,
                        :away, 'LAC', 'LA Clippers', :away_score
                    )
                    ON CONFLICT (game_id) DO NOTHING
                    """
                ),
                {
                    "game_id": game_id,
                    "status": status,
                    "home": TEAM_GSW,
                    "away": TEAM_LAC,
                    "home_score": home_score,
                    "away_score": away_score,
                },
            )
        # A game with a tip time still ahead of the clock, so the lock is read
        # from the time and not only from the date.
        conn.execute(
            text(
                """
                INSERT INTO gold.fct_games_schedule (
                    game_id, season, season_type, game_date, start_time_et, status,
                    home_team_id, home_team_abbreviation, home_team_name,
                    away_team_id, away_team_abbreviation, away_team_name
                ) VALUES (
                    :game_id, '2024-25', 'Regular Season', CURRENT_DATE + 30, TIME '19:30', 'Scheduled',
                    :home, 'GSW', 'Golden State Warriors', :away, 'LAC', 'LA Clippers'
                )
                ON CONFLICT (game_id) DO NOTHING
                """
            ),
            {"game_id": GAME_TONIGHT, "home": TEAM_GSW, "away": TEAM_LAC},
        )
    yield
    # The engine is shared by the whole session; other modules count these tables.
    with postgres_engine.begin() as conn:
        conn.execute(
            text("DELETE FROM gold.fct_games_schedule WHERE game_id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": [GAME_WON, GAME_LOST, GAME_TIPPED, GAME_TONIGHT]},
        )
        conn.execute(
            text("DELETE FROM gold.fct_game_predictions WHERE game_id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": [GAME_WON, GAME_LOST]},
        )
        conn.execute(text("TRUNCATE source.users CASCADE"))


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

        settings = _settings(**overrides)
        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_cube_analytics] = FakeCubeAnalytics
        return TestClient(app)

    return _make


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


@pytest.fixture(autouse=True)
def flags_on(postgres_engine):
    """Each test starts, and leaves, with every feature switched on."""
    yield
    with postgres_engine.begin() as conn:
        conn.execute(text("UPDATE source.feature_flags SET enabled = TRUE"))


def _server_headers(user_id: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {ACCOUNTS_TOKEN}"}
    if user_id:
        headers["X-Baseline-User"] = user_id
    return headers


def _sign_up(client: TestClient, provider: str = "github", name: str = "Pat") -> dict[str, str]:
    """Create a fresh account and return the headers the Next.js server would send."""
    response = client.post(
        "/api/v1/account/users",
        headers=_server_headers(),
        json={"provider": provider, "provider_subject": uuid4().hex, "display_name": name},
    )
    assert response.status_code == 200, response.text
    return _server_headers(response.json()["data"]["user_id"])


def _ask(client: TestClient, headers: dict[str, str], *questions: str):
    """Send a conversation whose user turns are `questions`, ending on the last."""
    messages: list[dict[str, str]] = []
    for index, question in enumerate(questions):
        if index:
            messages.append({"role": "assistant", "content": "Earlier answer."})
        messages.append({"role": "user", "content": question})
    return client.post("/api/v1/account/chat", headers=headers, json={"messages": messages})


# --- who is allowed in ------------------------------------------------------


def test_account_routes_fail_closed_without_a_configured_token(make_client) -> None:
    client = make_client(accounts_api_token=None)
    for method, path in [
        ("post", "/api/v1/account/users"),
        ("get", "/api/v1/account/me"),
        ("put", "/api/v1/account/me/timezone"),
        ("post", "/api/v1/account/chat"),
        ("get", "/api/v1/account/picks"),
    ]:
        response = getattr(client, method)(path, headers=_server_headers(str(uuid4())))
        assert response.status_code == 503, path


def test_account_routes_reject_a_missing_or_wrong_token(client) -> None:
    user_id = _sign_up(client)["X-Baseline-User"]
    assert client.get("/api/v1/account/me", headers={"X-Baseline-User": user_id}).status_code == 401
    wrong = {"Authorization": "Bearer nope", "X-Baseline-User": user_id}
    assert client.get("/api/v1/account/me", headers=wrong).status_code == 401
    # The admin token is a different privilege and does not open user routes.
    admin = {**ADMIN_AUTH, "X-Baseline-User": user_id}
    assert client.get("/api/v1/account/picks", headers=admin).status_code == 401


def test_the_user_header_is_required_and_must_name_a_real_account(client) -> None:
    assert client.get("/api/v1/account/me", headers=_server_headers()).status_code == 400
    assert (
        client.get("/api/v1/account/me", headers=_server_headers("not-a-uuid")).status_code == 400
    )
    assert client.get("/api/v1/account/me", headers=_server_headers(MISSING_ID)).status_code == 404


def test_signing_in_twice_returns_the_same_account(client) -> None:
    body = {"provider": "google", "provider_subject": uuid4().hex, "display_name": "First"}
    first = client.post("/api/v1/account/users", headers=_server_headers(), json=body).json()[
        "data"
    ]
    again = client.post(
        "/api/v1/account/users",
        headers=_server_headers(),
        json={**body, "display_name": "Renamed"},
    ).json()["data"]
    assert again["user_id"] == first["user_id"]
    assert again["display_name"] == "Renamed"
    assert again["status"] == "active"
    # The same subject id under the other provider is a different person.
    other = client.post(
        "/api/v1/account/users", headers=_server_headers(), json={**body, "provider": "github"}
    ).json()["data"]
    assert other["user_id"] != first["user_id"]


def test_a_time_zone_is_chosen_from_a_fixed_list_and_survives_signing_in_again(client) -> None:
    body = {"provider": "github", "provider_subject": uuid4().hex, "display_name": "Pat"}
    user_id = client.post("/api/v1/account/users", headers=_server_headers(), json=body).json()[
        "data"
    ]["user_id"]
    headers = _server_headers(user_id)
    # Unset is the site default, Eastern.
    assert (
        client.get("/api/v1/account/me", headers=headers).json()["data"]["user"]["timezone"] is None
    )

    saved = client.put(
        "/api/v1/account/me/timezone", headers=headers, json={"timezone": "America/Los_Angeles"}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["timezone"] == "America/Los_Angeles"

    # Sign-in rewrites the display name, and must leave the setting alone.
    again = client.post("/api/v1/account/users", headers=_server_headers(), json=body).json()[
        "data"
    ]
    assert again["timezone"] == "America/Los_Angeles"

    for refused in ("Mars/Olympus_Mons", "PST", ""):
        response = client.put(
            "/api/v1/account/me/timezone", headers=headers, json={"timezone": refused}
        )
        assert response.status_code == 422, refused
    assert client.put("/api/v1/account/me/timezone", headers=headers, json={}).status_code == 422

    cleared = client.put("/api/v1/account/me/timezone", headers=headers, json={"timezone": None})
    assert cleared.json()["data"]["timezone"] is None


def test_user_upsert_rejects_an_unknown_provider(client) -> None:
    response = client.post(
        "/api/v1/account/users",
        headers=_server_headers(),
        json={"provider": "myspace", "provider_subject": "1"},
    )
    assert response.status_code == 422


def test_no_email_column_exists_to_leak(postgres_engine) -> None:
    with postgres_engine.connect() as conn:
        columns = {
            row[0]
            for row in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema = 'source' AND table_name = 'users'"
                )
            )
        }
    assert "email" not in columns
    assert {"user_id", "provider", "provider_subject", "status"} <= columns


def test_a_blocked_account_is_refused_everywhere(client, postgres_engine) -> None:
    headers = _sign_up(client)
    with postgres_engine.begin() as conn:
        conn.execute(
            text("UPDATE source.users SET status = 'blocked' WHERE user_id = :user_id"),
            {"user_id": headers["X-Baseline-User"]},
        )
    assert client.get("/api/v1/account/me", headers=headers).status_code == 403
    assert _ask(client, headers, "What is Curry's salary?").status_code == 403
    assert client.get("/api/v1/account/picks", headers=headers).status_code == 403


# --- chat -------------------------------------------------------------------


def test_chat_answers_from_the_rules_backend_when_no_key_is_set(client) -> None:
    headers = _sign_up(client)
    response = _ask(client, headers, "What is Curry's salary?")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["backend"] == "rules"
    assert "55,772,427" in body["answer"]
    assert body["data"]
    assert body["quota"] == {
        "daily_limit": 3,
        "remaining": 2,
        "resets_at": body["quota"]["resets_at"],
        "max_turns": 2,
    }


def test_chat_quota_runs_out_and_says_so(client) -> None:
    headers = _sign_up(client)
    for expected_remaining in (2, 1, 0):
        response = _ask(client, headers, "What is Curry's salary?")
        assert response.status_code == 200
        assert response.json()["quota"]["remaining"] == expected_remaining
    over = _ask(client, headers, "What is Curry's salary?")
    assert over.status_code == 429
    assert "today's questions" in over.json()["detail"]
    profile = client.get("/api/v1/account/me", headers=headers).json()["data"]
    assert profile["chat"]["remaining"] == 0
    # One person's quota is not another's.
    assert _ask(client, _sign_up(client), "What is Curry's salary?").status_code == 200


def test_a_rejected_ask_does_not_spend_quota(client) -> None:
    headers = _sign_up(client)
    # Three questions against a two-question cap.
    full = _ask(client, headers, "one", "two", "three")
    assert full.status_code == 400
    assert "Start a new one" in full.json()["detail"]
    ends_on_answer = client.post(
        "/api/v1/account/chat",
        headers=headers,
        json={"messages": [{"role": "assistant", "content": "hello"}]},
    )
    assert ends_on_answer.status_code == 400
    assert (
        client.post("/api/v1/account/chat", headers=headers, json={"messages": []}).status_code
        == 422
    )
    remaining = client.get("/api/v1/account/me", headers=headers).json()["data"]["chat"][
        "remaining"
    ]
    assert remaining == 3


def test_only_one_ask_runs_at_a_time_per_user(client, postgres_engine) -> None:
    headers = _sign_up(client)
    user_id = headers["X-Baseline-User"]
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO source.chat_usage (user_id, usage_day) "
                "VALUES (:user_id, (NOW() AT TIME ZONE 'America/New_York')::date)"
            ),
            {"user_id": user_id},
        )
    assert _ask(client, headers, "What is Curry's salary?").status_code == 409

    # A request that died mid-flight must not hold the slot forever.
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE source.chat_usage SET asked_at = NOW() - INTERVAL '10 minutes' "
                "WHERE user_id = :user_id"
            ),
            {"user_id": user_id},
        )
    assert _ask(client, headers, "What is Curry's salary?").status_code == 200
    with postgres_engine.connect() as conn:
        outcomes = [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT outcome FROM source.chat_usage WHERE user_id = :user_id ORDER BY usage_id"
                ),
                {"user_id": user_id},
            )
        ]
    assert outcomes == ["errored", "answered"]


def _script_llm(monkeypatch, turns: list[LlmTurn]) -> ScriptedLlmClient:
    scripted = ScriptedLlmClient(turns)
    monkeypatch.setattr(llm_provider, "HttpLlmClient", lambda **_: scripted)
    return scripted


def _contract_turns() -> list[LlmTurn]:
    return [
        LlmTurn(
            content=None,
            tool_calls=[
                LlmToolCall(
                    id="1", name="get_player_contract", arguments={"player_id": PLAYER_CURRY}
                )
            ],
            input_tokens=900,
            output_tokens=40,
        ),
        LlmTurn(content="Curry is owed $55,772,427.", input_tokens=1100, output_tokens=60),
    ]


def test_chat_uses_the_model_once_a_key_is_set_and_logs_the_cost(
    make_client, monkeypatch, postgres_engine
) -> None:
    scripted = _script_llm(monkeypatch, _contract_turns())
    client = make_client(nlp_llm_api_key="sk-test", nlp_llm_model="test-model")
    headers = _sign_up(client)
    response = _ask(client, headers, "What is Curry owed?")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["backend"] == "llm"
    assert body["answer"] == "Curry is owed $55,772,427."
    assert body["data"][0]["current_season_salary"] == 55772427
    assert body["source"] == "cube tool get_player_contract"

    offered = {tool["function"]["name"] for tool in scripted.calls[0]["tools"]}
    assert "get_player_contract" in offered
    # Stranger-written text stays out of the chatbot's reach.
    assert "get_reddit_posts" not in offered

    with postgres_engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    "SELECT outcome, backend, model, input_tokens, output_tokens, tool_rounds, "
                    "latency_ms FROM source.chat_usage WHERE user_id = :user_id"
                ),
                {"user_id": headers["X-Baseline-User"]},
            )
            .mappings()
            .one()
        )
    assert dict(row) | {"latency_ms": None} == {
        "outcome": "answered",
        "backend": "llm",
        "model": "test-model",
        "input_tokens": 2000,
        "output_tokens": 100,
        "tool_rounds": 1,
        "latency_ms": None,
    }
    assert row["latency_ms"] is not None


def test_a_model_answer_with_no_rows_behind_it_is_replaced(
    make_client, monkeypatch, postgres_engine
) -> None:
    _script_llm(monkeypatch, [LlmTurn(content="The Lakers will win it all, trust me.")])
    client = make_client(nlp_llm_api_key="sk-test")
    headers = _sign_up(client)
    body = _ask(client, headers, "Who wins the title?").json()
    assert "trust me" not in body["answer"]
    assert body["answer"].startswith("I don't have that.")
    assert body["data"] == []
    with postgres_engine.connect() as conn:
        outcome = conn.execute(
            text("SELECT outcome FROM source.chat_usage WHERE user_id = :user_id"),
            {"user_id": headers["X-Baseline-User"]},
        ).scalar_one()
    assert outcome == "refused"


def test_the_shared_daily_budget_falls_back_to_rules(make_client, monkeypatch) -> None:
    scripted = _script_llm(monkeypatch, _contract_turns() + _contract_turns())
    client = make_client(nlp_llm_api_key="sk-test", chat_global_daily_limit=10_000)
    assert _ask(client, _sign_up(client), "What is Curry owed?").json()["backend"] == "llm"
    calls_before = len(scripted.calls)

    # At least one LLM ask is on the ledger today, so a budget of one is spent.
    capped = make_client(nlp_llm_api_key="sk-test", chat_global_daily_limit=1)
    body = _ask(capped, _sign_up(capped), "What is Curry's salary?").json()
    assert body["backend"] == "rules"
    assert "55,772,427" in body["answer"]
    assert len(scripted.calls) == calls_before


def test_a_provider_failure_is_a_502_that_names_no_internals(
    make_client, monkeypatch, postgres_engine
) -> None:
    class Exploding:
        def complete(self, **_):
            raise RuntimeError("LLM HTTP request failed: Authorization: Bearer sk-test")

    monkeypatch.setattr(llm_provider, "HttpLlmClient", lambda **_: Exploding())
    client = make_client(nlp_llm_api_key="sk-test")
    headers = _sign_up(client)
    response = _ask(client, headers, "What is Curry owed?")
    assert response.status_code == 502
    assert "sk-test" not in response.text
    # The failed ask is settled, so the next one is not refused as in flight.
    with postgres_engine.connect() as conn:
        outcome = conn.execute(
            text("SELECT outcome FROM source.chat_usage WHERE user_id = :user_id"),
            {"user_id": headers["X-Baseline-User"]},
        ).scalar_one()
    assert outcome == "errored"


def test_a_reply_that_will_not_parse_is_the_providers_fault_not_the_users(
    make_client, monkeypatch, postgres_engine
) -> None:
    """JSONDecodeError is a ValueError. It must not come back as a 400 with the parser's text."""

    class Garbled:
        def complete(self, **_):
            import json

            return json.loads("<html>502 Bad Gateway</html>")

    monkeypatch.setattr(llm_provider, "HttpLlmClient", lambda **_: Garbled())
    client = make_client(nlp_llm_api_key="sk-test")
    headers = _sign_up(client)
    response = _ask(client, headers, "What is Curry owed?")
    assert response.status_code == 502
    assert response.json()["detail"] == "The answer service did not respond. Try again in a moment."
    assert "Expecting value" not in response.text
    with postgres_engine.connect() as conn:
        outcome = conn.execute(
            text("SELECT outcome FROM source.chat_usage WHERE user_id = :user_id"),
            {"user_id": headers["X-Baseline-User"]},
        ).scalar_one()
    assert outcome == "errored"


def test_a_failure_before_the_model_is_chosen_still_frees_the_slot(
    make_client, monkeypatch, postgres_engine
) -> None:
    from repositories.account import AccountRepository

    def boom(self):
        raise RuntimeError("connection reset")

    # The shared budget is only read once a key is set.
    client = make_client(nlp_llm_api_key="sk-test", chat_global_daily_limit=0)
    headers = _sign_up(client)
    with monkeypatch.context() as patched:
        patched.setattr(AccountRepository, "count_llm_chat_today", boom)
        # A raw failure, as it would be in production; the client is told 502.
        assert _ask(client, headers, "What is Curry's salary?").status_code == 502
    with postgres_engine.connect() as conn:
        outcome = conn.execute(
            text("SELECT outcome FROM source.chat_usage WHERE user_id = :user_id"),
            {"user_id": headers["X-Baseline-User"]},
        ).scalar_one()
    # Settled, not left pending, so the next question is not refused as in flight.
    assert outcome == "errored"
    assert _ask(client, headers, "What is Curry's salary?").status_code == 200


def test_no_database_transaction_is_held_open_across_the_model_call(
    make_client, monkeypatch
) -> None:
    """A slow model must not sit on a pooled connection the public pages need."""
    from repositories.account import AccountRepository

    seen: list[bool] = []
    repos: list[AccountRepository] = []
    original_init = AccountRepository.__init__

    def tracking_init(self, db):
        original_init(self, db)
        repos.append(self)

    class Watching:
        def complete(self, **_):
            seen.extend(repo.db.in_transaction() for repo in repos)
            return LlmTurn(content="No tools used.")

    monkeypatch.setattr(AccountRepository, "__init__", tracking_init)
    monkeypatch.setattr(llm_provider, "HttpLlmClient", lambda **_: Watching())
    client = make_client(nlp_llm_api_key="sk-test")
    headers = _sign_up(client)
    repos.clear()
    assert _ask(client, headers, "What is Curry owed?").status_code == 200
    assert seen and not any(seen)


# --- feature flags ----------------------------------------------------------


def test_flags_are_listed_publicly_and_default_on(make_client) -> None:
    response = make_client(nlp_llm_api_key="sk-test").get("/api/v1/features")
    assert response.status_code == 200
    assert response.json()["data"] == {"chatbot": True, "picks": True}


def test_the_chatbot_is_not_offered_until_a_model_key_is_set(make_client) -> None:
    """No key means the site shows Ask instead of Chat, whatever the flag says."""
    for key in (None, "", "   "):
        features = make_client(nlp_llm_api_key=key).get("/api/v1/features").json()["data"]
        assert features == {"chatbot": False, "picks": True}


def test_admin_can_switch_the_chatbot_off_and_back_on(make_client, monkeypatch) -> None:
    _script_llm(monkeypatch, _contract_turns() + _contract_turns())
    client = make_client(nlp_llm_api_key="sk-test")
    headers = _sign_up(client)
    assert client.get("/api/v1/admin/flags").status_code == 401
    # A signed-in user's credentials are not admin credentials.
    assert client.put("/api/v1/admin/flags/chatbot", headers=headers, json={}).status_code == 401

    off = client.put(
        "/api/v1/admin/flags/chatbot",
        headers=ADMIN_AUTH,
        json={"enabled": False, "updated_by": "jyablonski"},
    )
    assert off.status_code == 200
    assert off.json()["data"]["enabled"] is False
    assert off.json()["data"]["updated_by"] == "jyablonski"
    assert client.get("/api/v1/features").json()["data"] == {"chatbot": False, "picks": True}

    blocked = _ask(client, headers, "What is Curry's salary?")
    assert blocked.status_code == 503
    assert "turned off" in blocked.json()["detail"]
    # Nothing was spent, and picks are untouched by the chatbot's switch.
    assert (
        client.get("/api/v1/account/me", headers=headers).json()["data"]["chat"]["remaining"] == 3
    )
    assert client.get("/api/v1/account/picks", headers=headers).status_code == 200
    # The public rules /ask is not behind the flag.
    assert (
        client.post("/api/v1/query", json={"question": "What is Curry's salary?"}).status_code
        == 200
    )

    listed = {
        flag["flag_key"]: flag
        for flag in client.get("/api/v1/admin/flags", headers=ADMIN_AUTH).json()
    }
    assert listed["chatbot"]["enabled"] is False
    assert listed["picks"]["enabled"] is True

    client.put(
        "/api/v1/admin/flags/chatbot",
        headers=ADMIN_AUTH,
        json={"enabled": True, "updated_by": "jyablonski"},
    )
    assert _ask(client, headers, "What is Curry's salary?").status_code == 200


def test_the_picks_flag_closes_every_picks_route(client) -> None:
    headers = _sign_up(client)
    client.put(
        "/api/v1/admin/flags/picks", headers=ADMIN_AUTH, json={"enabled": False, "updated_by": "me"}
    )
    assert client.get("/api/v1/account/picks", headers=headers).status_code == 503
    put = client.put(
        f"/api/v1/account/picks/{GAME_SCHEDULE}", headers=headers, json={"picked_team_id": TEAM_GSW}
    )
    assert put.status_code == 503
    assert (
        client.delete(f"/api/v1/account/picks/{GAME_SCHEDULE}", headers=headers).status_code == 503
    )


def test_an_unknown_flag_is_a_404_not_a_new_flag(client) -> None:
    response = client.put(
        "/api/v1/admin/flags/chatbto",
        headers=ADMIN_AUTH,
        json={"enabled": False, "updated_by": "me"},
    )
    assert response.status_code == 404
    assert "chatbto" not in client.get("/api/v1/features").json()["data"]


# --- picks ------------------------------------------------------------------


def _pick(client, headers, game_id, team_id, stake=None):
    body = {"picked_team_id": team_id}
    if stake is not None:
        body["stake"] = stake
    return client.put(f"/api/v1/account/picks/{game_id}", headers=headers, json=body)


def test_a_new_account_starts_with_no_picks(client) -> None:
    sheet = client.get("/api/v1/account/picks", headers=_sign_up(client)).json()["data"]
    assert sheet["picks"] == []
    assert sheet["summary"] == {
        "wins": 0,
        "losses": 0,
        "pending": 0,
        "net": 0,
        "staked_open": 0,
        "vs_model": 0,
        "model_games": 0,
    }


def test_pick_a_winner_then_change_then_remove(client) -> None:
    headers = _sign_up(client)
    made = _pick(client, headers, GAME_SCHEDULE, TEAM_GSW)
    assert made.status_code == 200, made.text
    sheet = made.json()["data"]
    assert len(sheet["picks"]) == 1
    pick = sheet["picks"][0]
    assert pick["picked_team_id"] == TEAM_GSW
    assert pick["result"] == "pending"
    # Both seeded books have the home side at -150.
    assert pick["moneyline"] == -150
    assert pick["home_team_abbreviation"] == "GSW"
    assert sheet["summary"]["pending"] == 1

    # Switching sides re-prices at the other side's line and replaces the row.
    changed = _pick(client, headers, GAME_SCHEDULE, TEAM_LAC).json()["data"]
    assert len(changed["picks"]) == 1
    assert changed["picks"][0]["picked_team_id"] == TEAM_LAC
    assert changed["picks"][0]["moneyline"] == 130

    removed = client.delete(f"/api/v1/account/picks/{GAME_SCHEDULE}", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["data"]["picks"] == []


def test_a_stake_is_optional_and_can_be_changed_or_dropped(client) -> None:
    headers = _sign_up(client)
    staked = _pick(client, headers, GAME_SCHEDULE, TEAM_GSW, stake=150).json()["data"]
    assert staked["picks"][0]["stake"] == 150
    assert staked["picks"][0]["moneyline"] == -150
    # Nothing is won or lost until the game ends.
    assert staked["picks"][0]["profit"] is None
    assert (staked["summary"]["net"], staked["summary"]["staked_open"]) == (0, 150)

    # Switching sides re-prices the stake at the other side's line.
    switched = _pick(client, headers, GAME_SCHEDULE, TEAM_LAC, stake=40).json()["data"]
    assert (switched["picks"][0]["stake"], switched["picks"][0]["moneyline"]) == (40, 130)
    assert switched["summary"]["staked_open"] == 40

    # Saving with no stake leaves a record-only pick.
    plain = _pick(client, headers, GAME_SCHEDULE, TEAM_LAC).json()["data"]
    assert plain["picks"][0]["stake"] is None
    assert plain["summary"]["staked_open"] == 0


def test_there_is_no_balance_to_run_out_of(client) -> None:
    """An account starts at nothing. Stakes are bounded per pick, not by a wallet."""
    headers = _sign_up(client)
    summary = client.get("/api/v1/account/picks", headers=headers).json()["data"]["summary"]
    for gone in ("balance", "available", "starting_balance"):
        assert gone not in summary
    assert summary["net"] == 0

    # The largest stake is allowed on a brand-new account: no pot is drawn down.
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_GSW, stake=1000).status_code == 200
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_GSW, stake=1001).status_code == 422
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_GSW, stake=0).status_code == 422
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_GSW, stake=-5).status_code == 422


def test_a_game_with_no_odds_takes_a_pick_but_no_stake(client) -> None:
    headers = _sign_up(client)
    plain = _pick(client, headers, GAME_SCHEDULE_TWO, TEAM_LAC)
    assert plain.status_code == 200
    assert plain.json()["data"]["picks"][0]["moneyline"] is None

    staked = _pick(client, headers, GAME_SCHEDULE_TWO, TEAM_LAC, stake=50)
    assert staked.status_code == 409
    assert "No moneyline" in staked.json()["detail"]


def test_the_database_refuses_a_stake_with_no_price(postgres_engine, client) -> None:
    headers = _sign_up(client)
    with (
        pytest.raises(Exception, match="picks_stake_needs_price_check"),
        postgres_engine.begin() as conn,
    ):
        conn.execute(
            text(
                "INSERT INTO source.picks (user_id, game_id, picked_team_id, stake) "
                "VALUES (:user_id, :game_id, :team_id, 10)"
            ),
            {"user_id": headers["X-Baseline-User"], "game_id": GAME_SCHEDULE, "team_id": TEAM_GSW},
        )


def test_picks_are_refused_for_a_bad_team_or_game(client) -> None:
    headers = _sign_up(client)
    wrong_team = _pick(client, headers, GAME_SCHEDULE, TEAM_LAL)
    assert wrong_team.status_code == 409
    assert "not playing" in wrong_team.json()["detail"]
    missing = _pick(client, headers, MISSING_ID, TEAM_GSW)
    assert missing.status_code == 409
    assert "not on the schedule" in missing.json()["detail"]
    assert _pick(client, headers, "not-a-uuid", TEAM_GSW).status_code == 422
    assert client.get("/api/v1/account/picks", headers=headers).json()["data"]["picks"] == []


def test_picks_lock_at_tip(client) -> None:
    headers = _sign_up(client)
    # A tip time in the future leaves the game open.
    assert _pick(client, headers, GAME_TONIGHT, TEAM_GSW).status_code == 200
    for game_id in (GAME_TIPPED, GAME_WON):
        late = _pick(client, headers, game_id, TEAM_GSW)
        assert late.status_code == 409, game_id
        assert "locked" in late.json()["detail"]


def test_a_locked_pick_cannot_be_withdrawn(client, postgres_engine) -> None:
    headers = _sign_up(client)
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO source.picks (user_id, game_id, picked_team_id, stake, moneyline) "
                "VALUES (:user_id, :game_id, :team_id, 100, -150)"
            ),
            {"user_id": headers["X-Baseline-User"], "game_id": GAME_TIPPED, "team_id": TEAM_GSW},
        )
    response = client.delete(f"/api/v1/account/picks/{GAME_TIPPED}", headers=headers)
    assert response.status_code == 409
    sheet = client.get("/api/v1/account/picks", headers=headers).json()["data"]
    assert len(sheet["picks"]) == 1


def test_finished_games_are_graded_and_stakes_settle_into_a_net(client, postgres_engine) -> None:
    headers = _sign_up(client)
    user_id = headers["X-Baseline-User"]
    picks = [
        # Won at -150: 100 staked wins 66.66.
        (GAME_WON, 100, -150),
        # Lost at +130: the 50 is gone.
        (GAME_LOST, 50, 130),
        # A game that has left the schedule: the stake counts for nothing.
        (MISSING_ID, 300, 110),
    ]
    with postgres_engine.begin() as conn:
        for game_id, stake, moneyline in picks:
            conn.execute(
                text(
                    "INSERT INTO source.picks (user_id, game_id, picked_team_id, stake, moneyline) "
                    "VALUES (:user_id, :game_id, :team_id, :stake, :moneyline)"
                ),
                {
                    "user_id": user_id,
                    "game_id": game_id,
                    "team_id": TEAM_GSW,
                    "stake": stake,
                    "moneyline": moneyline,
                },
            )
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_LAC, stake=200).status_code == 200

    sheet = client.get("/api/v1/account/picks", headers=headers).json()["data"]
    by_game = {pick["game_id"]: pick for pick in sheet["picks"]}
    assert (by_game[GAME_WON]["result"], by_game[GAME_WON]["profit"]) == ("won", 66.66)
    assert (by_game[GAME_LOST]["result"], by_game[GAME_LOST]["profit"]) == ("lost", -50)
    assert (by_game[MISSING_ID]["result"], by_game[MISSING_ID]["profit"]) == ("void", None)
    assert (by_game[GAME_SCHEDULE]["result"], by_game[GAME_SCHEDULE]["profit"]) == ("pending", None)
    assert by_game[GAME_WON]["home_score"] == 120
    # 66.66 won less 50 lost. The open 200 and the void 300 move nothing.
    assert sheet["summary"] == {
        "wins": 1,
        "losses": 1,
        "pending": 1,
        "net": 16.66,
        "staked_open": 200,
        "vs_model": 0,
        "model_games": 0,
    }


def test_one_users_picks_are_invisible_to_another(client) -> None:
    mine, theirs = _sign_up(client), _sign_up(client)
    assert _pick(client, mine, GAME_SCHEDULE, TEAM_GSW).status_code == 200
    assert client.get("/api/v1/account/picks", headers=theirs).json()["data"]["picks"] == []
    # And they cannot remove it by naming the game.
    client.delete(f"/api/v1/account/picks/{GAME_SCHEDULE}", headers=theirs)
    assert len(client.get("/api/v1/account/picks", headers=mine).json()["data"]["picks"]) == 1


def test_picks_are_scored_against_the_model(client, postgres_engine) -> None:
    headers = _sign_up(client)
    user_id = headers["X-Baseline-User"]
    with postgres_engine.begin() as conn:
        # The model had the home side (GSW) in both finished games: right in
        # GAME_WON, wrong in GAME_LOST.
        for game_id in (GAME_WON, GAME_LOST):
            conn.execute(
                text(
                    "INSERT INTO gold.fct_game_predictions (game_id, as_of, model_name, "
                    "model_version, home_team_id, away_team_id, model_wp, away_wp) "
                    "VALUES (:game_id, CURRENT_DATE - 5, 'elo', 'elo-v0', :home, :away, 0.7, 0.3) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"game_id": game_id, "home": TEAM_GSW, "away": TEAM_LAC},
            )
        # Took the road team both times: lost where the model was right, won
        # where it was wrong. Net zero over two games.
        for game_id in (GAME_WON, GAME_LOST):
            conn.execute(
                text(
                    "INSERT INTO source.picks (user_id, game_id, picked_team_id) "
                    "VALUES (:user_id, :game_id, :team_id)"
                ),
                {"user_id": user_id, "game_id": game_id, "team_id": TEAM_LAC},
            )
    # An open game the model has scored counts for nothing yet.
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_LAC).status_code == 200

    sheet = client.get("/api/v1/account/picks", headers=headers).json()["data"]
    by_game = {pick["game_id"]: pick for pick in sheet["picks"]}
    assert (by_game[GAME_WON]["result"], by_game[GAME_WON]["model_correct"]) == ("lost", True)
    assert (by_game[GAME_LOST]["result"], by_game[GAME_LOST]["model_correct"]) == ("won", False)
    assert by_game[GAME_SCHEDULE]["model_correct"] is None
    assert (sheet["summary"]["vs_model"], sheet["summary"]["model_games"]) == (0, 2)

    # Siding with the model where it was right no longer costs a game.
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE source.picks SET picked_team_id = :team_id "
                "WHERE user_id = :user_id AND game_id = :game_id"
            ),
            {"user_id": user_id, "game_id": GAME_WON, "team_id": TEAM_GSW},
        )
    summary = client.get("/api/v1/account/picks", headers=headers).json()["data"]["summary"]
    assert (summary["vs_model"], summary["model_games"]) == (1, 2)


# --- leaving ----------------------------------------------------------------


def test_deleting_an_account_takes_its_rows_with_it(client, postgres_engine) -> None:
    headers = _sign_up(client)
    user_id = headers["X-Baseline-User"]
    assert _ask(client, headers, "What is Curry's salary?").status_code == 200
    assert _pick(client, headers, GAME_SCHEDULE, TEAM_GSW).status_code == 200

    assert client.delete("/api/v1/account/me", headers=headers).status_code == 204
    assert client.get("/api/v1/account/me", headers=headers).status_code == 404
    with postgres_engine.connect() as conn:
        for table in ("users", "chat_usage", "picks"):
            count = conn.execute(
                text(f"SELECT count(*) FROM source.{table} WHERE user_id = :user_id"),
                {"user_id": user_id},
            ).scalar_one()
            assert count == 0, table
