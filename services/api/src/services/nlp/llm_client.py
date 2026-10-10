"""LLM HTTP client interface. No network unless a key is configured."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Protocol


class LlmNotConfiguredError(RuntimeError):
    """Raised before any HTTP call when the provider key is missing."""


@dataclass(frozen=True)
class LlmToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class LlmTurn:
    content: str | None
    tool_calls: list[LlmToolCall] = field(default_factory=list)
    # From the response's usage block; zero when the provider reports none.
    input_tokens: int = 0
    output_tokens: int = 0


class LlmClient(Protocol):
    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> LlmTurn: ...


def parse_tool_arguments(raw: Any) -> dict[str, Any]:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        if not raw.strip():
            return {}
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
        return {}
    return {}


class HttpLlmClient:
    """OpenAI-compatible /chat/completions client (stdlib urllib only)."""

    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        model: str,
        max_output_tokens: int | None = None,
        reasoning_effort: str | None = None,
        opener: Any | None = None,
    ) -> None:
        if not api_key:
            raise LlmNotConfiguredError("NLP_LLM_API_KEY is not set; refusing to call an LLM")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.max_output_tokens = max_output_tokens
        self.reasoning_effort = reasoning_effort
        self._opener = opener or urllib.request.urlopen

    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> LlmTurn:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
        }
        if self.max_output_tokens:
            payload["max_completion_tokens"] = self.max_output_tokens
        if self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort
        request = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with self._opener(request, timeout=30) as response:
                body = json.loads(response.read().decode())
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise RuntimeError(f"LLM HTTP request failed: {exc}") from exc
        return parse_chat_completion(body)


def _token_count(raw: Any) -> int:
    return raw if isinstance(raw, int) and raw > 0 else 0


def parse_chat_completion(body: dict[str, Any]) -> LlmTurn:
    usage = body.get("usage") or {}
    input_tokens = _token_count(usage.get("prompt_tokens"))
    output_tokens = _token_count(usage.get("completion_tokens"))
    choices = body.get("choices") or []
    if not choices:
        return LlmTurn(
            content=None,
            tool_calls=[],
            input_tokens=input_tokens,
            output_tokens=output_tokens,
        )
    message = choices[0].get("message") or {}
    raw_calls = message.get("tool_calls") or []
    calls: list[LlmToolCall] = []
    for index, raw in enumerate(raw_calls):
        function = raw.get("function") or {}
        calls.append(
            LlmToolCall(
                id=str(raw.get("id") or f"call_{index}"),
                name=str(function.get("name") or ""),
                arguments=parse_tool_arguments(function.get("arguments")),
            )
        )
    content = message.get("content")
    return LlmTurn(
        content=content if isinstance(content, str) else None,
        tool_calls=calls,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


class ScriptedLlmClient:
    """Deterministic test double: queued turns, no network."""

    def __init__(self, turns: list[LlmTurn]) -> None:
        self._turns = list(turns)
        self.calls: list[dict[str, Any]] = []

    def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> LlmTurn:
        self.calls.append({"messages": messages, "tools": tools})
        if not self._turns:
            return LlmTurn(content="The scripted model produced no further reply.")
        return self._turns.pop(0)
