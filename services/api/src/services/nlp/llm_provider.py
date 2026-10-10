"""Opt-in LLM NLP backend: Cube meta system prompt + Cube-shaped tools. No SQL."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from baseline_analytics.errors import CubeError
from baseline_analytics.operations import CubeAnalytics
from services.nlp.llm_client import (
    HttpLlmClient,
    LlmClient,
    LlmNotConfiguredError,
    LlmTurn,
)
from services.nlp.llm_prompt import build_system_prompt
from services.nlp.llm_tools import NamedToolExecutor

from config import Settings
from schemas.game import QueryResponse

# One more than a schema lookup, a query, and a retry need before the answer.
MAX_TOOL_ROUNDS = 5
NOT_CONFIGURED = (
    "LLM backend is not configured (NLP_LLM_API_KEY is missing). "
    "Public /ask defaults to the rules backend (NLP_BACKEND=rules). "
    "Set NLP_BACKEND=llm and a provider key only in trusted environments."
)


# Left out of the signed-in chat: post titles and comments are text written by
# strangers, which is the easiest way to get instructions in front of the model.
CHAT_EXCLUDED_TOOLS = frozenset({"get_reddit_posts"})
# The same text is reachable through the generic tools, so those are refused
# too when a call names one of these cubes.
CHAT_EXCLUDED_CUBE_PREFIXES = ("reddit_",)
CHAT_CUBE_TOOLS = frozenset({"query_cube", "run_cube_query", "get_cube_schema"})
REDDIT_UNAVAILABLE = "Reddit posts and comments are not available here."

# Game dates and the chat quota's day are both Eastern.
EASTERN = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class LlmConversation:
    response: QueryResponse
    input_tokens: int = 0
    output_tokens: int = 0
    tool_rounds: int = 0


class LlmNlpProvider:
    def __init__(
        self,
        cube: CubeAnalytics,
        *,
        settings: Settings,
        client: LlmClient | None = None,
        chat: bool = False,
    ) -> None:
        self.settings = settings
        self._client = client
        self.cube = cube
        self.executor = NamedToolExecutor(cube)
        # Chat mode: a scoped prompt, no Reddit tool, and a cap on the rows the
        # model is handed. /ask keeps the full tool list and uncapped rows.
        self.chat = chat

    def classify(self, question: str) -> str:
        if not question.strip():
            return "refuse"
        if self._client is None and not self.settings.nlp_llm_api_key:
            return "refuse"
        return "llm"

    def answer(self, question: str, season: str | None = None) -> QueryResponse:
        text = question.strip()
        if not text:
            return QueryResponse(
                answer="Please provide a non-empty question.",
                data=[],
                sql=None,
            )
        return self.converse([{"role": "user", "content": text}], season=season).response

    def converse(self, history: list[dict[str, str]], season: str | None = None) -> LlmConversation:
        """Run the tool loop over a conversation ending on the user's question.

        Earlier turns are plain text: the tool results behind them are not
        resent, so a follow-up costs its own tool calls and nothing more.
        """
        turns = [dict(turn) for turn in history]
        if season:
            turns[-1]["content"] = f"{turns[-1]['content']}\n[Baseline header season: {season}]"
        try:
            client = self._resolve_client()
        except LlmNotConfiguredError:
            return LlmConversation(QueryResponse(answer=NOT_CONFIGURED, data=[], sql=None))

        try:
            system = build_system_prompt(
                self.cube.meta_index(CHAT_EXCLUDED_CUBE_PREFIXES if self.chat else ()),
                chat=self.chat,
                today=datetime.now(EASTERN).date(),
            )
        except CubeError as exc:
            return LlmConversation(QueryResponse(answer=str(exc), data=[], sql=None))

        messages: list[dict[str, Any]] = [{"role": "system", "content": system}, *turns]
        tools = self._tool_schemas()
        last_data: list[Any] = []
        last_sql: str | None = None
        input_tokens = output_tokens = tool_rounds = 0
        for _ in range(MAX_TOOL_ROUNDS):
            turn = client.complete(messages=messages, tools=tools)
            input_tokens += turn.input_tokens
            output_tokens += turn.output_tokens
            if turn.tool_calls:
                tool_rounds += 1
                messages.append(_assistant_tool_message(turn))
                for call in turn.tool_calls:
                    result = self._execute(call.name, call.arguments)
                    last_data, last_sql = _merge_tool_result(call.name, result, last_data, last_sql)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": json.dumps(self._for_model(result), default=str),
                        }
                    )
                continue
            return LlmConversation(
                QueryResponse(
                    answer=turn.content or "The model returned an empty answer.",
                    data=last_data,
                    sql=last_sql,
                ),
                input_tokens,
                output_tokens,
                tool_rounds,
            )
        return LlmConversation(
            QueryResponse(
                answer="The model exceeded the tool-call limit without a final answer.",
                data=last_data,
                sql=last_sql,
            ),
            input_tokens,
            output_tokens,
            tool_rounds,
        )

    def _tool_schemas(self) -> list[dict[str, Any]]:
        schemas = self.executor.schemas()
        if not self.chat:
            return schemas
        return [
            schema for schema in schemas if schema["function"]["name"] not in CHAT_EXCLUDED_TOOLS
        ]

    def _execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        # Withholding the schema is not enough: a model can still name a tool
        # it was never offered.
        if self.chat and name in CHAT_EXCLUDED_TOOLS:
            return {"ok": False, "error": f"Unknown tool '{name}'"}
        if self.chat and name in CHAT_CUBE_TOOLS and _names_excluded_cube(arguments):
            return {"ok": False, "error": REDDIT_UNAVAILABLE}
        return self.executor.execute(name, arguments)

    def _for_model(self, result: dict[str, Any]) -> dict[str, Any]:
        """Trim a tool result before it is carried through every later round.

        Row count is the largest lever on what an ask costs. The response to
        the browser is built from the untrimmed result.
        """
        cap = self.settings.chat_model_row_cap
        rows = result.get("rows")
        if not self.chat or not isinstance(rows, list) or len(rows) <= cap:
            return result
        return {**result, "rows": rows[:cap], "truncated_rows": len(rows) - cap}

    def _resolve_client(self) -> LlmClient:
        if self._client is not None:
            return self._client
        return HttpLlmClient(
            api_key=self.settings.nlp_llm_api_key,
            base_url=self.settings.nlp_llm_base_url,
            model=self.settings.nlp_llm_model,
            max_output_tokens=self.settings.nlp_llm_max_output_tokens,
            reasoning_effort=self.settings.nlp_llm_reasoning_effort,
        )


def _names_excluded_cube(value: Any) -> bool:
    """True when any string in a tool's arguments is a member of an excluded cube.

    Walks keys as well as values: Cube's `order` names its members as keys, and
    filters nest under and/or.
    """
    if isinstance(value, str):
        return value.startswith(CHAT_EXCLUDED_CUBE_PREFIXES)
    if isinstance(value, dict):
        return any(_names_excluded_cube(item) for pair in value.items() for item in pair)
    if isinstance(value, list):
        return any(_names_excluded_cube(item) for item in value)
    return False


def _assistant_tool_message(turn: LlmTurn) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": turn.content,
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(call.arguments),
                },
            }
            for call in turn.tool_calls
        ],
    }


def _merge_tool_result(
    name: str,
    result: dict[str, Any],
    last_data: list[Any],
    last_sql: str | None,
) -> tuple[list[Any], str | None]:
    if result.get("ok"):
        if "rows" in result and isinstance(result["rows"], list):
            last_data = result["rows"]
        elif "row" in result:
            last_data = [result["row"]]
        else:
            return last_data, last_sql
        last_sql = f"cube tool {name}"
    return last_data, last_sql
