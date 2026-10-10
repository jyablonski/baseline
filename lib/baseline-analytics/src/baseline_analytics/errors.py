"""Cube client errors. Ask/MCP surface these; they never fall back to gold SQL."""

from __future__ import annotations

CUBE_DOWN = (
    "Ask is unavailable because the Cube semantic layer is down. "
    "Set CUBE_API_URL (compose: http://cube:4000) and start Cube. "
    "There is no gold SQL fallback."
)


class CubeError(Exception):
    """Base error for governed Cube queries."""


class CubeUnavailableError(CubeError):
    """Cube is unreachable, unconfigured, or timed out."""


class CubeQueryError(CubeError):
    """Cube rejected or failed a validated query."""


class UnknownMemberError(CubeError):
    """Query referenced a measure, dimension, or filter member not in Cube meta."""
