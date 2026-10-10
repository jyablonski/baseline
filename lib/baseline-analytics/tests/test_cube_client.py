"""Cube REST client unit tests (mocked HTTP; no live Cube)."""

from __future__ import annotations

import json

import pytest
from baseline_analytics.cube_client import (
    CubeClient,
    cube_api_token,
    describe_cubes,
    flatten_row,
    format_meta_index,
    format_meta_summary,
)
from baseline_analytics.errors import (
    CUBE_DOWN,
    CubeQueryError,
    CubeUnavailableError,
    UnknownMemberError,
)

SAMPLE_META = {
    "cubes": [
        {
            "name": "players",
            "measures": [{"name": "players.count"}],
            "dimensions": [{"name": "players.full_name"}, {"name": "players.player_id"}],
        }
    ]
}


class FakeResponse:
    def __init__(self, payload: dict | bytes, status: int = 200):
        self._payload = payload
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None

    def read(self) -> bytes:
        if isinstance(self._payload, bytes):
            return self._payload
        return json.dumps(self._payload).encode()


class ScriptedOpener:
    def __init__(self, responses: list):
        self.responses = list(responses)
        self.requests: list = []

    def __call__(self, request, timeout=15):
        self.requests.append((request, timeout))
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.mark.unit
def test_load_happy_path_flattens_rows() -> None:
    opener = ScriptedOpener(
        [
            FakeResponse(SAMPLE_META),
            FakeResponse(
                {
                    "data": [
                        {"players.full_name": "Stephen Curry", "players.count": 1},
                    ]
                }
            ),
        ]
    )
    client = CubeClient("http://cube:4000", "secret", opener=opener)
    rows = client.load(
        {
            "measures": ["players.count"],
            "dimensions": ["players.full_name"],
            "limit": 10,
        }
    )
    assert rows == [{"full_name": "Stephen Curry", "count": 1}]
    assert opener.requests[1][1] == 15
    auth = opener.requests[1][0].headers.get("Authorization")
    assert auth
    assert cube_api_token("secret").count(".") == 2


@pytest.mark.unit
def test_unknown_measure_rejected_before_load() -> None:
    client = CubeClient("http://cube:4000", "secret", meta=SAMPLE_META)
    with pytest.raises(UnknownMemberError, match="players.ppg"):
        client.load({"measures": ["players.ppg"]})


@pytest.mark.unit
def test_cube_down_is_clear_error() -> None:
    opener = ScriptedOpener([OSError("connection refused")])
    client = CubeClient("http://cube:4000", "secret", opener=opener)
    with pytest.raises(CubeUnavailableError, match="no gold SQL fallback"):
        client.meta()

    missing = CubeClient(None, None)
    with pytest.raises(CubeUnavailableError, match="no gold SQL fallback"):
        missing.require_configured()
    assert "CUBE_API_URL" in CUBE_DOWN


@pytest.mark.unit
def test_http_errors_and_cube_query_error() -> None:
    import urllib.error

    opener = ScriptedOpener(
        [
            FakeResponse(SAMPLE_META),
            FakeResponse({"error": "Join failed"}),
        ]
    )
    client = CubeClient("http://cube:4000", None, opener=opener)
    with pytest.raises(CubeQueryError, match="Join failed"):
        client.load({"measures": ["players.count"]})

    def boom(request, timeout=15):
        raise urllib.error.HTTPError(
            url="http://cube:4000/cubejs-api/v1/meta",
            code=503,
            msg="down",
            hdrs=None,
            fp=None,
        )

    down = CubeClient("http://cube:4000", None, opener=boom)
    with pytest.raises(CubeUnavailableError):
        down.meta()


@pytest.mark.unit
def test_flatten_collisions_and_meta_summary() -> None:
    row = {
        "players.full_name": "A",
        "teams.full_name": "B",
        "players.player_id": 1,
    }
    flat = flatten_row(row)
    assert flat["players.full_name"] == "A"
    assert flat["teams.full_name"] == "B"
    assert flat["player_id"] == 1
    summary = format_meta_summary(SAMPLE_META)
    assert "## players" in summary
    assert "players.count" in summary
    assert "gold." not in summary


@pytest.mark.unit
def test_nested_filter_validation_and_limit_cap() -> None:
    client = CubeClient("http://cube:4000", None, meta=SAMPLE_META)
    with pytest.raises(UnknownMemberError, match="games.season"):
        client.validate(
            {
                "filters": [
                    {
                        "or": [
                            {"member": "players.full_name", "operator": "equals", "values": ["X"]},
                            {"member": "games.season", "operator": "equals", "values": ["2024-25"]},
                        ]
                    }
                ]
            }
        )
    cleaned = client._normalize_query({"limit": 9999})
    assert cleaned["limit"] == 500
    with pytest.raises(CubeQueryError, match="integer"):
        client._normalize_query({"limit": "nope"})


@pytest.mark.unit
def test_http_400_and_bad_json() -> None:
    import io
    import urllib.error

    def bad_request(request, timeout=15):
        raise urllib.error.HTTPError(
            url="http://cube:4000/cubejs-api/v1/load",
            code=400,
            msg="bad",
            hdrs=None,
            fp=io.BytesIO(b"nope"),
        )

    client = CubeClient("http://cube:4000", None, meta=SAMPLE_META, opener=bad_request)
    with pytest.raises(CubeQueryError, match="HTTP 400"):
        client._post("/cubejs-api/v1/load", {"query": {}})

    opener = ScriptedOpener([FakeResponse(b"not-json")])
    broken = CubeClient("http://cube:4000", None, opener=opener)
    with pytest.raises(CubeQueryError, match="non-JSON"):
        broken.meta()

    opener = ScriptedOpener([FakeResponse([1, 2])])
    listed = CubeClient("http://cube:4000", None, opener=opener)
    with pytest.raises(CubeQueryError, match="non-object"):
        listed.meta()

    opener = ScriptedOpener([TimeoutError("slow")])
    timed = CubeClient("http://cube:4000", None, opener=opener)
    with pytest.raises(CubeUnavailableError):
        timed.meta()

    bad_meta = CubeClient(
        "http://cube:4000",
        None,
        opener=ScriptedOpener([FakeResponse({"no": "cubes"})]),
    )
    with pytest.raises(CubeQueryError, match="did not include cubes"):
        bad_meta.meta()

    bad = CubeClient(
        "http://cube:4000",
        None,
        meta=SAMPLE_META,
        opener=ScriptedOpener([FakeResponse({})]),
    )
    with pytest.raises(CubeQueryError, match="did not include data"):
        bad.load({"measures": ["players.count"]})

    client = CubeClient("http://cube:4000", None, meta=SAMPLE_META)
    client.validate(
        {
            "measures": ["players.count"],
            "order": [["players.full_name", "asc"]],
            "timeDimensions": [{"dimension": "players.full_name"}],
        }
    )


@pytest.mark.unit
def test_meta_index_and_describe_cubes() -> None:
    meta = {
        "cubes": [
            {
                "name": "games_schedule",
                "description": "All-status slate (Final and upcoming). Upcoming scores are null.",
                "measures": [{"name": "games_schedule.count", "type": "number"}],
                "dimensions": [
                    {"name": "games_schedule.game_date", "type": "time"},
                    {
                        "name": "games_schedule.national_tv",
                        "type": "string",
                        "description": "National TV networks,\n comma-separated.",
                    },
                ],
            },
            {"name": "team_games", "description": "x" * 150, "dimensions": []},
            {"name": "games", "measures": [{"name": "games.count"}]},
            {"name": "reddit_posts", "description": "PRAW submission ingest."},
        ]
    }
    index = format_meta_index(meta)
    assert "- games_schedule: All-status slate (Final and upcoming)\n" in index
    assert "- games\n" in index
    # No members in the index, and a long description is cut.
    assert "game_date" not in index
    assert "- team_games: " + "x" * 99 + "…\n" in index

    described = describe_cubes(meta, ["games_schedule"])
    assert "Upcoming scores are null." in described
    assert "Measures: games_schedule.count (number)" in described
    assert "games_schedule.game_date (time)" in described
    assert "- games_schedule.national_tv: National TV networks, comma-separated." in described
    assert "team_games" not in described
    with pytest.raises(UnknownMemberError, match="Unknown cube\\(s\\): nope. Cubes: games,"):
        describe_cubes(meta, ["games", "nope"])

    client = CubeClient("http://cube:4000", meta=meta)
    assert client.meta_index() == index
    # A member with no type is listed bare.
    assert client.describe_cubes(["games"]) == "## games\nMeasures: games.count\n"
    assert "reddit_posts" in index
    assert "reddit_posts" not in client.meta_index(("reddit_",))
    assert "- games\n" in client.meta_index(("reddit_",))
