"""Named Cube operations with a scripted client (no live Cube)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from cube.analytics import CubeAnalytics
from cube.errors import UnknownMemberError
from cube.queries import (
    PLAYER_COMPARE_DIMENSIONS,
    PLAYER_SALARY_DIMENSIONS,
    current_nba_season,
    game_odds_query,
    game_predictions_query,
    game_standings_query,
    games_schedule_query,
    normalize_conference,
    play_by_play_query,
    player_back_to_backs_query,
    player_ids_query,
    player_injuries_query,
    player_salary_query,
    player_season_stats_query,
    project_compare_stats,
    reddit_posts_query,
    resolve_location_filters,
    search_players_query,
    standings_query,
    team_games_seasons_query,
    team_record_query,
)


class ScriptedCubeClient:
    def __init__(self, loads: list[list[dict]]):
        self.loads = list(loads)
        self.queries: list[dict] = []

    def load(self, query: dict) -> list[dict]:
        self.queries.append(query)
        if not self.loads:
            return []
        return self.loads.pop(0)

    def meta_summary(self) -> str:
        return "## players\n"


PLAYER_CURRY = UUID("00000000-0000-4000-8000-000000000001")
PLAYER_LEBRON = UUID("00000000-0000-4000-8000-000000000002")
PLAYER_KAWHI = UUID("00000000-0000-4000-8000-000000000003")
TEAM_GSW = UUID("7bf8726a-a852-452d-b81f-14839127c5fb")
TEAM_OKC = UUID("bc007f7f-f88d-4699-8325-e2f5a3e32183")
TEAM_LAL = UUID("8cbd46d2-8092-4b1e-8b24-f31c7692cadd")
GAME_ONE = UUID("00000000-0000-4000-8000-000000000101")


@pytest.mark.unit
def test_analytics_named_operations() -> None:
    client = ScriptedCubeClient(
        [
            [{"player_id": PLAYER_CURRY, "full_name": "Stephen Curry", "abbreviation": "GSW"}],
            [
                {
                    "player_id": PLAYER_CURRY,
                    "full_name": "Stephen Curry",
                    "career_games_played": 10,
                    "career_ppg": 30,
                    "seasons_played": 2,
                    "current_season_salary": "55772427",
                }
            ],
            [{"teams_played": 1}],
            [
                {
                    "player_id": PLAYER_CURRY,
                    "full_name": "Stephen Curry",
                    "career_games_played": 10,
                    "career_ppg": 30,
                }
            ],
            [
                {
                    "back_to_back_games": 3,
                    "games_played_in_b2b": 2,
                    "games_sat_in_b2b": 1,
                    "avg_points_b2b": "24.0",
                    "avg_points_non_b2b": "27.0",
                    "avg_points": "26.0",
                }
            ],
            [
                {
                    "player_id": PLAYER_LEBRON,
                    "full_name": "LeBron James",
                    "career_games_played": 20,
                    "career_ppg": 27,
                },
                {
                    "player_id": PLAYER_CURRY,
                    "full_name": "Stephen Curry",
                    "career_games_played": 10,
                    "career_ppg": 30,
                },
            ],
            [
                {"player_id": PLAYER_LEBRON, "teams_played": 2},
                {"player_id": PLAYER_CURRY, "teams_played": 1},
            ],
            [
                {
                    "team_id": TEAM_GSW,
                    "abbreviation": "GSW",
                    "team_name": "Golden State Warriors",
                    "current_season_payroll": 180000000,
                }
            ],
            [
                {
                    "team_id": TEAM_GSW,
                    "team_abbreviation": "GSW",
                    "team_name": "Golden State Warriors",
                    "wins": 3,
                    "losses": 1,
                    "games": 4,
                }
            ],
            [{"game_id": GAME_ONE, "result": "W"}],
            [{"season": "2024-25"}],
            [
                {
                    "team_id": TEAM_OKC,
                    "abbreviation": "OKC",
                    "team_name": "Thunder",
                    "conference": "West",
                    "conference_rank": 1,
                    "team_wins": 50,
                    "team_losses": 10,
                    "win_pct": 0.833,
                    "games_back": 0,
                }
            ],
            [{"season": "2024-25"}],
            [
                {
                    "team_id": TEAM_OKC,
                    "abbreviation": "OKC",
                    "team_name": "Thunder",
                    "conference": "West",
                    "conference_rank": 1,
                    "team_wins": 50,
                    "team_losses": 10,
                    "win_pct": 0.833,
                    "games_back": 0,
                }
            ],
        ]
    )
    analytics = CubeAnalytics(client)
    assert analytics.search_players("Curry")[0]["full_name"] == "Stephen Curry"
    career = analytics.get_career_stats(PLAYER_CURRY)
    assert career is not None
    assert career["total_points"] == 300
    assert career["teams_played_for"] == 1
    b2b = analytics.get_back_to_back_stats(PLAYER_CURRY, "2024-25")
    assert b2b["total_back_to_backs"] == 3
    assert b2b["games_played_in_b2b"] == 2
    assert b2b["games_sat_in_b2b"] == 1
    assert b2b["avg_pts_b2b"] == 24.0
    assert "total_b2b_games" not in b2b
    assert "avg_pts_in_b2b" not in b2b
    compared = analytics.compare_players([PLAYER_LEBRON, PLAYER_CURRY])
    assert compared[0]["full_name"] == "LeBron James"
    assert compared[0]["teams_played_for"] == 2
    team = analytics.find_team("GSW")
    assert team is not None
    assert team["current_season_payroll"] == 180000000
    record = analytics.get_team_record("GSW", arena_city="Chicago")
    assert record["wins"] == 3
    assert record["win_pct"] == 0.75
    assert record["game_list"]
    standings = analytics.list_standings()
    assert standings[0]["abbreviation"] == "OKC"
    assert standings[0]["wins"] == 50
    assert analytics.get_team_standing(TEAM_OKC)["abbreviation"] == "OKC"
    assert analytics.get_player_game_log(GAME_ONE) == []
    assert analytics.get_player(PLAYER_KAWHI) is None
    assert analytics.get_career_stats(PLAYER_KAWHI) is None
    with pytest.raises(ValueError):
        analytics.compare_players([PLAYER_CURRY])


@pytest.mark.unit
def test_team_record_fills_name_when_no_games() -> None:
    client = ScriptedCubeClient(
        [
            [],
            [],
            [
                {
                    "team_id": TEAM_GSW,
                    "abbreviation": "GSW",
                    "team_name": "Golden State Warriors",
                }
            ],
        ]
    )
    analytics = CubeAnalytics(client)
    record = analytics.get_team_record("GSW", arena_city="Chicago", since_season="2010-11")
    assert record["games"] == 0
    assert record["wins"] == 0
    assert record["abbreviation"] == "GSW"
    assert record["team_name"] == "Golden State Warriors"
    assert record["game_list"] == []


@pytest.mark.unit
def test_run_cube_query_rejects_unknown() -> None:
    class Rejecting:
        def load(self, query):
            raise UnknownMemberError("Unknown Cube member(s): mystery.ppg")

        def meta_summary(self) -> str:
            return ""

    analytics = CubeAnalytics(Rejecting())  # type: ignore[arg-type]
    with pytest.raises(UnknownMemberError):
        analytics.run_cube_query({"measures": ["mystery.ppg"]})
    assert analytics.meta_summary() == ""


@pytest.mark.unit
def test_query_builders() -> None:
    assert current_nba_season(date(2025, 10, 1)) == "2025-26"
    assert current_nba_season(date(2026, 2, 1)) == "2025-26"
    search = search_players_query("kawhi")
    assert search["filters"][0]["operator"] == "contains"
    b2b = player_back_to_backs_query(PLAYER_CURRY, "2024-25")
    assert "player_game_logs.avg_points_b2b" in b2b["measures"]
    assert "player_game_logs.games_played_in_b2b" in b2b["measures"]
    assert "player_game_logs.games_sat_in_b2b" in b2b["measures"]
    assert "player_season_stats.ppg" in player_season_stats_query(PLAYER_CURRY)["dimensions"]
    assert games_schedule_query(season="2024-25", status="Scheduled")["filters"][0]["values"] == [
        "2024-25"
    ]
    assert game_predictions_query(upcoming=True)["filters"][0]["operator"] == "notEquals"
    assert (
        player_injuries_query(player_id=PLAYER_CURRY)["filters"][0]["member"]
        == "player_injuries.player_id"
    )
    assert game_odds_query()["dimensions"][0] == "game_odds.odds_event_id"
    upcoming = game_odds_query(now=datetime(2026, 10, 20, 23, 30, tzinfo=UTC))
    assert upcoming["filters"] == [
        {
            "member": "game_odds.commence_time",
            "operator": "afterDate",
            "values": ["2026-10-20T23:30:00"],
        }
    ]
    by_game = game_odds_query(game_id=UUID("00000000-0000-0000-0000-000000000001"))
    assert [f["member"] for f in by_game["filters"]] == ["game_odds.game_id"]
    pbp = play_by_play_query(GAME_ONE, 999)
    assert pbp["limit"] == 500
    assert pbp["filters"][0]["values"] == [str(GAME_ONE)]
    reddit = reddit_posts_query("thread", 10)
    assert reddit["limit"] == 10
    assert "standings.conf_games_back" in standings_query()["dimensions"]
    query, applied = team_record_query(
        "gsw",
        opponent_abbreviation="chi",
        location="home",
        since_season="2010-11",
        season="2024-25",
        arena_city="Chicago",
    )
    assert applied["team_abbreviation"] == "GSW"
    assert applied["arena_city"] == "Chicago"
    assert applied["since_season"] == "2010-11"
    assert applied["season"] == "2024-25"
    assert applied["location"] == "home"
    assert query["measures"] == ["team_games.wins", "team_games.losses", "team_games.games"]
    assert resolve_location_filters("home", None) == ("home", None)
    assert resolve_location_filters("Chicago", None) == (None, "Chicago")
    assert normalize_conference("western") == "West"
    assert normalize_conference("  ") is None
    assert normalize_conference("Central") == "Central"
    standings = standings_query(season="2024-25", conference="east")
    assert standings["filters"][1]["values"] == ["East"]
    game_standings = game_standings_query(season="2026-27", conference="west")
    assert game_standings["measures"] == [
        "team_games.wins",
        "team_games.losses",
        "team_games.games",
    ]
    assert game_standings["filters"][0]["values"] == ["Regular Season"]
    assert game_standings["filters"][1]["values"] == ["2026-27"]
    assert game_standings["filters"][2]["values"] == ["West"]
    assert team_games_seasons_query()["filters"][0]["values"] == ["Regular Season"]
    rows = [
        {"player_id": PLAYER_CURRY, "full_name": "A", "career_ppg": 20, "career_games_played": 10}
    ]
    projected = project_compare_stats(rows, ["ppg", "games", "ppg"])
    assert "career_ppg" in projected[0]
    defaulted = project_compare_stats(rows)
    assert defaulted[0]["player_id"] == PLAYER_CURRY
    compare_query = player_ids_query([PLAYER_LEBRON, PLAYER_CURRY])
    assert compare_query["dimensions"] == list(PLAYER_COMPARE_DIMENSIONS)
    assert "players.height" not in compare_query["dimensions"]
    salary_query = player_salary_query(PLAYER_CURRY)
    assert salary_query["dimensions"] == list(PLAYER_SALARY_DIMENSIONS)
    season_query = player_season_stats_query(PLAYER_CURRY)
    assert "players.full_name" in season_query["dimensions"]
    assert "player_season_stats.first_game_date" not in season_query["dimensions"]


@pytest.mark.unit
def test_new_named_cube_operations() -> None:
    client = ScriptedCubeClient(
        [
            [{"player_id": PLAYER_CURRY, "season": "2024-25", "ppg": 24.5, "games_played": 70}],
            [
                {
                    "player_id": PLAYER_CURRY,
                    "player_name": "Stephen Curry",
                    "season": "2024-25",
                    "salary": "100",
                    "remaining_guaranteed": "100",
                }
            ],
            [
                {
                    "team_id": TEAM_GSW,
                    "team_abbreviation": "GSW",
                    "team_name": "Warriors",
                    "season": "2024-25",
                    "total_salary": 180000000,
                }
            ],
            [{"game_id": GAME_ONE, "status": "Scheduled"}],
            [{"game_id": GAME_ONE, "model_wp": 0.58, "model_version": "elo-v0"}],
            [{"player_name": "Kawhi Leonard", "description": "knee"}],
            [{"game_id": GAME_ONE, "market": "h2h"}],
            [{"game_id": GAME_ONE, "action_number": 1}],
            [{"reddit_id": "abc", "title": "thread"}],
        ]
    )
    analytics = CubeAnalytics(client)
    assert analytics.get_player_season_stats(PLAYER_CURRY)[0]["ppg"] == 24.5
    contract = analytics.get_player_contract(PLAYER_CURRY, "2024-25")
    assert contract is not None
    assert contract["source"] == "player_contracts"
    payroll = analytics.get_team_payroll("GSW", "2024-25")
    assert payroll is not None
    assert payroll["source"] == "team_payroll"
    assert analytics.get_games_schedule(status="Scheduled")[0]["status"] == "Scheduled"
    assert analytics.get_game_predictions(upcoming=True)[0]["model_wp"] == 0.58
    assert analytics.get_player_injuries(team_abbreviation="LAC")[0]["description"] == "knee"
    assert analytics.get_game_odds()[0]["market"] == "h2h"
    assert analytics.get_play_by_play(GAME_ONE)[0]["action_number"] == 1
    assert analytics.get_reddit_posts("thread")[0]["reddit_id"] == "abc"


@pytest.mark.unit
def test_player_contract_snapshot_omits_profile_dims() -> None:
    client = ScriptedCubeClient(
        [
            [
                {
                    "player_id": PLAYER_CURRY,
                    "full_name": "Stephen Curry",
                    "current_contract_season": "2026-27",
                    "current_season_salary": 62587158,
                    "current_remaining_guaranteed": 62587158,
                }
            ]
        ]
    )
    analytics = CubeAnalytics(client)
    contract = analytics.get_player_contract(PLAYER_CURRY)
    assert contract == {
        "player_id": PLAYER_CURRY,
        "full_name": "Stephen Curry",
        "current_contract_season": "2026-27",
        "current_season_salary": 62587158,
        "current_remaining_guaranteed": 62587158,
    }
    assert "height" not in contract
    assert client.queries[0]["dimensions"] == list(PLAYER_SALARY_DIMENSIONS)


@pytest.mark.unit
def test_list_standings_falls_back_to_team_games() -> None:
    client = ScriptedCubeClient(
        [
            [],
            [
                {
                    "team_id": TEAM_OKC,
                    "team_abbreviation": "OKC",
                    "team_name": "Oklahoma City Thunder",
                    "season": "2026-27",
                    "conference": "West",
                    "wins": 2,
                    "losses": 0,
                    "games": 2,
                },
                {
                    "team_id": TEAM_LAL,
                    "team_abbreviation": "LAL",
                    "team_name": "Los Angeles Lakers",
                    "season": "2026-27",
                    "conference": "West",
                    "wins": 1,
                    "losses": 1,
                    "games": 2,
                },
            ],
        ]
    )
    analytics = CubeAnalytics(client)
    rows = analytics.list_standings(season="2026-27", conference="West")
    assert [row["abbreviation"] for row in rows] == ["OKC", "LAL"]
    assert rows[0]["conference_rank"] == 1
    assert rows[0]["wins"] == 2
    assert rows[0]["games_back"] == 0
    assert rows[1]["conference_rank"] == 2
    assert rows[1]["games_back"] == 1.0
    assert client.queries[0]["dimensions"][0] == "standings.team_id"
    assert client.queries[1]["measures"] == [
        "team_games.wins",
        "team_games.losses",
        "team_games.games",
    ]
    assert client.queries[1]["filters"][0]["values"] == ["Regular Season"]


@pytest.mark.unit
def test_list_standings_resolves_season_from_team_games() -> None:
    client = ScriptedCubeClient(
        [
            [],
            [{"season": "2026-27"}],
            [],
            [
                {
                    "team_id": TEAM_OKC,
                    "team_abbreviation": "OKC",
                    "team_name": "Thunder",
                    "season": "2026-27",
                    "conference": "West",
                    "wins": 3,
                    "losses": 1,
                    "games": 4,
                }
            ],
        ]
    )
    analytics = CubeAnalytics(client)
    rows = analytics.list_standings()
    assert rows[0]["abbreviation"] == "OKC"
    assert rows[0]["conference_rank"] == 1
    assert rows[0]["season"] == "2026-27"
    assert client.queries[0]["dimensions"] == ["standings.season"]
    assert client.queries[1]["dimensions"] == ["team_games.season"]
    assert client.queries[2]["filters"][0]["values"] == ["2026-27"]
