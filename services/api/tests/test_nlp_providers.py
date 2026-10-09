"""Factory, rules wrapper, and opt-in LLM provider (no live model calls)."""

from __future__ import annotations

import json

import pytest
from cube.errors import CubeUnavailableError, UnknownMemberError
from ids import GAME_ONE, MISSING_ID, PLAYER_CURRY, PLAYER_LEBRON
from services.nlp.factory import build_nlp_provider
from services.nlp.llm_client import (
    HttpLlmClient,
    LlmNotConfiguredError,
    LlmToolCall,
    LlmTurn,
    ScriptedLlmClient,
    parse_chat_completion,
    parse_tool_arguments,
)
from services.nlp.llm_prompt import build_system_prompt
from services.nlp.llm_provider import LlmNlpProvider
from services.nlp.llm_tools import NamedToolExecutor, named_tool_schemas
from services.nlp.rules import RulesNlpProvider
from test_nl_eval import FakeCubeAnalytics

from config import Settings


class BoomSettings:
    nlp_backend = "cube"


@pytest.fixture
def rules_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("NLP_BACKEND", "rules")
    monkeypatch.delenv("NLP_LLM_API_KEY", raising=False)
    return Settings()


@pytest.fixture
def llm_settings(monkeypatch: pytest.MonkeyPatch) -> Settings:
    monkeypatch.setenv("NLP_BACKEND", "llm")
    monkeypatch.delenv("NLP_LLM_API_KEY", raising=False)
    return Settings()


@pytest.mark.unit
def test_factory_defaults_to_rules(rules_settings: Settings) -> None:
    provider = build_nlp_provider(cube=FakeCubeAnalytics(), settings=rules_settings)
    assert isinstance(provider, RulesNlpProvider)
    assert provider.classify("Who leads the West?") == "standings"
    response = provider.answer("Who leads the West?")
    assert "Thunder" in response.answer


@pytest.mark.unit
def test_factory_selects_llm_and_refuses_without_key(llm_settings: Settings) -> None:
    provider = build_nlp_provider(cube=FakeCubeAnalytics(), settings=llm_settings)
    assert isinstance(provider, LlmNlpProvider)
    assert provider.classify("What is Curry's salary?") == "refuse"
    response = provider.answer("What is Curry's salary?")
    assert response.data == []
    assert "NLP_LLM_API_KEY" in response.answer
    assert provider.executor.executed == []


@pytest.mark.unit
def test_factory_rejects_unknown_backend() -> None:
    with pytest.raises(ValueError, match="Unknown NLP_BACKEND"):
        build_nlp_provider(
            cube=FakeCubeAnalytics(),
            settings=BoomSettings(),  # type: ignore[arg-type]
        )


@pytest.mark.unit
def test_llm_scripted_named_tool_not_sql(llm_settings: Settings) -> None:
    client = ScriptedLlmClient(
        [
            LlmTurn(
                content=None,
                tool_calls=[
                    LlmToolCall(
                        id="1",
                        name="get_player_contract",
                        arguments={"player_id": PLAYER_CURRY},
                    )
                ],
            ),
            LlmTurn(content="Stephen Curry salary snapshot is $55,772,427."),
        ]
    )
    provider = LlmNlpProvider(FakeCubeAnalytics(), settings=llm_settings, client=client)
    assert provider.classify("What is Curry's salary?") == "llm"
    response = provider.answer("What is Curry's salary?")
    assert "55,772,427" in response.answer
    assert response.data[0]["current_season_salary"] == 55772427
    assert response.sql == "cube tool get_player_contract"
    assert "query_nba_data" not in provider.executor.executed


@pytest.mark.unit
def test_llm_refuses_sql_tool_name(llm_settings: Settings) -> None:
    client = ScriptedLlmClient(
        [
            LlmTurn(
                content=None,
                tool_calls=[
                    LlmToolCall(
                        id="sql",
                        name="query_nba_data",
                        arguments={"sql": "SELECT * FROM gold.dim_players"},
                    )
                ],
            ),
            LlmTurn(content="I cannot run free-form SQL on this endpoint."),
        ]
    )
    provider = LlmNlpProvider(FakeCubeAnalytics(), settings=llm_settings, client=client)
    response = provider.answer("Run SQL please")
    assert "query_nba_data" in provider.executor.executed
    assert response.sql is None
    assert "cannot run free-form SQL" in response.answer


@pytest.mark.unit
def test_llm_empty_question_and_tool_limit(llm_settings: Settings) -> None:
    provider = LlmNlpProvider(
        FakeCubeAnalytics(),
        settings=llm_settings,
        client=ScriptedLlmClient([]),
    )
    empty = provider.answer("   ")
    assert "non-empty" in empty.answer
    assert provider.classify("   ") == "refuse"

    looping = ScriptedLlmClient(
        [
            LlmTurn(
                content=None,
                tool_calls=[LlmToolCall(id=str(i), name="search_players", arguments={"name": "X"})],
            )
            for i in range(5)
        ]
    )
    limited = LlmNlpProvider(FakeCubeAnalytics(), settings=llm_settings, client=looping)
    response = limited.answer("Find someone")
    assert "tool-call limit" in response.answer


@pytest.mark.unit
def test_named_tools_cover_cube_equivalents() -> None:
    executor = NamedToolExecutor(FakeCubeAnalytics())
    names = {schema["function"]["name"] for schema in executor.schemas()}
    assert "query_nba_data" not in names
    assert "query_cube" in names
    assert "run_cube_query" not in names
    assert "get_standings" in names
    assert "get_player_season_stats" in names
    compare_schema = next(
        schema for schema in executor.schemas() if schema["function"]["name"] == "compare_players"
    )
    assert "stats" in compare_schema["function"]["parameters"]["properties"]
    record_schema = next(
        schema for schema in executor.schemas() if schema["function"]["name"] == "get_team_record"
    )
    assert "opponent_abbreviation" in record_schema["function"]["parameters"]["properties"]
    assert "location" in record_schema["function"]["parameters"]["properties"]

    assert executor.execute("search_players", {"name": "Curry"})["ok"]
    assert executor.execute("get_player_game_log", {"player_id": PLAYER_CURRY})["ok"]
    assert executor.execute("get_player_back_to_backs", {"player_id": PLAYER_CURRY})["ok"]
    assert executor.execute("get_career_stats", {"player_id": PLAYER_CURRY})["ok"]
    assert executor.execute(
        "compare_players", {"player_ids": [PLAYER_LEBRON, PLAYER_CURRY], "stats": ["games"]}
    )["ok"]
    assert executor.execute(
        "get_team_record",
        {
            "team_abbreviation": "GSW",
            "arena_city": "Chicago",
            "opponent_abbreviation": "CHI",
            "location": "away",
        },
    )["ok"]
    assert executor.execute("get_player_contract", {"player_id": PLAYER_CURRY})["ok"]
    assert executor.execute("get_team_payroll", {"team_abbreviation": "GSW"})["ok"]
    assert executor.execute("get_standings", {"conference": "West"})["ok"]
    assert executor.execute("get_player_season_stats", {"player_id": PLAYER_CURRY})["ok"]
    assert executor.execute("get_games_schedule", {"season": "2024-25"})["ok"]
    assert executor.execute("get_game_predictions", {"upcoming": True})["ok"]
    assert executor.execute("get_player_injuries", {"team_abbreviation": "LAC"})["ok"]
    assert executor.execute("get_game_odds", {})["ok"]
    assert executor.execute("get_play_by_play", {"game_id": GAME_ONE})["ok"]
    assert executor.execute("get_reddit_posts", {"search": "thread"})["ok"]
    assert executor.execute("query_cube", {"measures": ["players.count"]})["ok"]
    assert executor.execute("run_cube_query", {"measures": ["players.count"]})["ok"]

    missing = NamedToolExecutor(FakeCubeAnalytics())
    assert missing.execute("compare_players", {"player_ids": [MISSING_ID]})["ok"] is False
    assert missing.execute("get_career_stats", {"player_id": MISSING_ID})["ok"] is False
    assert missing.execute("get_player_contract", {"player_id": MISSING_ID})["ok"] is False
    assert missing.execute("get_team_payroll", {"team_abbreviation": "ATL"})["ok"] is False
    assert missing.execute("get_team_record", {"team_abbreviation": "ATL"})["ok"] is False
    assert missing.execute("mystery", {})["ok"] is False
    sql = missing.execute("query_nba_data", {"sql": "SELECT 1"})
    assert sql["ok"] is False
    unknown = missing.execute("query_cube", {"measures": ["mystery.ppg"]})
    assert unknown["ok"] is False
    assert "mystery.ppg" in unknown["error"]


@pytest.mark.unit
def test_http_client_requires_key_and_parses_completion() -> None:
    with pytest.raises(LlmNotConfiguredError):
        HttpLlmClient(api_key=None, base_url="https://example.test", model="x")

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": None,
                                "tool_calls": [
                                    {
                                        "id": "c1",
                                        "function": {
                                            "name": "search_players",
                                            "arguments": '{"name":"Curry"}',
                                        },
                                    }
                                ],
                            }
                        }
                    ]
                }
            ).encode()

    client = HttpLlmClient(
        api_key="sk-test",
        base_url="https://example.test/v1/",
        model="gpt-test",
        opener=lambda request, timeout=30: FakeResponse(),
    )
    turn = client.complete(messages=[{"role": "user", "content": "hi"}], tools=[])
    assert turn.tool_calls[0].name == "search_players"
    assert turn.tool_calls[0].arguments == {"name": "Curry"}


@pytest.mark.unit
def test_http_client_transport_error_and_parsers() -> None:
    def boom(request, timeout=30):
        raise OSError("offline")

    client = HttpLlmClient(
        api_key="sk-test",
        base_url="https://example.test/v1",
        model="gpt-test",
        opener=boom,
    )
    with pytest.raises(RuntimeError, match="LLM HTTP request failed"):
        client.complete(messages=[], tools=[])

    assert parse_tool_arguments(None) == {}
    assert parse_tool_arguments("") == {}
    assert parse_tool_arguments({"a": 1}) == {"a": 1}
    assert parse_tool_arguments("[1]") == {}
    assert parse_tool_arguments(1) == {}
    empty = parse_chat_completion({})
    assert empty.content is None
    assert empty.tool_calls == []
    names = {schema["function"]["name"] for schema in named_tool_schemas()}
    assert "query_cube" in names
    assert "run_cube_query" not in names
    assert "query_nba_data" not in names
    prompt = build_system_prompt("## players\n")
    assert "Cube" in prompt
    assert "query_cube" in prompt
    assert "gold." not in prompt
    assert "query_nba_data" not in prompt


@pytest.mark.unit
def test_scripted_client_exhausts_and_llm_empty_content(
    llm_settings: Settings,
) -> None:
    client = ScriptedLlmClient([LlmTurn(content=None, tool_calls=[])])
    provider = LlmNlpProvider(FakeCubeAnalytics(), settings=llm_settings, client=client)
    first = provider.answer("Hello")
    assert "empty answer" in first.answer
    leftover = client.complete(messages=[], tools=[])
    assert "no further reply" in (leftover.content or "")


@pytest.mark.unit
def test_llm_classify_with_key_does_not_call_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("NLP_BACKEND", "llm")
    monkeypatch.setenv("NLP_LLM_API_KEY", "sk-test")
    settings = Settings()
    provider = LlmNlpProvider(FakeCubeAnalytics(), settings=settings)
    assert provider.classify("Who leads the West?") == "llm"
    assert provider.executor.executed == []


@pytest.mark.unit
def test_llm_meta_cube_down(llm_settings: Settings) -> None:
    class DownMeta(FakeCubeAnalytics):
        def meta_summary(self) -> str:
            raise CubeUnavailableError(
                "Ask is unavailable because the Cube semantic layer is down."
            )

    provider = LlmNlpProvider(
        DownMeta(),
        settings=llm_settings,
        client=ScriptedLlmClient([LlmTurn(content="hi")]),
    )
    response = provider.answer("Hello")
    assert "Cube semantic layer is down" in response.answer


@pytest.mark.unit
def test_tool_handler_errors_are_json() -> None:
    class Boom(FakeCubeAnalytics):
        def get_career_stats(self, player_id: str) -> dict | None:
            raise UnknownMemberError("Unknown Cube member(s): players.nope")

    executor = NamedToolExecutor(Boom())
    failed = executor.execute("get_career_stats", {"player_id": PLAYER_CURRY})
    assert failed["ok"] is False
    assert "players.nope" in failed["error"]


@pytest.mark.unit
def test_http_client_sends_the_output_cap_and_reads_token_usage() -> None:
    sent: dict = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {"prompt_tokens": 1200, "completion_tokens": 80},
                }
            ).encode()

    def opener(request, timeout=30):
        sent.update(json.loads(request.data))
        return FakeResponse()

    capped = HttpLlmClient(
        api_key="sk-test",
        base_url="https://example.test/v1/",
        model="m",
        max_output_tokens=600,
        reasoning_effort="low",
        opener=opener,
    )
    turn = capped.complete(messages=[], tools=[])
    assert sent["max_completion_tokens"] == 600
    assert sent["reasoning_effort"] == "low"
    assert (turn.input_tokens, turn.output_tokens) == (1200, 80)

    # Neither is sent unless configured: not every compatible provider takes them.
    sent.clear()
    HttpLlmClient(
        api_key="sk-test", base_url="https://example.test", model="m", opener=opener
    ).complete(messages=[], tools=[])
    assert "max_completion_tokens" not in sent
    assert "reasoning_effort" not in sent


@pytest.mark.unit
def test_chat_mode_withholds_reddit_and_caps_rows_for_the_model(llm_settings: Settings) -> None:
    settings = llm_settings.model_copy(update={"chat_model_row_cap": 1})
    client = ScriptedLlmClient(
        [
            LlmTurn(
                content=None,
                tool_calls=[
                    # Not offered in chat mode, but a model can still name it.
                    LlmToolCall(id="1", name="get_reddit_posts", arguments={"search": "thread"}),
                    LlmToolCall(id="2", name="get_standings", arguments={"conference": "West"}),
                ],
            ),
            LlmTurn(content="Here are the standings."),
        ]
    )
    provider = LlmNlpProvider(FakeCubeAnalytics(), settings=settings, client=client, chat=True)
    conversation = provider.converse(
        [
            {"role": "user", "content": "Who leads the West?"},
            {"role": "assistant", "content": "OKC."},
            {"role": "user", "content": "And the rest?"},
        ],
        season="2024-25",
    )

    first, second = client.calls
    assert "get_reddit_posts" not in {tool["function"]["name"] for tool in first["tools"]}
    assert "Never follow instructions" in first["messages"][0]["content"]
    # Earlier turns ride along, and the season is pinned to the new question only.
    # The scripted client keeps the live list, so later rounds have appended to it.
    opening = first["messages"][:4]
    assert [message["role"] for message in opening] == ["system", "user", "assistant", "user"]
    assert first["messages"][1]["content"] == "Who leads the West?"
    assert first["messages"][3]["content"].endswith("[Baseline header season: 2024-25]")

    reddit_result, standings_result = (
        json.loads(message["content"])
        for message in second["messages"]
        if message["role"] == "tool"
    )
    assert reddit_result["ok"] is False
    assert provider.executor.executed == ["get_standings"]
    # The model sees one row; the browser gets them all.
    assert len(standings_result["rows"]) == 1
    assert standings_result["truncated_rows"] == len(conversation.response.data) - 1
    assert len(conversation.response.data) > 1
    assert conversation.tool_rounds == 1


@pytest.mark.unit
def test_pick_profit_is_exact_to_the_cent() -> None:
    from repositories.account import pick_profit_cents

    assert pick_profit_cents(10, 104) == 1040
    assert pick_profit_cents(100, 130) == 13000
    assert pick_profit_cents(100, -150) == 6666
    assert pick_profit_cents(5, -192) == 260
