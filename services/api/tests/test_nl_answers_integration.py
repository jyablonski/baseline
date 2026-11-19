"""Ask answer eval: real questions through the rules engine and a real Cube.

test_nl_eval.py checks routing against a fake Cube. This asks the same engine
over the Cube model in services/cube and the seeded gold in
testing/analytics_integration_seed.sql, and checks the answer itself. Every
expected value below was worked out from that seed by hand, not copied from a
run, so a case failing means the answer changed, not just the wording.

Checks structured fields (family, value, entities, the asked row), plus
phrases the sentence must contain. Never the whole sentence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import pytest
from baseline_analytics import CubeAnalytics
from services.nl_query import NaturalLanguageQueryService
from sqlalchemy import text

pytestmark = pytest.mark.integration

# The seed's season. Cube operations default to the current one, so every case
# sends it as the request season, as /ask's optional `season` field would.
SEASON = "2024-25"

GSW = ("team", "Golden State Warriors")
LAC = ("team", "LA Clippers")
CHI = ("team", "Chicago Bulls")
CURRY = ("player", "Stephen Curry")
KAWHI = ("player", "Kawhi Leonard")


@dataclass(frozen=True)
class Case:
    question: str
    family: str
    value: str | None
    entities: tuple[tuple[str, str], ...] = ()
    # A subset of the row the answer is about: `data[highlight_row]`, else `data[0]`.
    row: dict[str, Any] = field(default_factory=dict)
    highlight_row: int | None = None
    contains: tuple[str, ...] = ()
    season: str | None = SEASON
    # The answer says there is nothing to show, so it carries no rows.
    empty: bool = False

    def __str__(self) -> str:
        return self.question


CASES = [
    # Back-to-backs: only Kawhi's Oct 23 game at CHI is the second night of a set.
    Case(
        "How many back-to-backs has Kawhi played?",
        "b2b",
        "1 back-to-back sets",
        (KAWHI, ("topic", "Back-to-backs")),
        row={"games_played_in_b2b": 1, "games_sat_in_b2b": 0, "avg_pts_b2b": 24.0},
        contains=("non-B2B: 29.0",),
    ),
    Case(
        "Kawhi B2Bs",
        "b2b",
        "1 back-to-back sets",
        (KAWHI, ("topic", "Back-to-backs")),
    ),
    Case(
        "How does Curry do on back-to-backs?",
        "b2b",
        None,
        (CURRY, ("topic", "Back-to-backs")),
        row={"total_back_to_backs": 0},
        contains=("No back-to-back sets",),
    ),
    # Season averages
    Case(
        "Curry PPG by season",
        "season_stats",
        "30.5 PPG",
        (CURRY, ("topic", "Season averages")),
        row={"season": SEASON, "games_played": 2, "ppg": 30.5},
    ),
    Case(
        "Kawhi Leonard PPG by season",
        "season_stats",
        "27.3 PPG",
        (KAWHI, ("topic", "Season averages")),
        row={"games_played": 3},
    ),
    # Player compare
    Case(
        "Compare Curry vs Kawhi career games",
        "compare",
        "1 more game",
        (KAWHI, CURRY, ("topic", "Season compare")),
        row={"full_name": "Kawhi Leonard", "career_games_played": 3},
    ),
    # Asked for a per-game stat, the answer leads with it and orders by it. Real
    # Cube returns only the asked columns, so these once read "No games yet".
    Case(
        "Compare Curry vs Kawhi PPG",
        "compare",
        "30.5 PPG",
        (CURRY, KAWHI, ("topic", "Season compare")),
        row={"full_name": "Stephen Curry", "career_ppg": 30.5},
        contains=("ahead of Kawhi Leonard (27.3)",),
    ),
    Case(
        "Compare Curry vs Kawhi rebounds per game",
        "compare",
        "8.0 RPG",
        (KAWHI, CURRY, ("topic", "Season compare")),
        row={"full_name": "Kawhi Leonard", "career_rpg": 8.0},
    ),
    Case(
        "Who has more points per game, Curry or Kawhi?",
        "compare",
        "30.5 PPG",
        (CURRY, KAWHI, ("topic", "Season compare")),
    ),
    Case(
        "Curry or Kawhi, who scores more?",
        "compare",
        "30.5 PPG",
        (CURRY, KAWHI, ("topic", "Season compare")),
    ),
    Case(
        "Who averages more assists, Curry or Kawhi?",
        "compare",
        "7.5 APG",
        (CURRY, KAWHI, ("topic", "Season compare")),
        row={"career_apg": 7.5},
    ),
    Case(
        "Is Curry better than Kawhi?",
        "compare",
        "30.5 PPG",
        (CURRY, KAWHI, ("topic", "Season compare")),
    ),
    # Season averages without "by season", for the stat asked or all three.
    Case(
        "How many rebounds does Curry average?",
        "season_stats",
        "4.5 RPG",
        (CURRY, ("topic", "Season averages")),
        contains=("2 games",),
    ),
    Case(
        "Curry stats",
        "season_stats",
        "30.5 PPG, 4.5 RPG and 7.5 APG",
        (CURRY, ("topic", "Season averages")),
    ),
    Case(
        "Kawhi assists per game",
        "season_stats",
        "5.0 APG",
        (KAWHI, ("topic", "Season averages")),
    ),
    Case(
        "Curry RPG by season",
        "season_stats",
        "4.5 RPG",
        (CURRY, ("topic", "Season averages")),
        contains=("RPG by season",),
    ),
    # Team head-to-head: GSW won Oct 22 at home, LAC won Oct 25 at home.
    Case(
        "Warriors vs Clippers",
        "team_h2h",
        "1-1",
        (GSW, ("opponent", "LA Clippers"), ("topic", "Head-to-head")),
        row={"games": 2},
    ),
    Case(
        "Clippers against the Warriors",
        "team_h2h",
        "1-1",
        (LAC, ("opponent", "Golden State Warriors"), ("topic", "Head-to-head")),
    ),
    Case(
        "Clippers vs Warriors in 2024-25",
        "team_h2h",
        "1-1",
        (LAC, ("opponent", "Golden State Warriors"), ("topic", "Head-to-head")),
        contains=("in 2024-25",),
        season=None,
    ),
    # Blown leads and comebacks: LAC came back from 15 on Oct 25 (GSW blew it);
    # GSW came back from 8 on Oct 22, under the default 10.
    Case(
        "Warriors blown leads",
        "blown_leads",
        "1 double-digit lead",
        (GSW, ("topic", "Blown leads")),
        row={"games": 2, "blown_leads": 1, "biggest_lead_blown": 15, "comeback_wins": 0},
    ),
    Case(
        "Warriors blew a lead",
        "blown_leads",
        "1 double-digit lead",
        (GSW, ("topic", "Blown leads")),
    ),
    Case(
        "Did the Warriors blow any leads?",
        "blown_leads",
        "1 double-digit lead",
        (GSW, ("topic", "Blown leads")),
    ),
    Case(
        "Clippers comebacks",
        "blown_leads",
        "1 game",
        (LAC, ("topic", "Comebacks")),
        row={"games": 3, "comeback_wins": 1, "biggest_comeback": 15, "blown_leads": 0},
        contains=("from 15 down",),
    ),
    Case(
        "Clippers comebacks from 12 down",
        "blown_leads",
        "1 game",
        (LAC, ("topic", "Comebacks")),
        row={"min_margin": 12, "comeback_wins": 1},
        contains=("vs GSW on Oct 25",),
    ),
    Case(
        "Warriors comebacks of 20 or more",
        "blown_leads",
        "0 games",
        (GSW, ("topic", "Comebacks")),
        row={"min_margin": 20, "comeback_wins": 0, "blown_leads": 0},
    ),
    # Records by arena city and home / road. LAC: L at GSW, W at CHI, W at home
    # vs GSW. GSW: W at home, L at LAC, never in Chicago.
    Case(
        "Clippers record in Chicago",
        "arena_city",
        "1-0",
        (LAC, ("city", "Chicago"), ("topic", "Record")),
        row={"split": "In Chicago", "wins": 1, "losses": 0},
        highlight_row=0,
        contains=("United Center",),
    ),
    Case(
        "Warriors win percentage in San Francisco",
        "arena_city",
        "1-0",
        (GSW, ("city", "San Francisco"), ("topic", "Record")),
        row={"split": "In San Francisco"},
        highlight_row=0,
        contains=("Chase Center",),
    ),
    Case(
        "Warriors record in Chicago",
        "arena_city",
        None,
        (GSW, ("city", "Chicago"), ("topic", "Record")),
        contains=("haven't played a game in Chicago",),
        empty=True,
    ),
    Case(
        "Warriors record at home",
        "arena_city",
        "1-0",
        (GSW, ("location", "Home games"), ("topic", "Record")),
        row={"split": "Home", "wins": 1, "losses": 0},
        highlight_row=1,
    ),
    Case(
        "Clippers record on the road",
        "arena_city",
        "1-1",
        (LAC, ("location", "Road games"), ("topic", "Record")),
        row={"split": "Away", "wins": 1, "losses": 1},
        highlight_row=2,
    ),
    # Salary and payroll snapshots
    Case(
        "What is Curry's salary?",
        "salary",
        "$50M",
        (CURRY, ("topic", "Salary")),
        row={"current_season_salary": 50000000},
    ),
    Case(
        "How much does Kawhi make?",
        "salary",
        "$45M",
        (KAWHI, ("topic", "Salary")),
        row={"current_season_salary": 45000000},
    ),
    Case(
        "What is the Warriors payroll?",
        "salary",
        "$51M",
        (GSW, ("topic", "Payroll")),
        row={"current_season_payroll": 51000000},
    ),
    Case(
        "What is LeBron's salary?",
        "salary",
        None,
        contains=("No player found",),
        empty=True,
    ),
    # Standings
    Case(
        "Who leads the West?",
        "standings",
        "The Warriors",
        (("topic", "West standings"),),
        row={"abbreviation": "GSW", "wins": 50, "losses": 32},
        highlight_row=0,
    ),
    Case(
        "Who leads the East?",
        "standings",
        "The Bulls",
        (("topic", "East standings"),),
        row={"abbreviation": "CHI"},
        highlight_row=0,
    ),
    Case(
        "How many games back are the Clippers?",
        "standings",
        "1.5 games back",
        (LAC, ("topic", "Games back")),
        row={"conference_rank": 2},
    ),
    # Best / worst record ranks by win_pct, not conference rank: GSW .610,
    # LAC .593, CHI .549 (CHI is the East's #5 but its only seeded team).
    Case(
        "Who has the best record?",
        "standings",
        "The Warriors",
        (("topic", "Standings"),),
        row={"abbreviation": "GSW", "wins": 50, "losses": 32},
        highlight_row=0,
        contains=("best record in the league",),
    ),
    Case(
        "Who leads the league?",
        "standings",
        "The Warriors",
        (("topic", "Standings"),),
        row={"abbreviation": "GSW"},
        highlight_row=0,
        contains=("best record in the league",),
    ),
    Case(
        "Who has the worst record?",
        "standings",
        "The Bulls",
        (("topic", "Standings"),),
        row={"abbreviation": "CHI", "wins": 45, "losses": 37},
        highlight_row=2,
        contains=("worst record in the league",),
    ),
    Case(
        "Worst record in the West",
        "standings",
        "The Clippers",
        (("topic", "West standings"),),
        row={"abbreviation": "LAC"},
        highlight_row=1,
        contains=("worst record in the West",),
    ),
    # Injuries: the seed's report lists Curry Out and Kawhi Day To Day.
    Case(
        "Is Curry injured?",
        "injuries",
        "Out",
        (CURRY, ("topic", "Injuries")),
        row={"player_name": "Stephen Curry"},
        contains=("Out (Ankle) - Left ankle sprain",),
    ),
    Case(
        "Is Kawhi playing tonight?",
        "injuries",
        "Day To Day",
        (KAWHI, ("topic", "Injuries")),
        contains=("Day To Day (Knee) - Soreness",),
    ),
    Case(
        "Who is injured on the Warriors?",
        "injuries",
        "1 player",
        (GSW, ("topic", "Injuries")),
        row={"player_name": "Stephen Curry"},
        contains=("Stephen Curry (Out)",),
    ),
    Case(
        "Who is hurt on the Bulls?",
        "injuries",
        None,
        (CHI, ("topic", "Injuries")),
        contains=("No Bulls players are on the injury report",),
        empty=True,
    ),
    # MVP ladder, Regular Season: Kawhi 25.5 (#1), Curry 22.5 (#2).
    Case(
        "Who is leading the MVP race?",
        "mvp",
        "Kawhi Leonard",
        (("topic", "MVP ladder"),),
        row={"mvp_rank": 1, "mvp_score": 25.5},
        highlight_row=0,
        contains=("ahead of Stephen Curry (22.5)",),
    ),
    Case(
        "Curry MVP rank",
        "mvp",
        "#2",
        (CURRY, ("topic", "MVP ladder")),
        row={"mvp_rank": 2, "mvp_score": 22.5},
        contains=("2 games",),
    ),
    # Game log, most recent first: Curry's Oct 25 loss at LAC; Kawhi's three games.
    Case(
        "How did Curry play last night?",
        "game_log",
        "29 points",
        (CURRY, ("topic", "Game log")),
        row={"game_date": "2024-10-25", "opponent": "LAC", "result": "L", "minutes": 37},
        contains=("5 rebounds and 7 assists in a loss at LAC on Oct 25",),
    ),
    Case(
        "How many points did Kawhi score last night?",
        "game_log",
        "30 points",
        (KAWHI, ("topic", "Game log")),
        contains=("in a win vs GSW",),
    ),
    Case(
        "Kawhi last 3 games",
        "game_log",
        "27.3 PPG",
        (KAWHI, ("topic", "Game log")),
        row={"game_date": "2024-10-25", "points": 30},
        contains=("8.0 RPG and 5.0 APG over the last 3 games (2-1)",),
    ),
    # League leaders need 70% of the most games played: Kawhi has 3, so 3 to
    # qualify, and Curry's 2 don't. Within one team, it's the team's most games.
    Case(
        "Who leads the league in scoring?",
        "leaders",
        "27.3 PPG",
        (("topic", "PPG leaders"),),
        row={"full_name": "Kawhi Leonard", "games_played": 3},
        highlight_row=0,
        contains=("Kawhi Leonard leads the league in scoring", "at least 3 games"),
    ),
    Case(
        "Top rebounders",
        "leaders",
        "8.0 RPG",
        (("topic", "RPG leaders"),),
        highlight_row=0,
    ),
    Case(
        "Who leads the Warriors in rebounds?",
        "leaders",
        "4.5 RPG",
        (GSW, ("topic", "RPG leaders")),
        row={"full_name": "Stephen Curry", "games_played": 2},
        highlight_row=0,
        contains=("at least 2 games",),
    ),
    Case(
        "Who leads the West in rebounds?",
        "leaders",
        None,
        contains=("not by conference",),
        empty=True,
    ),
    # Trends: Curry qualifies and is the biggest riser; Kawhi has too few games.
    Case(
        "Who's hot?",
        "trends",
        "Stephen Curry",
        (("topic", "Trending up"),),
        row={"trend_rank": 1, "mvp_game_score_change": 5.5},
        highlight_row=0,
        contains=("MVP game score 28.1 over the last 10 games, +5.5 on the games before (22.6)",),
    ),
    Case(
        "Is Curry hot?",
        "trends",
        "trending up",
        (CURRY, ("topic", "Trend")),
    ),
    Case(
        "Is Kawhi trending?",
        "trends",
        None,
        (KAWHI, ("topic", "Trend")),
        contains=("doesn't have enough games for a trend",),
        empty=True,
    ),
    Case(
        "Who is trending down?",
        "trends",
        None,
        (("topic", "Trending down"),),
        empty=True,
    ),
    # Team stats: GSW ranks 1st of the two seeded teams in each rating.
    Case(
        "Warriors offensive rating",
        "team_stats",
        "129.6",
        (GSW, ("topic", "Team stats")),
        contains=("1st of 2",),
    ),
    Case(
        "Clippers 3-point percentage",
        "team_stats",
        "41.7%",
        (LAC, ("topic", "Team stats")),
        contains=("2nd of 2",),
    ),
    Case(
        "Warriors stats",
        "team_stats",
        "+16.2",
        (GSW, ("topic", "Team stats")),
        contains=("offensive rating 129.6 (1st)", "defensive rating 113.4 (1st)"),
    ),
    # The last-10 split has no possession stats in the seed, so no ratings.
    Case(
        "Warriors stats last 10",
        "team_stats",
        "30.5",
        (GSW, ("topic", "Team stats")),
        row={"split": "last_10", "offensive_rating": None},
        contains=("over the last 10 games: points per game 30.5",),
    ),
    Case(
        "Which team has the best defense?",
        "team_rank",
        "113.4",
        (("topic", "Defensive rating ranking"),),
        row={"abbreviation": "GSW", "defensive_rating_rank": 1},
        highlight_row=0,
    ),
    Case(
        "Who has the worst offense?",
        "team_rank",
        "113.4",
        (("topic", "Offensive rating ranking"),),
        row={"abbreviation": "LAC", "offensive_rating_rank": 2},
        highlight_row=0,
    ),
    Case(
        "Which team scores the most?",
        "team_rank",
        "30.5",
        (("topic", "Points per game ranking"),),
        row={"abbreviation": "GSW"},
        highlight_row=0,
    ),
    # Rosters: players whose current team is this one.
    Case(
        "Who is on the Clippers roster?",
        "roster",
        "1 player",
        (LAC, ("topic", "Roster")),
        row={"full_name": "Kawhi Leonard"},
    ),
    Case(
        "Who plays for the Warriors?",
        "roster",
        "1 player",
        (GSW, ("topic", "Roster")),
        contains=("Stephen Curry",),
    ),
    # Win streaks, from the standings `streak` field
    Case(
        "Who has the longest win streak?",
        "streak",
        "5 straight",
        (GSW, ("topic", "Win streak")),
        row={"abbreviation": "GSW", "streak": "W5"},
    ),
    Case(
        "Bulls win streak",
        "streak",
        "won 2 straight",
        (CHI, ("topic", "Win streak")),
    ),
    Case(
        "Clippers streak",
        "streak",
        "lost 1 straight",
        (LAC, ("topic", "Win streak")),
    ),
]

# Outside the nine families: the capability message, never an error or rows.
REFUSED = [
    "What is the meaning of life?",
    # Lowercase "was" is not the Wizards.
    "What was the score last night?",
    # This used to get a confident wrong answer: the Warriors' record.
    "Who wins tonight, Warriors or Clippers?",
]


@pytest.fixture(scope="module")
def db_today(postgres_engine) -> date:
    """The seed dates the schedule and injuries from Postgres CURRENT_DATE,
    which is UTC in the container, so "today" comes from there too."""
    with postgres_engine.connect() as connection:
        return connection.execute(text("SELECT CURRENT_DATE")).scalar_one()


@pytest.fixture(scope="module")
def service(cube: CubeAnalytics, db_today: date) -> NaturalLanguageQueryService:
    return NaturalLanguageQueryService(cube, today=lambda: db_today)


@pytest.mark.parametrize("case", CASES, ids=str)
def test_ask_answers(service: NaturalLanguageQueryService, case: Case) -> None:
    assert service.classify(case.question) == case.family

    response = service.answer(case.question, season=case.season)

    assert response.value == case.value, response.answer
    if case.value is not None:
        assert case.value in response.answer
    assert tuple((e.kind, e.label) for e in response.entities) == case.entities, response.answer
    assert response.highlight_row == case.highlight_row
    for phrase in case.contains:
        assert phrase in response.answer, response.answer
    if case.empty:
        assert response.data == [], response.answer
    if case.row:
        assert response.data, response.answer
        asked = response.data[case.highlight_row or 0]
        assert {key: asked.get(key) for key in case.row} == case.row


@pytest.mark.parametrize("question", REFUSED)
def test_ask_refuses_outside_the_families(
    service: NaturalLanguageQueryService, question: str
) -> None:
    assert service.classify(question) == "refuse"

    response = service.answer(question, season=SEASON)

    assert response.answer.startswith("I can answer")
    assert response.data == []
    assert response.entities == []


def test_lowercase_was_offers_the_wizards(service: NaturalLanguageQueryService) -> None:
    response = service.answer("was record at home", season=SEASON)

    assert response.data == []
    assert response.clarify is not None
    assert response.clarify.question == "Wizards record at home"


def _short(day: date) -> str:
    return f"{day:%b} {day.day}"


def test_next_game_is_the_first_one_not_played(
    service: NaturalLanguageQueryService, db_today: date
) -> None:
    """The seed puts GSW-LAC at Chase Center 14 days out (ESPN, ABC) and the
    return game at Intuit Dome a day later."""
    first = db_today + timedelta(days=14)

    home = service.answer("When do the Warriors play next?", season=SEASON)
    assert home.value == _short(first)
    assert home.answer == f"The Warriors host the Clippers on {_short(first)} (ESPN, ABC)."
    assert [row["location"] for row in home.data] == ["home", "away"]

    away = service.answer("Clippers next game", season=SEASON)
    assert away.answer == f"The Clippers play at the Warriors on {_short(first)} (ESPN, ABC)."

    not_today = service.answer("Are the Warriors playing tonight?", season=SEASON)
    assert not_today.answer.startswith("The Warriors don't play today. Next, they host")


def test_game_day_reads_tonight(cube: CubeAnalytics, db_today: date) -> None:
    game_day = db_today + timedelta(days=14)
    engine = NaturalLanguageQueryService(cube, today=lambda: game_day)

    team = engine.answer("Are the Warriors playing tonight?", season=SEASON)
    assert team.value == "tonight"
    assert team.answer == "The Warriors host the Clippers tonight (ESPN, ABC)."

    slate = engine.answer("Who plays tonight?", season=SEASON)
    assert slate.value == "1 game"
    assert slate.answer == "1 game today: Clippers at Warriors (ESPN, ABC)."


def test_no_games_today(service: NaturalLanguageQueryService) -> None:
    response = service.answer("What games are on tonight?", season=SEASON)

    assert response.answer == "No games are scheduled today."
    assert response.data == []
