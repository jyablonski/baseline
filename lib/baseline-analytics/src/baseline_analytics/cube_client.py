"""Cube REST client: /cubejs-api/v1/load and /meta. No SQL generation."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from typing import Any

from baseline_analytics.errors import (
    CUBE_DOWN,
    CubeQueryError,
    CubeUnavailableError,
    UnknownMemberError,
)

DEFAULT_TIMEOUT = 15
MAX_LIMIT = 500
_META_TTL_SECONDS = 60


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def cube_api_token(secret: str, ttl_seconds: int = 300) -> str:
    """HS256 JWT Cube expects for CUBEJS_API_SECRET."""
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64url(
        json.dumps({"iat": now, "exp": now + ttl_seconds}, separators=(",", ":")).encode()
    )
    signing = f"{header}.{payload}".encode()
    signature = _b64url(hmac.new(secret.encode(), signing, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def flatten_row(row: dict[str, Any]) -> dict[str, Any]:
    """Strip `cube.member` prefixes when the short name is unique."""
    flattened: dict[str, Any] = {}
    collisions: set[str] = set()
    for key, value in row.items():
        short = key.split(".")[-1] if isinstance(key, str) and "." in key else key
        if short in flattened and flattened[short] != value:
            collisions.add(str(short))
        else:
            flattened[short] = value
    if not collisions:
        return flattened
    cleaned = {key: value for key, value in flattened.items() if key not in collisions}
    for key, value in row.items():
        short = key.split(".")[-1] if isinstance(key, str) and "." in key else key
        if short in collisions:
            cleaned[key] = value
    return cleaned


def format_meta_summary(meta: dict[str, Any]) -> str:
    lines = [
        "# Cube semantic layer",
        "",
        "Use only these members. Do not invent SQL or gold table names.",
        "",
    ]
    for cube in meta.get("cubes") or []:
        name = cube.get("name") or "unknown"
        lines.append(f"## {name}")
        measures = [
            str(item.get("name")) for item in (cube.get("measures") or []) if item.get("name")
        ]
        dimensions = [
            str(item.get("name")) for item in (cube.get("dimensions") or []) if item.get("name")
        ]
        if measures:
            lines.append("Measures: " + ", ".join(measures))
        if dimensions:
            lines.append("Dimensions: " + ", ".join(dimensions))
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _collect_members(query: dict[str, Any]) -> list[str]:
    members: list[str] = []
    for key in ("measures", "dimensions", "segments"):
        for item in query.get(key) or []:
            if isinstance(item, str) and item.strip():
                members.append(item.strip())
    for item in query.get("timeDimensions") or []:
        if isinstance(item, dict) and item.get("dimension"):
            members.append(str(item["dimension"]))
    order = query.get("order")
    if isinstance(order, dict):
        members.extend(str(key) for key in order)
    elif isinstance(order, list):
        for item in order:
            if isinstance(item, list) and item:
                members.append(str(item[0]))
            elif isinstance(item, dict) and item.get("id"):
                members.append(str(item["id"]))
    members.extend(_filter_members(query.get("filters") or []))
    return members


def _filter_members(filters: Any) -> list[str]:
    found: list[str] = []
    if not isinstance(filters, list):
        return found
    for item in filters:
        if not isinstance(item, dict):
            continue
        if item.get("member"):
            found.append(str(item["member"]))
        for key in ("and", "or"):
            found.extend(_filter_members(item.get(key) or []))
    return found


def _brief(description: Any, limit: int = 100) -> str:
    """First sentence of a cube description, capped: the index is sent on every ask."""
    text = " ".join(str(description or "").split())
    first = text.split(". ")[0].rstrip(".")
    return first if len(first) <= limit else first[: limit - 1].rstrip() + "…"


def format_meta_index(meta: dict[str, Any], exclude_prefixes: tuple[str, ...] = ()) -> str:
    """Cube names with a one-line description each, and no members.

    A fraction of format_meta_summary's size. Members come from
    describe_cubes, for the cubes a question actually needs. Cubes whose name
    starts with one of exclude_prefixes are left out.
    """
    lines = ["# Cubes", ""]
    for cube in meta.get("cubes") or []:
        name = cube.get("name") or "unknown"
        if name.startswith(exclude_prefixes):
            continue
        brief = _brief(cube.get("description"))
        lines.append(f"- {name}: {brief}" if brief else f"- {name}")
    return "\n".join(lines) + "\n"


def describe_cubes(meta: dict[str, Any], names: list[str]) -> str:
    """Measures and dimensions, with types and any member notes, for the named cubes."""
    cubes = {str(cube.get("name")): cube for cube in meta.get("cubes") or []}
    wanted = [str(name).strip() for name in names if str(name).strip()]
    unknown = [name for name in wanted if name not in cubes]
    if unknown:
        raise UnknownMemberError(
            "Unknown cube(s): " + ", ".join(unknown) + ". Cubes: " + ", ".join(sorted(cubes)) + "."
        )
    lines: list[str] = []
    for name in wanted:
        cube = cubes[name]
        lines.append(f"## {name}")
        description = " ".join(str(cube.get("description") or "").split())
        if description:
            lines.append(description)
        notes: list[str] = []
        for label, key in (("Measures", "measures"), ("Dimensions", "dimensions")):
            members = [item for item in (cube.get(key) or []) if item.get("name")]
            if members:
                lines.append(
                    f"{label}: "
                    + ", ".join(
                        f"{item['name']} ({item['type']})" if item.get("type") else item["name"]
                        for item in members
                    )
                )
            notes.extend(
                f"- {item['name']}: {' '.join(str(item['description']).split())}"
                for item in members
                if item.get("description")
            )
        if notes:
            lines.append("Notes:")
            lines.extend(notes)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


class CubeClient:
    def __init__(
        self,
        base_url: str | None,
        api_secret: str | None = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        opener: Any | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_secret = api_secret
        self.timeout = timeout
        self._opener = opener or urllib.request.urlopen
        self._meta = meta
        self._meta_loaded_at = time.monotonic() if meta is not None else 0.0

    def require_configured(self) -> None:
        if not self.base_url:
            raise CubeUnavailableError(CUBE_DOWN)

    def members(self) -> set[str]:
        meta = self.meta()
        names: set[str] = set()
        for cube in meta.get("cubes") or []:
            for key in ("measures", "dimensions", "segments"):
                for item in cube.get(key) or []:
                    name = item.get("name") if isinstance(item, dict) else None
                    if name:
                        names.add(str(name))
        return names

    def meta(self) -> dict[str, Any]:
        if self._meta is not None and (time.monotonic() - self._meta_loaded_at) < _META_TTL_SECONDS:
            return self._meta
        payload = self._get("/cubejs-api/v1/meta")
        cubes = payload.get("cubes")
        if not isinstance(cubes, list):
            raise CubeQueryError("Cube meta response did not include cubes.")
        self._meta = payload
        self._meta_loaded_at = time.monotonic()
        return payload

    def meta_summary(self) -> str:
        return format_meta_summary(self.meta())

    def meta_index(self, exclude_prefixes: tuple[str, ...] = ()) -> str:
        return format_meta_index(self.meta(), exclude_prefixes)

    def describe_cubes(self, names: list[str]) -> str:
        return describe_cubes(self.meta(), names)

    def validate(self, query: dict[str, Any]) -> None:
        allowed = self.members()
        unknown = [name for name in _collect_members(query) if name not in allowed]
        if unknown:
            raise UnknownMemberError(
                "Unknown Cube member(s): "
                + ", ".join(unknown)
                + ". Use only measures and dimensions from Cube meta."
            )

    def load(self, query: dict[str, Any]) -> list[dict[str, Any]]:
        cleaned = self._normalize_query(query)
        self.validate(cleaned)
        payload = self._post("/cubejs-api/v1/load", {"query": cleaned})
        error = payload.get("error")
        if error:
            message = error if isinstance(error, str) else str(error.get("message") or error)
            raise CubeQueryError(f"Cube query failed: {message}")
        rows = payload.get("data")
        if not isinstance(rows, list):
            raise CubeQueryError("Cube load response did not include data.")
        return [flatten_row(row) if isinstance(row, dict) else row for row in rows]

    def _normalize_query(self, query: dict[str, Any]) -> dict[str, Any]:
        cleaned = dict(query)
        limit = cleaned.get("limit")
        if limit is None:
            cleaned["limit"] = MAX_LIMIT
        else:
            try:
                cleaned["limit"] = max(1, min(int(limit), MAX_LIMIT))
            except (TypeError, ValueError) as exc:
                raise CubeQueryError("Cube query limit must be an integer.") from exc
        return cleaned

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_secret:
            headers["Authorization"] = cube_api_token(self.api_secret)
        return headers

    def _get(self, path: str) -> dict[str, Any]:
        return self._request("GET", path, None)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", path, body)

    def _request(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        self.require_configured()
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
        try:
            with self._opener(request, timeout=self.timeout) as response:
                raw = response.read()
        except TimeoutError as exc:
            raise CubeUnavailableError(CUBE_DOWN) from exc
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
            if exc.code >= 500:
                raise CubeUnavailableError(CUBE_DOWN) from exc
            raise CubeQueryError(f"Cube HTTP {exc.code}: {detail or exc.reason}") from exc
        except (urllib.error.URLError, OSError) as exc:
            raise CubeUnavailableError(CUBE_DOWN) from exc
        try:
            payload = json.loads(raw.decode() if raw else "{}")
        except json.JSONDecodeError as exc:
            raise CubeQueryError("Cube returned a non-JSON response.") from exc
        if not isinstance(payload, dict):
            raise CubeQueryError("Cube returned a non-object JSON response.")
        return payload
