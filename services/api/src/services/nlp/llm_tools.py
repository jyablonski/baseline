"""The shared named tools as LLM function schemas (same list as MCP). No gold SQL."""

from __future__ import annotations

from typing import Any

from baseline_analytics.operations import CubeAnalytics
from baseline_analytics.tools import TOOLS, TOOLS_BY_NAME, call_tool

# Still answered if a model names it; never offered.
_ALIASES = {"run_cube_query": "query_cube"}


def named_tool_schemas() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        }
        for tool in TOOLS
    ]


class NamedToolExecutor:
    """Run named tools against Cube. Never executes model SQL."""

    def __init__(self, cube: CubeAnalytics) -> None:
        self.cube = cube
        self.executed: list[str] = []

    def schemas(self) -> list[dict[str, Any]]:
        return named_tool_schemas()

    def execute(self, name: str, arguments: dict[str, Any] | None) -> dict[str, Any]:
        self.executed.append(name)
        name = _ALIASES.get(name, name)
        try:
            result = call_tool(self.cube, name, arguments)
        except Exception as exc:  # noqa: BLE001 — tool errors become model-visible JSON
            return {"ok": False, "error": str(exc)}
        spec = TOOLS_BY_NAME[name]
        if not spec.is_data:
            # Reference text for the model. Not "row"/"rows", so it is never
            # shown as the data behind an answer.
            return {"ok": True, "result": result}
        if isinstance(result, list):
            return {"ok": True, "rows": result}
        rows_key = spec.rows_key
        if rows_key and isinstance(result, dict):
            # {"season": ..., "players": [...]} -> the season beside "rows", so
            # the row cap and the answer's table treat it like any other list.
            summary = {key: value for key, value in result.items() if key != rows_key}
            return {"ok": True, **summary, "rows": result.get(rows_key) or []}
        return {"ok": True, "row": result}
