from __future__ import annotations

from uuid import UUID

import pytest
from baseline_analytics.errors import UnknownMemberError
from baseline_analytics.tools import TOOLS, TOOLS_BY_NAME, call_tool

PLAYER = "00000000-0000-4000-8000-000000000001"
MISSING = "00000000-0000-4000-8000-000000000099"
GAME = "00000000-0000-4000-8000-000000000101"


class FakeAnalytics:
    def __init__(self) -> None:
        self.calls: dict[str, dict] = {}

    def search_players(self, name: str) -> list[dict]:
        return [{"player_id": PLAYER, "full_name": name}]

    def get_player_game_log(self, player_id: UUID, season: str | None = None) -> list[dict]:
        return [{"player_id": player_id, "season": season}]

    def get_back_to_back_stats(self, player_id: UUID, season: str | None = None) -> dict:
        if str(player_id) == MISSING:
            return {"player_name": None}
        return {"player_id": player_id, "player_name": "A", "total_back_to_backs": 1}

    def get_career_stats(self, player_id: UUID) -> dict | None:
        return None if str(player_id) == MISSING else {"player_id": player_id}

    def compare_players(self, player_ids: list[UUID], stats: list[str] | None = None) -> list[dict]:
        return [{"player_id": player_id, "stats": stats} for player_id in player_ids]

    def find_team(self, abbreviation: str) -> dict | None:
        return None if abbreviation == "XXX" else {"abbreviation": abbreviation}

    def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
        self.calls["get_team_record"] = kwargs
        return {"abbreviation": team_abbreviation, "wins": 1, "losses": 0, "game_list": [{}]}

    def get_player_contract(self, player_id: UUID, season: str | None = None) -> dict | None:
        return None if str(player_id) == MISSING else {"player_id": player_id, "season": season}

    def get_team_payroll(self, abbreviation: str, season: str | None = None) -> dict | None:
        return None if abbreviation == "XXX" else {"abbreviation": abbreviation, "season": season}

    def get_team_contracts(self, abbreviation: str, season: str | None = None) -> list[dict] | None:
        return None if abbreviation == "XXX" else [{"full_name": "A", "season": season}]

    def list_standings(
        self, season: str | None = None, conference: str | None = None
    ) -> list[dict]:
        return [{"abbreviation": "OKC", "conference": conference}]

    def get_player_season_stats(self, player_id: UUID) -> list[dict]:
        return [{"player_id": player_id, "ppg": 24.5}]

    def get_mvp_ladder(self, **kwargs) -> dict:
        return {"season": "2025-26", "players": [{"mvp_rank": 1, "limit": kwargs["limit"]}]}

    def get_player_mvp_scores(self, player_id: UUID, season: str | None = None) -> list[dict]:
        return [{"player_id": player_id, "season": season}]

    def get_games_schedule(self, **kwargs) -> list[dict]:
        self.calls["get_games_schedule"] = kwargs
        return [{"game_id": GAME}]

    def get_game_predictions(self, **kwargs) -> list[dict]:
        return [kwargs]

    def get_player_injuries(self, **kwargs) -> list[dict]:
        return [kwargs]

    def get_game_odds(self, **kwargs) -> list[dict]:
        return [kwargs]

    def get_biggest_upsets(self, **kwargs) -> dict:
        return {"season": "2026-27", "upsets": [{"upset_rank": 1}]}

    def get_transactions(self, **kwargs) -> list[dict]:
        return [kwargs]

    def get_transaction_participants(self, **kwargs) -> list[dict]:
        return [kwargs]

    def get_daily_highlights(self, **kwargs) -> dict:
        return {"game_date": "2026-01-12", "highlights": [kwargs]}

    def get_play_by_play(self, game_id: UUID, limit: int | None = None) -> list[dict]:
        return [{"game_id": game_id, "limit": limit}]

    def get_reddit_posts(self, **kwargs) -> list[dict]:
        return [kwargs]

    def describe_cubes(self, names: list[str] | None = None) -> str:
        return "## " + ", ".join(names) if names else "# Cubes"

    def run_cube_query(self, query: dict) -> list[dict]:
        if "mystery.ppg" in (query.get("measures") or []):
            raise UnknownMemberError("Unknown Cube member(s): mystery.ppg")
        return [{"query": query}]


@pytest.mark.unit
def test_every_tool_has_a_schema_and_runs() -> None:
    fake = FakeAnalytics()
    arguments = {
        "search_players": {"name": " kawhi "},
        "get_player_game_log": {"player_id": PLAYER},
        "get_player_back_to_backs": {"player_id": PLAYER},
        "get_career_stats": {"player_id": PLAYER},
        "compare_players": {"player_ids": [PLAYER, MISSING], "stats": ["games"]},
        "get_team_record": {"team_abbreviation": "gsw", "location": "away"},
        "get_player_contract": {"player_id": PLAYER, "season": "2026-27"},
        "get_team_payroll": {"team_abbreviation": "gsw"},
        "get_team_contracts": {"team_abbreviation": "gsw"},
        "get_player_season_stats": {"player_id": PLAYER},
        "get_player_mvp_scores": {"player_id": PLAYER},
        "get_play_by_play": {"game_id": GAME, "limit": 5},
    }
    for tool in TOOLS:
        assert tool.parameters["type"] == "object"
        assert set(tool.required) <= set(tool.properties)
        result = call_tool(fake, tool.name, arguments.get(tool.name, {}))
        if tool.rows_key:
            assert isinstance(result[tool.rows_key], list)
    assert len(TOOLS_BY_NAME) == len(TOOLS)
    assert call_tool(fake, "search_players", {"name": " kawhi "})[0]["full_name"] == "kawhi"
    # Ids arrive as strings and reach the operation as UUIDs; abbreviations are upper-cased.
    assert call_tool(fake, "get_player_game_log", {"player_id": PLAYER})[0]["player_id"] == UUID(
        PLAYER
    )
    assert (
        call_tool(fake, "get_team_payroll", {"team_abbreviation": "gsw"})["abbreviation"] == "GSW"
    )
    assert fake.calls["get_team_record"]["location"] == "away"
    # The game list is long, so it is left out unless asked for.
    assert "game_list" not in call_tool(fake, "get_team_record", {"team_abbreviation": "GSW"})
    listed = call_tool(fake, "get_team_record", {"team_abbreviation": "GSW", "include_games": True})
    assert listed["game_list"] == [{}]


@pytest.mark.unit
def test_optional_arguments_pass_through() -> None:
    fake = FakeAnalytics()
    call_tool(
        fake,
        "get_games_schedule",
        {
            "team_abbreviation": "DET",
            "opponent_abbreviation": "CHI",
            "location": "away",
            "limit": 1,
        },
    )
    assert fake.calls["get_games_schedule"] == {
        "season": None,
        "status": None,
        "limit": 1,
        "team_abbreviation": "DET",
        "opponent_abbreviation": "CHI",
        "location": "away",
        "from_date": None,
        "to_date": None,
    }
    assert call_tool(fake, "get_game_predictions", {"game_id": GAME, "upcoming": True}) == [
        {"game_id": UUID(GAME), "upcoming": True}
    ]
    # An explicit null is the same as leaving the argument out.
    assert call_tool(fake, "get_game_odds", {"game_id": None}) == [{"game_id": None}]
    assert call_tool(fake, "get_player_injuries", {"player_id": PLAYER})[0]["player_id"] == UUID(
        PLAYER
    )
    assert call_tool(fake, "get_mvp_ladder", {"limit": 5})["players"][0]["limit"] == 5
    assert call_tool(fake, "get_daily_highlights", {})["highlights"][0]["all_candidates"] is False


@pytest.mark.unit
def test_query_cube_builds_only_what_was_sent() -> None:
    fake = FakeAnalytics()
    assert call_tool(fake, "query_cube", {"measures": ["players.count"], "filters": []}) == [
        {"query": {"measures": ["players.count"]}}
    ]
    query = call_tool(
        fake,
        "query_cube",
        {
            "dimensions": ["players.full_name"],
            "order": {"players.career_ppg": "desc"},
            "timeDimensions": [{"dimension": "player_game_logs.game_date"}],
            "limit": 5,
        },
    )[0]["query"]
    assert query == {
        "dimensions": ["players.full_name"],
        "order": {"players.career_ppg": "desc"},
        "timeDimensions": [{"dimension": "player_game_logs.game_date"}],
        "limit": 5,
    }
    with pytest.raises(UnknownMemberError):
        call_tool(fake, "query_cube", {"measures": ["mystery.ppg"]})


@pytest.mark.unit
def test_cube_schema_is_reference_text() -> None:
    fake = FakeAnalytics()
    assert TOOLS_BY_NAME["get_cube_schema"].is_data is False
    assert (
        call_tool(fake, "get_cube_schema", {"cubes": ["players", "teams"]}) == "## players, teams"
    )
    assert call_tool(fake, "get_cube_schema", {}) == "# Cubes"
    # One name sent as a string is one cube, not a cube per character.
    assert call_tool(fake, "get_cube_schema", {"cubes": "players"}) == "## players"


@pytest.mark.unit
def test_unknown_things_raise() -> None:
    fake = FakeAnalytics()
    with pytest.raises(ValueError, match="Unknown tool 'query_nba_data'"):
        call_tool(fake, "query_nba_data", {"sql": "SELECT 1"})
    with pytest.raises(
        ValueError, match="get_games_schedule does not take arena_city. Arguments: season,"
    ):
        call_tool(fake, "get_games_schedule", {"team_abbreviation": "DET", "arena_city": "Chicago"})
    with pytest.raises(ValueError, match="location must be 'home' or 'away'"):
        call_tool(fake, "get_games_schedule", {"team_abbreviation": "DET", "location": "Chicago"})
    with pytest.raises(ValueError, match="get_career_stats requires player_id"):
        call_tool(fake, "get_career_stats", None)
    for name in ("get_player_back_to_backs", "get_career_stats", "get_player_contract"):
        with pytest.raises(ValueError, match="Player not found"):
            call_tool(fake, name, {"player_id": MISSING})
    for name in ("get_team_record", "get_team_payroll", "get_team_contracts"):
        with pytest.raises(ValueError, match="Team not found: XXX"):
            call_tool(fake, name, {"team_abbreviation": "xxx"})
