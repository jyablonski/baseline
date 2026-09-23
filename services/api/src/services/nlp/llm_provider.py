"""Opt-in LLM NLP backend: Cube meta system prompt + Cube-shaped tools. No SQL."""

from __future__ import annotations

import json
from typing import Any

from cube.analytics import CubeAnalytics
from cube.errors import CubeError
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

MAX_TOOL_ROUNDS = 4
NOT_CONFIGURED = (
    "LLM backend is not configured (NLP_LLM_API_KEY is missing). "
    "Public /ask defaults to the rules backend (NLP_BACKEND=rules). "
    "Set NLP_BACKEND=llm and a provider key only in trusted environments."
)


class LlmNlpProvider:
    def __init__(
        self,
        cube: CubeAnalytics,
        *,
        settings: Settings,
        client: LlmClient | None = None,
    ) -> None:
        self.settings = settings
        self._client = client
        self.cube = cube
        self.executor = NamedToolExecutor(cube)

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
        if season:
            text = f"{text}\n[Baseline header season: {season}]"
        try:
            client = self._resolve_client()
        except LlmNotConfiguredError:
            return QueryResponse(answer=NOT_CONFIGURED, data=[], sql=None)

        try:
            system = build_system_prompt(self.cube.meta_summary())
        except CubeError as exc:
            return QueryResponse(answer=str(exc), data=[], sql=None)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ]
        last_data: list[Any] = []
        last_sql: str | None = None
        for _ in range(MAX_TOOL_ROUNDS):
            turn = client.complete(messages=messages, tools=self.executor.schemas())
            if turn.tool_calls:
                messages.append(_assistant_tool_message(turn))
                for call in turn.tool_calls:
                    result = self.executor.execute(call.name, call.arguments)
                    last_data, last_sql = _merge_tool_result(call.name, result, last_data, last_sql)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": json.dumps(result, default=str),
                        }
                    )
                continue
            return QueryResponse(
                answer=turn.content or "The model returned an empty answer.",
                data=last_data,
                sql=last_sql,
            )
        return QueryResponse(
            answer="The model exceeded the tool-call limit without a final answer.",
            data=last_data,
            sql=last_sql,
        )

    def _resolve_client(self) -> LlmClient:
        if self._client is not None:
            return self._client
        return HttpLlmClient(
            api_key=self.settings.nlp_llm_api_key,
            base_url=self.settings.nlp_llm_base_url,
            model=self.settings.nlp_llm_model,
        )


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
        last_sql = f"cube tool {name}"
    return last_data, last_sql
