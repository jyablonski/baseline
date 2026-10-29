"""Eval list for rule-based /ask families (option A / NLP_BACKEND=rules)."""

from __future__ import annotations

from typing import Any

import pytest
from baseline_analytics.errors import CubeUnavailableError
from ids import (
    GAME_ONE,
    PLAYER_CURRY,
    PLAYER_KAWHI,
    PLAYER_LEBRON,
    TEAM_BOS,
    TEAM_GSW,
    TEAM_LAL,
    TEAM_OKC,
)
from services.nl_query import NaturalLanguageQueryService


class FakeCubeAnalytics:
    def search_players(self, name: str) -> list[dict[str, Any]]:
        catalog = [
            {"player_id": PLAYER_KAWHI, "full_name": "Kawhi Leonard"},
            {"player_id": PLAYER_LEBRON, "full_name": "LeBron James"},
            {"player_id": PLAYER_CURRY, "full_name": "Stephen Curry"},
        ]
        needle = (name or "").lower()
        return [row for row in catalog if needle in row["full_name"].lower()]

    def get_player(self, player_id: str) -> dict[str, Any] | None:
        if str(player_id) == PLAYER_CURRY:
            return {
                "player_id": PLAYER_CURRY,
                "full_name": "Stephen Curry",
                "current_season_salary": 55772427,
                "current_remaining_guaranteed": 55772427,
                "current_contract_season": "2025-26",
            }
        if str(player_id) == PLAYER_LEBRON:
            return {
                "player_id": PLAYER_LEBRON,
                "full_name": "LeBron James",
                "current_season_salary": 52662789,
                "current_remaining_guaranteed": None,
                "current_contract_season": None,
            }
        if str(player_id) == PLAYER_KAWHI:
            return {
                "player_id": PLAYER_KAWHI,
                "full_name": "Kawhi Leonard",
                "current_season_salary": None,
            }
        return None

    def get_back_to_back_stats(self, player_id: str, season: str | None) -> dict:
        return {
            "player_name": "Kawhi Leonard",
            "total_back_to_backs": 10,
            "games_played_in_b2b": 8,
            "games_sat_in_b2b": 2,
            "avg_pts_b2b": 25.0,
            "avg_pts_non_b2b": 27.0,
            "season": season,
        }

    def compare_players(self, player_ids: list[str], stats: list[str] | None = None) -> list[dict]:
        if len(player_ids) < 2:
            raise ValueError("compare_players requires at least 2 player_ids")
        rows = [
            {
                "player_id": PLAYER_LEBRON,
                "full_name": "LeBron James",
                "career_games_played": 1500,
                "career_ppg": 27.1,
                "career_rpg": 7.5,
                "career_apg": 7.4,
            },
            {
                "player_id": PLAYER_CURRY,
                "full_name": "Stephen Curry",
                "career_games_played": 1000,
                "career_ppg": 24.3,
                "career_rpg": 4.7,
                "career_apg": 6.5,
            },
        ]
        player_id_values = {str(player_id) for player_id in player_ids}
        return [row for row in rows if row["player_id"] in player_id_values]

    def find_team(self, abbreviation: str) -> dict | None:
        teams = {
            "GSW": {
                "team_id": TEAM_GSW,
                "abbreviation": "GSW",
                "team_name": "Golden State Warriors",
                "current_season_payroll": 180000000,
                "current_remaining_guaranteed": 170000000,
                "current_contract_season": "2025-26",
            },
            "LAL": {
                "team_id": TEAM_LAL,
                "abbreviation": "LAL",
                "team_name": "Los Angeles Lakers",
                "current_season_payroll": 190000000,
                "current_remaining_guaranteed": None,
                "current_contract_season": None,
            },
            "OKC": {
                "team_id": TEAM_OKC,
                "abbreviation": "OKC",
                "team_name": "Oklahoma City Thunder",
                "current_season_payroll": None,
            },
        }
        return teams.get(abbreviation.upper())

    def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
        team = self.find_team(team_abbreviation)
        return {
            "team_id": team["team_id"] if team else None,
            "abbreviation": team_abbreviation,
            "team_name": team["team_name"] if team else None,
            "wins": 3,
            "losses": 1,
            "win_pct": 0.75,
            "games": 4,
            "game_list": [],
            "filters_applied": {
                "team_abbreviation": team_abbreviation,
                "arena_city": kwargs.get("arena_city"),
                "since_season": kwargs.get("since_season"),
            },
        }

    def get_team_flow(self, team_abbreviation: str, season: str | None = None) -> dict:
        team = self.find_team(team_abbreviation)
        return {
            "abbreviation": team_abbreviation,
            "team_name": team["team_name"] if team else None,
            "games": 82,
            "blown_leads": 3,
            "biggest_lead_blown": 21,
            "comeback_wins": 2,
            "biggest_comeback": 17,
            "filters_applied": {"team_abbreviation": team_abbreviation, "season": season},
        }

    def list_standings(
        self, season: str | None = None, conference: str | None = None
    ) -> list[dict]:
        rows = [
            {
                "team_id": TEAM_OKC,
                "abbreviation": "OKC",
                "team_name": "Oklahoma City Thunder",
                "conference": "West",
                "conference_rank": 1,
                "wins": 50,
                "losses": 10,
                "win_pct": 0.833,
                "games_back": 0,
                "streak": "W5",
            },
            {
                "team_id": TEAM_LAL,
                "abbreviation": "LAL",
                "team_name": "Los Angeles Lakers",
                "conference": "West",
                "conference_rank": 6,
                "wins": 40,
                "losses": 20,
                "win_pct": 0.667,
                "games_back": 10.0,
                "streak": "L2",
            },
            {
                "team_id": TEAM_BOS,
                "abbreviation": "BOS",
                "team_name": "Boston Celtics",
                "conference": "East",
                "conference_rank": 1,
                "wins": 48,
                "losses": 12,
                "win_pct": 0.8,
                "games_back": 0,
                "streak": "W3",
            },
        ]
        if conference:
            rows = [row for row in rows if row["conference"].lower() == conference.lower()]
        return rows

    def get_team_standing(self, team_id: str, season: str | None = None) -> dict | None:
        for row in self.list_standings():
            if str(row["team_id"]) == str(team_id):
                return row
        return None

    def get_player_game_log(self, player_id: str, season: str | None = None) -> list[dict]:
        return [{"player_id": player_id, "points": 30, "season": season}]

    def get_career_stats(self, player_id: str) -> dict | None:
        return self.get_player(player_id)

    def get_player_contract(self, player_id: str, season: str | None = None) -> dict | None:
        return self.get_player(player_id)

    def get_team_payroll(self, abbreviation: str, season: str | None = None) -> dict | None:
        return self.find_team(abbreviation)

    def get_team_contracts(self, abbreviation: str, season: str | None = None) -> list[dict] | None:
        if self.find_team(abbreviation) is None:
            return None
        return [{"full_name": "Stephen Curry", "current_season_salary": 59606817}]

    def get_player_season_stats(self, player_id: str) -> list[dict]:
        if str(player_id) != PLAYER_CURRY:
            return []
        return [
            {"player_id": PLAYER_CURRY, "season": "2023-24", "games_played": 74, "ppg": 26.4},
            {"player_id": PLAYER_CURRY, "season": "2024-25", "games_played": 70, "ppg": 24.5},
        ]

    def get_games_schedule(self, **kwargs) -> list[dict]:
        self.schedule_kwargs = kwargs
        return [{"game_id": GAME_ONE, "status": "Scheduled"}]

    def get_game_predictions(self, **kwargs) -> list[dict]:
        return [{"game_id": GAME_ONE, "model_wp": 0.58, "model_version": "elo-v0"}]

    def get_player_injuries(self, **kwargs) -> list[dict]:
        return [{"player_name": "Kawhi Leonard", "description": "knee"}]

    def get_game_odds(self, **kwargs) -> list[dict]:
        return [{"game_id": GAME_ONE, "market": "h2h"}]

    def get_play_by_play(self, game_id: str, limit: int | None = None) -> list[dict]:
        return [{"game_id": game_id, "action_number": 1}]

    def get_reddit_posts(self, **kwargs) -> list[dict]:
        return [{"reddit_id": "abc", "title": "Game thread"}]

    def meta_index(self, exclude_prefixes: tuple[str, ...] = ()) -> str:
        self.index_excludes = exclude_prefixes
        return "## players\nMeasures: players.count\nDimensions: players.full_name\n"

    def run_cube_query(self, query: dict) -> list[dict]:
        if "mystery.ppg" in (query.get("measures") or []):
            from baseline_analytics.errors import UnknownMemberError

            raise UnknownMemberError("Unknown Cube member(s): mystery.ppg")
        self.cube_query = query
        return [{"ok": True}]


EVAL_CASES = [
    ("How many back-to-backs has Kawhi played?", "b2b"),
    ("How does Kawhi Leonard perform on back-to-backs?", "b2b"),
    ("Compare LeBron vs Curry career games", "compare"),
    ("Who has more games, LeBron or Curry?", "compare"),
    (
        "How many more career games has LeBron played than Stephen Curry?",
        "compare",
    ),
    ("What is the Warriors' win percentage in Chicago?", "arena_city"),
    ("Warriors record in Chicago", "arena_city"),
    ("Who leads the West?", "standings"),
    ("How many games back are the Lakers?", "standings"),
    ("Eastern Conference standings", "standings"),
    ("What is Curry's salary?", "salary"),
    ("What is the Warriors payroll?", "salary"),
    ("How much does LeBron make?", "salary"),
    ("Curry PPG by season", "season_stats"),
    ("What is the meaning of life?", "refuse"),
]


@pytest.fixture
def service() -> NaturalLanguageQueryService:
    return NaturalLanguageQueryService(FakeCubeAnalytics())


@pytest.mark.unit
@pytest.mark.parametrize(("question", "family"), EVAL_CASES)
def test_nl_eval_family(
    service: NaturalLanguageQueryService,
    question: str,
    family: str,
) -> None:
    assert service.classify(question) == family
    response = service.answer(question)
    assert response.answer
    if family == "refuse":
        assert response.data == []
        assert "salary/payroll" in response.answer
        assert "standings" in response.answer
    else:
        assert response.data
        for row in response.data:
            assert "player_id" not in row
            assert "team_id" not in row
            assert "filters_applied" not in row
            assert "game_list" not in row
            assert "total_b2b_games" not in row
            assert "avg_pts_in_b2b" not in row
            if "full_name" in row:
                assert "player_name" not in row


@pytest.mark.unit
def test_classify_empty_is_refuse(service: NaturalLanguageQueryService) -> None:
    assert service.classify("   ") == "refuse"
    response = service.answer("   ")
    assert response.data == []
    assert "non-empty" in response.answer


@pytest.mark.unit
def test_resolves_bref_initial_player_names() -> None:
    class BrefNames(FakeCubeAnalytics):
        def search_players(self, name: str) -> list[dict[str, Any]]:
            if name.casefold() == "leonard":
                return [{"player_id": PLAYER_KAWHI, "full_name": "K. Leonard"}]
            return []

    response = NaturalLanguageQueryService(BrefNames()).answer(
        "How many back-to-backs has Kawhi Leonard played?"
    )

    assert response.data
    assert "K. Leonard has" in response.answer


@pytest.mark.unit
def test_cube_down_is_clear_answer() -> None:
    class Down(FakeCubeAnalytics):
        def search_players(self, name: str) -> list[dict]:
            raise CubeUnavailableError(
                "Ask is unavailable because the Cube semantic layer is down."
            )

    service = NaturalLanguageQueryService(Down())
    response = service.answer("How many back-to-backs has Kawhi played?")
    assert response.data == []
    assert "Cube semantic layer is down" in response.answer


@pytest.mark.unit
def test_salary_unmatched_and_null(service: NaturalLanguageQueryService) -> None:
    missing = service.answer("What is Jokic's salary?")
    assert missing.data == []
    assert "No player found" in missing.answer

    null_salary = service.answer("What is Kawhi's salary?")
    assert "don't have a current salary" in null_salary.answer


@pytest.mark.unit
def test_payroll_and_games_back(service: NaturalLanguageQueryService) -> None:
    payroll = service.answer("OKC payroll")
    assert "don't have a current payroll" in payroll.answer

    games_back = service.answer("How many games behind are the Lakers?")
    assert service.classify("How many games behind are the Lakers?") == "standings"
    assert "games back" in games_back.answer
    assert games_back.data[0]["abbreviation"] == "LAL"


@pytest.mark.unit
def test_nl_error_and_fallback_paths(service: NaturalLanguageQueryService) -> None:
    assert "Could not identify a player" in service.answer("How many back-to-backs?").answer
    assert "No player found" in service.answer("How many back-to-backs has Jokic played?").answer
    assert "at least two player names" in service.answer("Compare LeBron career games").answer
    assert "No player found" in service.answer("Compare LeBron vs Jokic").answer
    assert "Could not identify a team" in service.answer("What is the win percentage?").answer
    assert "Could not identify a player" in service.answer("What is the salary?").answer
    assert "Could not identify a player" in service.answer("PPG by season").answer
    assert "No player found" in service.answer("Jokic PPG by season").answer
    assert "Could not identify a team" in service.answer("What is the payroll?").answer
    assert "No team found" in service.answer("Hawks payroll").answer
    assert "No team found" in service.answer("How many games back are the Hawks?").answer
    assert service.classify("Eastern Conference standings") == "standings"
    assert (
        service.answer("Eastern Conference standings").answer
        == "The Celtics lead the East (48-12)."
    )
    assert service._extract_team_abbr("GSW") == "GSW"
    assert service._format_usd_compact(62_587_158) == "$62.6M"
    assert service._format_usd_compact(180_000_000) == "$180M"
    assert service._format_usd_compact(950_000) == "$950,000"
    assert service._extract_season("standings 2024-25") == "2024-25"

    city_the = service.answer("Warriors record in the since 2024-25")
    assert city_the.data

    b2b_season = service.answer("How many back-to-backs has Kawhi played in 2024-25?")
    assert b2b_season.data[0]["season"] == "2024-25"
    assert "sat out" in b2b_season.answer
    standings_season = service.answer("Who leads the West in 2024-25?")
    assert standings_season.data
    header_west = service.answer("Who leads the West?", season="2026-27")
    assert "The Thunder lead the West" in header_west.answer
    assert header_west.data[0]["abbreviation"] == "OKC"
    season_stats = service.answer("Curry PPG by season")
    assert season_stats.data[0]["season"] == "2023-24"
    header_season = service.answer("How many back-to-backs has Kawhi played?", season="2025-26")
    assert header_season.data[0]["season"] == "2025-26"


@pytest.mark.unit
def test_salary_missing_detail() -> None:
    class MissingDetail(FakeCubeAnalytics):
        def get_player_contract(self, player_id: str, season: str | None = None) -> dict | None:
            return None

    missing = NaturalLanguageQueryService(MissingDetail())
    assert "No player found" in missing.answer("What is Curry's salary?").answer


@pytest.mark.unit
def test_compare_and_standings_empty_rows() -> None:
    class ThinCompare(FakeCubeAnalytics):
        def compare_players(
            self, player_ids: list[str], stats: list[str] | None = None
        ) -> list[dict]:
            return [
                {
                    "player_id": PLAYER_LEBRON,
                    "full_name": "LeBron James",
                    "career_games_played": 1,
                }
            ]

    class EmptyStandings(FakeCubeAnalytics):
        def list_standings(
            self, season: str | None = None, conference: str | None = None
        ) -> list[dict]:
            return []

        def get_team_standing(self, team_id: str, season: str | None = None) -> dict | None:
            return None

    class PartialNamePlayers(FakeCubeAnalytics):
        def search_players(self, name: str) -> list[dict]:
            return [{"player_id": PLAYER_CURRY, "full_name": "Wardell Stephen Curry"}]

    compare = NaturalLanguageQueryService(ThinCompare())
    assert "Could not load stats" in compare.answer("Compare LeBron vs Curry").answer

    empty = NaturalLanguageQueryService(EmptyStandings())
    assert "standings rows found" in empty.answer("Who leads the West?").answer
    assert "No standings row" in empty.answer("How many games back are the Lakers?").answer

    partial = NaturalLanguageQueryService(PartialNamePlayers())
    assert partial.answer("What is Curry's salary?").data

    titled = NaturalLanguageQueryService(FakeCubeAnalytics())
    names = titled._extract_player_names("What is Bam Adebayo's salary?")
    assert names == ["Bam Adebayo"]


@pytest.mark.unit
def test_who_leads_west_from_game_record_ranks() -> None:
    class GameRecordStandings(FakeCubeAnalytics):
        def list_standings(
            self, season: str | None = None, conference: str | None = None
        ) -> list[dict]:
            rows = [
                {
                    "team_id": TEAM_OKC,
                    "abbreviation": "OKC",
                    "team_name": "Oklahoma City Thunder",
                    "conference": "West",
                    "conference_rank": 1,
                    "wins": 2,
                    "losses": 0,
                    "win_pct": 1.0,
                    "games_back": 0,
                    "season": season,
                },
                {
                    "team_id": TEAM_GSW,
                    "abbreviation": "GSW",
                    "team_name": "Golden State Warriors",
                    "conference": "West",
                    "conference_rank": 2,
                    "wins": 1,
                    "losses": 1,
                    "win_pct": 0.5,
                    "games_back": 1.0,
                    "season": season,
                },
            ]
            if conference:
                rows = [row for row in rows if row["conference"].lower() == conference.lower()]
            return rows

    service = NaturalLanguageQueryService(GameRecordStandings())
    response = service.answer("Who leads the West?", season="2026-27")
    assert service.classify("Who leads the West?") == "standings"
    assert "The Thunder lead the West" in response.answer
    assert "2-0" in response.answer
    assert response.data
    assert response.data[0]["abbreviation"] == "OKC"
    assert response.data[0]["conference_rank"] == 1
    assert "player_id" not in response.data[0]
    assert "team_id" not in response.data[0]


@pytest.mark.unit
def test_compare_try_chip_returns_difference(service: NaturalLanguageQueryService) -> None:
    question = "How many more career games has LeBron played than Stephen Curry?"
    assert service.classify(question) == "compare"
    response = service.answer(question)
    assert "500 more games" in response.answer
    assert "career" not in response.answer
    assert "capability" not in response.answer.lower()
    assert "I can answer" not in response.answer
    assert len(response.data) == 2
    assert [row["full_name"] for row in response.data] == [
        "LeBron James",
        "Stephen Curry",
    ]
    assert "player_id" not in response.data[0]
    assert set(response.data[0]) == {"full_name", "career_games_played"}


@pytest.mark.unit
def test_ask_families_limit_visible_fields(service: NaturalLanguageQueryService) -> None:
    salary = service.answer("What is Curry's salary?")
    assert set(salary.data[0]) == {
        "full_name",
        "current_contract_season",
        "current_season_salary",
        "current_remaining_guaranteed",
    }

    payroll = service.answer("What is the Warriors payroll?")
    assert set(payroll.data[0]) == {
        "abbreviation",
        "team_name",
        "current_contract_season",
        "current_season_payroll",
        "current_remaining_guaranteed",
    }

    standings = service.answer("Who leads the West?")
    assert set(standings.data[0]) <= {
        "conference_rank",
        "abbreviation",
        "team_name",
        "conference",
        "wins",
        "losses",
        "win_pct",
        "games_back",
        "streak",
        "last_10",
    }
    assert "season_type" not in standings.data[0]
    assert "as_of_date" not in standings.data[0]

    season_stats = service.answer("Curry PPG by season")
    assert season_stats.data[0]["full_name"] == "Stephen Curry"
    assert "player_id" not in season_stats.data[0]
    assert set(season_stats.data[0]) <= {
        "full_name",
        "season",
        "games_played",
        "ppg",
        "rpg",
        "apg",
    }

    b2b = service.answer("How many back-to-backs has Kawhi played?")
    assert "season" not in b2b.data[0]
    assert set(b2b.data[0]) == {
        "full_name",
        "total_back_to_backs",
        "games_played_in_b2b",
        "games_sat_in_b2b",
        "avg_pts_b2b",
        "avg_pts_non_b2b",
    }


@pytest.mark.unit
def test_record_with_no_games_says_so_once() -> None:
    class EmptyRecord(FakeCubeAnalytics):
        def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
            return {
                "team_id": None,
                "abbreviation": team_abbreviation,
                "team_name": None,
                "wins": 0,
                "losses": 0,
                "win_pct": None,
                "games": 0,
                "game_list": [],
                "filters_applied": {
                    "team_abbreviation": team_abbreviation,
                    "arena_city": kwargs.get("arena_city"),
                    "since_season": kwargs.get("since_season"),
                },
            }

    service = NaturalLanguageQueryService(EmptyRecord())
    question = "What is the Warriors' win percentage in Chicago since 2010-11?"
    response = service.answer(question)
    # Said once, with no table of zeros: it used to read "0-0 (n/a) ... across 0
    # games. No matching games yet."
    assert response.answer == "The Warriors haven't played a game in Chicago since 2010-11."
    assert response.data == []
    assert response.show_data is False
    assert ("team", "Golden State Warriors") in [
        (entity.kind, entity.label) for entity in response.entities
    ]


def _capability_examples() -> list[str]:
    """The examples the capability message advertises, parsed from the message itself.

    Derived rather than hard-coded so the copy and the behaviour cannot drift:
    editing the message without teaching the rules the new example fails here.
    """
    import re

    from services.nl_query import _CAPABILITY

    match = re.search(r"\(e\.g\.\s*(.+?)\)", _CAPABILITY, re.S)
    assert match, "capability message no longer advertises examples"
    return [part.strip() for part in match.group(1).split(",") if part.strip()]


@pytest.mark.unit
def test_capability_message_advertises_only_answerable_examples() -> None:
    service = NaturalLanguageQueryService(FakeCubeAnalytics())
    examples = _capability_examples()
    assert len(examples) >= 6

    for question in examples:
        family = service.classify(question)
        assert family != "refuse", f"advertised example not classified: {question!r}"
        answer = service.answer(question).answer
        assert "I can answer" not in answer, f"advertised example fell back: {question!r}"


# The chips on /ask are the other public entry point into the rules engine.
# Keep in step with ASK_SUGGESTIONS in services/frontend/src/lib/ask.ts.
ASK_SUGGESTIONS = (
    "What is the Wizards' record at home?",
    "What is the Warriors' win percentage in Chicago?",
    "What is the Celtics' record against the Knicks?",
    "What is the Warriors payroll?",
    "What is Curry's salary?",
    "How many back-to-backs has Kawhi Leonard played?",
    "Compare LeBron James and Stephen Curry",
    "How many leads have the Lakers blown?",
    "Who leads the West?",
    "Which team has the longest win streak?",
)


@pytest.mark.unit
@pytest.mark.parametrize("question", ASK_SUGGESTIONS)
def test_ask_page_suggestions_are_answerable(question: str) -> None:
    service = NaturalLanguageQueryService(FakeCubeAnalytics())
    answer = service.answer(question).answer
    assert "I can answer" not in answer, f"suggestion chip fell back: {question!r}"


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        "Kawhi B2Bs",
        "Kawhi b2b",
        "How many B2Bs has Kawhi Leonard played?",
        "How many back-to-backs has Kawhi Leonard played?",
        "Kawhi back to backs",
    ],
)
def test_b2b_shorthand_and_longhand_both_route(question: str) -> None:
    service = NaturalLanguageQueryService(FakeCubeAnalytics())
    assert service.classify(question) == "b2b"


@pytest.mark.unit
def test_b2b_shorthand_must_be_a_whole_token() -> None:
    service = NaturalLanguageQueryService(FakeCubeAnalytics())
    assert service.classify("Who leads the West?") == "standings"
    assert service.classify("What is player ab2bc worth?") != "b2b"


@pytest.mark.unit
def test_blown_leads_family() -> None:
    engine = NaturalLanguageQueryService(FakeCubeAnalytics())
    assert engine.classify("How many leads have the Lakers blown?") == "blown_leads"
    assert engine.classify("Lakers blown leads") == "blown_leads"
    assert engine.classify("How many comeback wins do the Warriors have?") == "blown_leads"
    # Standings is checked first, so this stays a standings question.
    assert engine.classify("Who leads the West?") == "standings"

    response = engine.answer("How many leads have the Lakers blown?")
    assert "blew 3 double-digit leads" in response.answer
    assert "the largest 21 points" in response.answer
    assert "trailing by 10 or more" in response.answer
    assert response.data[0]["blown_leads"] == 3
    assert response.data[0]["biggest_lead_blown"] == 21
    assert response.sql is not None and "team_game_flow" in response.sql


@pytest.mark.unit
def test_blown_leads_without_a_team_asks_for_one() -> None:
    engine = NaturalLanguageQueryService(FakeCubeAnalytics())
    response = engine.answer("which team choked the most?")
    assert "Name a team" in response.answer
    assert response.data == []


@pytest.mark.unit
def test_arena_city_answer_names_the_building() -> None:
    """A city is not a venue: Los Angeles hosts only Crypto.com Arena, because
    the Clippers play in Inglewood. Naming it is what makes the answer checkable."""

    class ArenaCube(FakeCubeAnalytics):
        def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
            record = super().get_team_record(team_abbreviation, **kwargs)
            record["game_list"] = [
                {"arena": "Crypto.com Arena", "arena_city": "Los Angeles"},
                {"arena": "Crypto.com Arena", "arena_city": "Los Angeles"},
            ]
            return record

    engine = NaturalLanguageQueryService(ArenaCube())
    response = engine.answer("What is the Warriors' win percentage in Los Angeles?")
    assert "(Crypto.com Arena)" in response.answer
    assert response.data[0]["split"] == "In Los Angeles"
    assert response.highlight_row == 0


# Real names for the teams the fake does not seed, so short names ("Wizards")
# resolve the way they do against Cube.
_TEAM_NAMES = {
    "BOS": "Boston Celtics",
    "MIN": "Minnesota Timberwolves",
    "NYK": "New York Knicks",
    "POR": "Portland Trail Blazers",
    "WAS": "Washington Wizards",
}


class _AllTeamsCube(FakeCubeAnalytics):
    """Every abbreviation resolves, so routing is tested without the fake's
    three-team roster standing in for a real miss."""

    def find_team(self, abbreviation: str) -> dict | None:
        found = super().find_team(abbreviation)
        if found is not None:
            return found
        return {
            "team_id": None,
            "abbreviation": abbreviation.upper(),
            "team_name": _TEAM_NAMES.get(abbreviation.upper(), f"{abbreviation.upper()} Team"),
        }


@pytest.mark.unit
def test_team_vs_team_is_not_a_player_compare() -> None:
    """ "Blazers vs Lakers" used to reach the player handler and fail with
    "No player found matching 'Portland Trailblazer'"."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    question = "What is Portland Trailblazer's win percentage vs Los Angeles Lakers"
    assert engine.classify(question) == "team_h2h"
    response = engine.answer(question)
    assert "No player found" not in response.answer
    assert response.answer == "The Blazers are 3-1 (.750) against the Lakers."
    assert response.show_data is False
    assert response.data[0]["opponent"] == "Los Angeles Lakers"
    assert response.sql is not None and "opponent=LAL" in response.sql


@pytest.mark.unit
def test_subject_team_is_the_one_named_first() -> None:
    """Longest-alias-wins made "Portland ... vs Los Angeles Lakers" a question
    about the Lakers, because their name is the longer string."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine._extract_team_abbrs(
        "Portland Trailblazer's win percentage vs Los Angeles Lakers"
    ) == ["POR", "LAL"]
    assert engine._extract_team_abbrs("Lakers vs Blazers") == ["LAL", "POR"]
    # The longer alias still wins over its own substring at the same position.
    assert engine._extract_team_abbrs("Los Angeles Lakers record") == ["LAL"]


@pytest.mark.unit
def test_one_word_team_nicknames_resolve() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    for text, abbr in (
        ("Trailblazers record", "POR"),
        ("Trailblazer's record", "POR"),
        ("Twolves record", "MIN"),
        ("Pels record", "NOP"),
        ("Grizz record", "MEM"),
    ):
        assert engine._extract_team_abbr(text) == abbr, text


@pytest.mark.unit
def test_player_compare_still_routes_to_players() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine.classify("How many more career games has LeBron played than Curry?") == "compare"
    assert engine.classify("Compare LeBron vs Curry") == "compare"


@pytest.mark.unit
@pytest.mark.parametrize(
    ("question", "expected"),
    [
        # "was" and "min" are words before they are WAS and MIN.
        ("What was the Lakers record?", ["LAL"]),
        ("How many min did the Lakers win by", ["LAL"]),
        ("WAS vs MIN", ["WAS", "MIN"]),
        # Aliases match whole words only.
        ("Who is first in the power rankings, the Bucks?", ["MIL"]),
        ("Did the Heat win heated games?", ["MIA"]),
        ("Trail Blazers record", ["POR"]),
    ],
)
def test_team_aliases_need_whole_words(question: str, expected: list[str]) -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine._extract_team_abbrs(question) == expected


@pytest.mark.unit
def test_against_with_two_teams_is_head_to_head() -> None:
    """It used to answer the first team's overall record and drop the opponent."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    for question in (
        "What is the Celtics' record against the Knicks?",
        "Lakers head-to-head with the Warriors",
    ):
        assert engine.classify(question) == "team_h2h", question
    # One team plus "against" is still a plain record question.
    assert engine.classify("Lakers record against the West") == "arena_city"


@pytest.mark.unit
def test_long_form_seasons_normalize() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine._extract_season("Lakers record in 2025-2026") == "2025-26"
    assert engine._extract_season("Lakers record in 2025-26") == "2025-26"
    response = engine.answer("Warriors record in Chicago since 2015-2016")
    assert response.sql is not None
    assert "since_season='2015-16'" in response.sql
    assert "season=None" in response.sql


@pytest.mark.unit
def test_question_words_are_not_part_of_a_name() -> None:
    engine = NaturalLanguageQueryService(FakeCubeAnalytics())
    assert engine._extract_player_names("Did Anthony Edwards play back-to-backs?") == [
        "Anthony Edwards"
    ]
    assert engine._extract_player_names("Compare Jalen Brunson vs Tyrese Haliburton") == [
        "Jalen Brunson",
        "Tyrese Haliburton",
    ]


@pytest.mark.unit
def test_empty_warehouse_answers_say_so() -> None:
    """Before any games load, answers said "Avg PTS on B2B: None" and "have
    played the same number of games (0)"."""

    class EmptyCube(FakeCubeAnalytics):
        def get_back_to_back_stats(self, player_id: str, season: str | None) -> dict:
            return {"total_back_to_backs": 0, "season": season}

        def compare_players(
            self, player_ids: list[str], stats: list[str] | None = None
        ) -> list[dict]:
            return [
                {"player_id": PLAYER_LEBRON, "full_name": "LeBron James", "career_games_played": 0},
                {"player_id": PLAYER_CURRY, "full_name": "Stephen Curry", "career_games_played": 0},
            ]

        def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
            record = super().get_team_record(team_abbreviation, **kwargs)
            return {**record, "wins": 0, "losses": 0, "win_pct": None, "games": 0}

    engine = NaturalLanguageQueryService(EmptyCube())
    b2b = engine.answer("How many back-to-backs has Kawhi Leonard played?", season="2026-27")
    assert b2b.answer == "No back-to-back sets for Kawhi Leonard in 2026-27 yet."
    compare = engine.answer("Compare LeBron James and Stephen Curry")
    assert compare.answer == "No games yet this season for LeBron James or Stephen Curry."
    record = engine.answer("What is the Warriors' win percentage in Chicago?")
    assert record.answer == "The Warriors haven't played a game in Chicago yet."


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        *ASK_SUGGESTIONS,
        "Curry PPG by season",
        "How many games back are the Lakers?",
        "Who leads the East?",
        "What is the Lakers streak?",
        "Wizards record at home",
    ],
)
def test_every_follow_up_is_answerable(question: str) -> None:
    """Follow-ups are offered as one-click questions, so each must route and
    resolve the same names, not fall back or miss."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    response = engine.answer(question)
    assert response.entities, question
    assert response.follow_ups, question
    for follow_up in response.follow_ups:
        answer = engine.answer(follow_up).answer
        assert engine.classify(follow_up) != "refuse", follow_up
        for miss in ("I can answer", "Could not", "No player found", "No team found"):
            assert miss not in answer, f"{question!r} offered {follow_up!r}: {answer}"


@pytest.mark.unit
def test_entities_name_what_the_answer_used() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    # "Chicago" is also the Bulls' alias; here it is only the city filter.
    record = engine.answer("What is the Warriors' win percentage in Chicago?", season="2025-26")
    assert [(entity.kind, entity.label) for entity in record.entities] == [
        ("team", "Golden State Warriors"),
        ("city", "Chicago"),
        ("topic", "Record"),
    ]


@pytest.mark.unit
def test_player_follow_ups_skip_names_that_would_not_round_trip() -> None:
    """ "K. Leonard" is not re-read as a name, so offering "K. Leonard salary"
    would be a dead end."""

    class BrefNames(FakeCubeAnalytics):
        def search_players(self, name: str) -> list[dict[str, Any]]:
            if name.casefold() == "leonard":
                return [{"player_id": PLAYER_KAWHI, "full_name": "K. Leonard"}]
            return []

    response = NaturalLanguageQueryService(BrefNames()).answer(
        "How many back-to-backs has Kawhi Leonard played?"
    )
    assert response.entities[0].label == "K. Leonard"
    assert response.follow_ups == []


@pytest.mark.unit
@pytest.mark.parametrize(
    ("question", "location"),
    [
        ("Wizards record at home", "home"),
        ("Lakers home record", "home"),
        ("Lakers on the road", "away"),
        ("Lakers record in away games", "away"),
    ],
)
def test_home_and_road_are_locations_not_cities(question: str, location: str) -> None:
    """ "at home" used to become a city named "home" and match no games."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine.classify(question) == "arena_city"
    response = engine.answer(question)
    assert response.sql is not None
    assert f"location='{location}'" in response.sql
    assert "arena_city=None" in response.sql


@pytest.mark.unit
@pytest.mark.parametrize(
    ("question", "prompt", "rewritten"),
    [
        (
            "what was was win rate",
            "Did you mean the Washington Wizards?",
            "what was Wizards win rate",
        ),
        ("min payroll", "Did you mean the Minnesota Timberwolves?", "Timberwolves payroll"),
        ("how many leads has was blown", "Did you mean the Washington Wizards?", None),
    ],
)
def test_lowercase_word_abbreviation_offers_the_team(
    question: str, prompt: str, rewritten: str | None
) -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    response = engine.answer(question)
    assert response.clarify is not None
    assert response.clarify.prompt == prompt
    if rewritten:
        assert response.clarify.question == rewritten
    # Accepting the suggestion has to produce an answer, not another miss.
    accepted = engine.answer(response.clarify.question)
    assert accepted.clarify is None
    assert accepted.entities


@pytest.mark.unit
def test_no_clarify_when_another_team_is_named() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    response = engine.answer("What was the Lakers record?")
    assert response.clarify is None
    assert response.entities[0].label == "Los Angeles Lakers"


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        "Which team has the longest win streak?",
        "Who has the longest winning streak right now?",
        "hottest team",
    ],
)
def test_win_streak_routes_before_standings_and_records(question: str) -> None:
    """ "win" would read as a record question and "who has" is close to "who leads"."""
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine.classify(question) == "streak"


@pytest.mark.unit
def test_longest_win_streak_names_the_leader() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    response = engine.answer("Which team has the longest win streak?")
    assert response.answer == "The Thunder have the longest win streak: 5 straight."
    # Losing streaks are not win streaks.
    assert [row["abbreviation"] for row in response.data] == ["OKC", "BOS"]
    assert ("team", "Oklahoma City Thunder") in [
        (entity.kind, entity.label) for entity in response.entities
    ]


@pytest.mark.unit
def test_tied_win_streaks_are_shared() -> None:
    class Tied(_AllTeamsCube):
        def list_standings(
            self, season: str | None = None, conference: str | None = None
        ) -> list[dict]:
            rows = super().list_standings(season, conference)
            return [{**row, "streak": "W3"} for row in rows]

    response = NaturalLanguageQueryService(Tied()).answer("longest win streak")
    assert response.answer == (
        "The Celtics, Lakers and Thunder share the longest win streak: 3 straight."
    )


@pytest.mark.unit
def test_no_win_streaks_before_games() -> None:
    class NoGames(_AllTeamsCube):
        def list_standings(
            self, season: str | None = None, conference: str | None = None
        ) -> list[dict]:
            rows = super().list_standings(season, conference)
            return [{**row, "streak": None} for row in rows]

    response = NaturalLanguageQueryService(NoGames()).answer("longest win streak")
    assert response.answer == "No team is on a win streak yet."
    assert response.data == []


@pytest.mark.unit
def test_one_teams_streak() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    response = engine.answer("What is the Lakers streak?")
    assert response.answer == "The Lakers have lost 2 straight."
    assert response.data[0]["streak"] == "L2"


@pytest.mark.unit
@pytest.mark.parametrize(
    ("question", "location", "highlight"),
    [
        ("What is the Wizards' record?", None, 0),
        ("What is the Wizards' record at home?", "home", 1),
        ("Wizards on the road", "away", 2),
    ],
)
def test_record_shows_the_split_around_the_answer(
    question: str, location: str | None, highlight: int
) -> None:
    """One W-L only repeats the sentence; Overall / Home / Away gives it context."""

    class SplitCube(_AllTeamsCube):
        def __init__(self) -> None:
            self.locations: list[str | None] = []

        def get_team_record(self, team_abbreviation: str, **kwargs) -> dict:
            self.locations.append(kwargs.get("location"))
            record = super().get_team_record(team_abbreviation, **kwargs)
            wins = {None: 18, "home": 11, "away": 7}[kwargs.get("location")]
            return {**record, "wins": wins, "losses": 82 - wins, "games": 82}

    cube = SplitCube()
    response = NaturalLanguageQueryService(cube).answer(question)
    assert [row["split"] for row in response.data] == ["Overall", "Home", "Away"]
    assert [row["wins"] for row in response.data] == [18, 11, 7]
    assert response.show_data is True
    assert response.highlight_row == highlight
    # The asked record is reused, not fetched twice.
    assert sorted(cube.locations, key=str) == sorted([None, "home", "away"], key=str)
    assert cube.locations[0] == location
    assert response.answer.startswith("The Wizards are ")


@pytest.mark.unit
def test_record_in_a_city_leads_the_split() -> None:
    response = NaturalLanguageQueryService(_AllTeamsCube()).answer(
        "What is the Warriors' win percentage in Chicago?"
    )
    assert [row["split"] for row in response.data] == ["In Chicago", "Overall", "Home", "Away"]
    assert response.highlight_row == 0
    assert response.answer == "The Warriors are 3-1 (.750) in Chicago."


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        "What is Curry's salary?",
        "What is the Warriors payroll?",
        "How many back-to-backs has Kawhi Leonard played?",
        "What is the Celtics' record against the Knicks?",
        "How many leads have the Lakers blown?",
        "How many games back are the Lakers?",
        "What is the Lakers streak?",
    ],
)
def test_one_value_answers_are_sentence_only(question: str) -> None:
    """The rows stay in data for checking, but the page should not repeat them."""
    response = NaturalLanguageQueryService(_AllTeamsCube()).answer(question)
    assert response.show_data is False


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        "Compare LeBron James and Stephen Curry",
        "Curry PPG by season",
        "Who leads the West?",
        "Which team has the longest win streak?",
    ],
)
def test_lists_and_comparisons_keep_their_table(question: str) -> None:
    response = NaturalLanguageQueryService(_AllTeamsCube()).answer(question)
    assert response.show_data is True
    assert response.data


@pytest.mark.unit
def test_sentences_and_follow_ups_use_the_short_team_name() -> None:
    response = NaturalLanguageQueryService(_AllTeamsCube()).answer(
        "What is the Wizards' record at home?"
    )
    assert response.follow_ups == [
        "Wizards record on the road",
        "Wizards payroll",
        "How many leads have the Wizards blown?",
    ]
    # The chip and the page link keep the full name.
    assert response.entities[0].label == "Washington Wizards"
    payroll = NaturalLanguageQueryService(_AllTeamsCube()).answer("What is the Warriors payroll?")
    assert payroll.answer == "The Warriors' payroll is $180M for 2025-26."
    assert payroll.value == "$180M"


@pytest.mark.unit
@pytest.mark.parametrize(
    "question",
    [
        *ASK_SUGGESTIONS,
        "Curry PPG by season",
        "How many games back are the Lakers?",
        "What is the Lakers streak?",
    ],
)
def test_value_is_quoted_from_the_answer(question: str) -> None:
    """The page bolds `value` where it appears in the sentence, so it must appear."""
    response = NaturalLanguageQueryService(_AllTeamsCube()).answer(question)
    assert response.value, question
    assert response.value in response.answer, (response.value, response.answer)


@pytest.mark.unit
def test_player_follow_ups_use_the_shortest_name_that_reads_back() -> None:
    engine = NaturalLanguageQueryService(_AllTeamsCube())
    assert engine.answer("What is Curry's salary?").follow_ups == [
        "Curry PPG by season",
        "How many back-to-backs has Curry played?",
    ]
    # "Leonard" alone is not read as anyone, so the nickname is used instead.
    assert engine.answer("How many back-to-backs has Kawhi Leonard played?").follow_ups == [
        "Kawhi salary",
        "Kawhi PPG by season",
    ]
    # Neither part of a name the engine does not know reads back on its own.
    assert engine._player_follow_ups("Anthony Edwards", ["{} salary"]) == ["Anthony Edwards salary"]
    # "Seth Curry" reads back as Stephen, so there is no safe follow-up.
    assert engine._player_follow_ups("Seth Curry", ["{} salary"]) == []
