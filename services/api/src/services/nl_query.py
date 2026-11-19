"""Rule-based natural-language query routing over Cube named operations.

Covers B2B, season compare, arena-city W/L, blown leads, remaining
salary/payroll, and standings. Each handler runs a Cube query via CubeAnalytics. Adding a family
is a Cube member plus one intent — not a new gold SQL string.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from baseline_analytics.errors import CubeError
from baseline_analytics.operations import CubeAnalytics

from schemas.game import EntityKind, QueryClarify, QueryEntity, QueryResponse

TEAM_ALIASES: dict[str, str] = {
    "hawks": "ATL",
    "atlanta": "ATL",
    "atlanta hawks": "ATL",
    "celtics": "BOS",
    "boston": "BOS",
    "boston celtics": "BOS",
    "nets": "BKN",
    "brooklyn": "BKN",
    "brooklyn nets": "BKN",
    "hornets": "CHA",
    "charlotte": "CHA",
    "charlotte hornets": "CHA",
    "bulls": "CHI",
    "chicago": "CHI",
    "chicago bulls": "CHI",
    "cavaliers": "CLE",
    "cleveland cavaliers": "CLE",
    "cavs": "CLE",
    "cleveland": "CLE",
    "mavericks": "DAL",
    "dallas mavericks": "DAL",
    "mavs": "DAL",
    "dallas": "DAL",
    "nuggets": "DEN",
    "denver nuggets": "DEN",
    "denver": "DEN",
    "pistons": "DET",
    "detroit": "DET",
    "warriors": "GSW",
    "golden state": "GSW",
    "golden state warriors": "GSW",
    "rockets": "HOU",
    "houston": "HOU",
    "pacers": "IND",
    "indiana": "IND",
    "clippers": "LAC",
    "la clippers": "LAC",
    "los angeles clippers": "LAC",
    "lakers": "LAL",
    "la lakers": "LAL",
    "los angeles lakers": "LAL",
    "grizzlies": "MEM",
    "grizz": "MEM",
    "memphis grizzlies": "MEM",
    "memphis": "MEM",
    "heat": "MIA",
    "miami": "MIA",
    "bucks": "MIL",
    "milwaukee": "MIL",
    "timberwolves": "MIN",
    "twolves": "MIN",
    "minnesota timberwolves": "MIN",
    "wolves": "MIN",
    "minnesota": "MIN",
    "pelicans": "NOP",
    "pels": "NOP",
    "new orleans pelicans": "NOP",
    "new orleans": "NOP",
    "knicks": "NYK",
    "new york": "NYK",
    "thunder": "OKC",
    "okc": "OKC",
    "oklahoma city": "OKC",
    "oklahoma city thunder": "OKC",
    "magic": "ORL",
    "orlando": "ORL",
    "sixers": "PHI",
    "76ers": "PHI",
    "philly": "PHI",
    "philadelphia": "PHI",
    "suns": "PHX",
    "phoenix": "PHX",
    "blazers": "POR",
    "trail blazer": "POR",
    "trailblazer": "POR",
    "trail blazers": "POR",
    "trailblazers": "POR",
    "portland": "POR",
    "kings": "SAC",
    "sacramento": "SAC",
    "spurs": "SAS",
    "san antonio spurs": "SAS",
    "san antonio": "SAS",
    "raptors": "TOR",
    "toronto raptors": "TOR",
    "toronto": "TOR",
    "jazz": "UTA",
    "utah": "UTA",
    "wizards": "WAS",
    "washington": "WAS",
}

# The capability message advertises the "B2B" shorthand, so accept it here too.
_B2B = re.compile(
    r"back[\s-]*to[\s-]*backs?|\bb2bs?\b",
    re.IGNORECASE,
)
_COMPARE = re.compile(
    r"\b("
    r"compare|"
    r"vs\.?|"
    r"versus|"
    r"more\s+(?:career\s+)?games|"
    r"how\s+many\s+more"
    r")\b",
    re.IGNORECASE,
)
# Two named teams plus one of these is a head-to-head even without "vs".
_AGAINST = re.compile(r"\b(against|head[\s-]*to[\s-]*head|h2h)\b", re.IGNORECASE)
_WIN_PCT = re.compile(
    r"\b(win(?:s|ning)?(?:\s+percentage|\s+pct|%)?|record|winning\s+percentage)\b",
    re.IGNORECASE,
)
_STANDINGS = re.compile(
    r"\b("
    r"standings?|"
    r"games?\s+back|"
    r"games?\s+behind|"
    r"who\s+leads?|"
    r"leading\s+the|"
    r"(?:eastern|western)\s+conference|"
    r"(?:east|west)\s+conference"
    r")\b",
    re.IGNORECASE,
)
_BEST_RECORD = re.compile(r"\b(best|worst)\s+record\b", re.IGNORECASE)
# "Who leads the league in scoring" and "who is leading the MVP race" are player
# questions that the standings words above would otherwise answer with a team.
_PLAYER_LEADER = re.compile(
    r"\b("
    r"mvp|scor(?:ing|ers?|es)|points|rebound(?:s|ing|ers?)?|assists?|blocks?|steals?|"
    r"threes|three[\s-]*pointers?|triple[\s-]*doubles?|minutes"
    r")\b",
    re.IGNORECASE,
)
# Rules answers report what happened, never who will win: "who wins tonight,
# Warriors or Lakers" would otherwise read "wins" as a record question.
_PREDICTION = re.compile(
    r"\bwho\s+(?:wins|will\s+win|is\s+going\s+to\s+win)\b"
    r"|\bwill\b[^?.]*\bwin\b"
    r"|\bgoing\s+to\s+win\b"
    r"|\b(?:predict(?:ed|ions?)?|odds|favou?red|favou?rites?|spread|moneyline)\b",
    re.IGNORECASE,
)
# The league's calendar: "tonight" at 10pm Pacific is still today in the East.
_EASTERN = ZoneInfo("America/New_York")
_MVP = re.compile(r"\bmvp\b", re.IGNORECASE)
_INJURY = re.compile(
    r"\b(injur(?:y|ies|ed)|hurt|questionable|day[\s-]*to[\s-]*day|out\s+(?:tonight|today)|healthy)\b",
    re.IGNORECASE,
)
# "Is Curry playing tonight?" with a player is an injury question; with a team
# ("Are the Warriors playing tonight?") it is a schedule one.
_PLAYING_TODAY = re.compile(r"\bplay(?:s|ing)?\b[^?.]*\b(?:tonight|today)\b", re.IGNORECASE)
_GAME_LOG = re.compile(
    r"\b(?:last\s+(?:night|game|(?:\d{1,2}|three|five|ten)\s+games)|latest\s+game|"
    r"most\s+recent\s+game|game\s+log|recent\s+games|yesterday)\b"
    r"|\bhow\s+did\b[^?.]*\bplay\b",
    re.IGNORECASE,
)
_LAST_N = re.compile(r"\blast\s+(\d{1,2}|three|five|ten)\s+games\b", re.IGNORECASE)
_NUMBER_WORDS = {"three": 3, "five": 5, "ten": 10}
_MAX_LAST_N = 10
_SCHEDULE = re.compile(
    r"\b(?:next\s+game|play(?:s|ing)?\s+next|next\s+opponent|upcoming\s+games?|schedule)\b"
    r"|\bwhen\s+(?:do|does|is|are)\b[^?.]*\bplay",
    re.IGNORECASE,
)
_TODAY = re.compile(r"\b(?:tonight|today)\b", re.IGNORECASE)
# Today's slate when no team is named: "Who plays tonight?", "games on today".
_SLATE = re.compile(r"\b(?:games?|plays?|playing|on)\b[^?.]*\b(?:tonight|today)\b", re.IGNORECASE)
_ROSTER = re.compile(
    r"\broster\b|\bwho\s+(?:is|are|plays?)\s+(?:on|for)\b|\bplayers\s+(?:on|for)\b", re.IGNORECASE
)
_TRENDING = re.compile(
    r"\b(?:hot|hottest\s+players?|cold|coldest|trending|heating\s+up|cooling\s+off|"
    r"on\s+fire|slump(?:ing|s)?)\b",
    re.IGNORECASE,
)
_TRENDING_DOWN = re.compile(
    r"\b(?:cold|coldest|trending\s+down|cooling\s+off|slump(?:ing|s)?)\b", re.IGNORECASE
)
_TREND_LABELS = {"up": "trending up", "down": "trending down", "steady": "steady"}
# "Who leads the league in scoring", "top scorers", "which team has the best
# defense": a ranking word plus a player or team stat.
_LEADER_WORDS = re.compile(
    r"\b(?:leads|leading|leaders?|top|most|best|highest|worst|lowest|fewest|fastest|slowest)\b",
    re.IGNORECASE,
)
_WORST = re.compile(r"\b(?:worst|lowest|fewest|least|slowest|bottom)\b", re.IGNORECASE)
_TEAM_WORD = re.compile(r"\bteams?\b", re.IGNORECASE)
_LEADER_NOUNS = {"ppg": "scoring", "rpg": "rebounding", "apg": "assists"}
# Most specific first: "points allowed" before "points", "net rating" before "offense".
_TEAM_STAT_PATTERNS = (
    (
        re.compile(r"\b(?:points?\s+allowed|allows?|opponent\s+points)\b", re.IGNORECASE),
        "opponent_points_per_game",
    ),
    (re.compile(r"\bnet\s+rating\b", re.IGNORECASE), "net_rating"),
    (
        re.compile(r"\b(?:defen[cs]e|defensive(?:\s+rating)?|drtg)\b", re.IGNORECASE),
        "defensive_rating",
    ),
    (
        re.compile(r"\b(?:offen[cs]e|offensive(?:\s+rating)?|ortg)\b", re.IGNORECASE),
        "offensive_rating",
    ),
    (re.compile(r"\b(?:pace|fastest|slowest)\b", re.IGNORECASE), "pace"),
    (
        re.compile(r"\b(?:3\s*-?\s*point|three[\s-]*point|3pt|from\s+three)\b", re.IGNORECASE),
        "three_point_pct",
    ),
    (
        re.compile(r"\b(?:ppg|points?\s+per\s+game|scor(?:es|ing))\b", re.IGNORECASE),
        "points_per_game",
    ),
)
_TEAM_STAT_LABELS = {
    "offensive_rating": "offensive rating",
    "defensive_rating": "defensive rating",
    "net_rating": "net rating",
    "pace": "pace",
    "points_per_game": "points per game",
    "opponent_points_per_game": "points allowed per game",
    "three_point_pct": "3-point percentage",
}
_TEAM_STATS_WORD = re.compile(r"\b(?:stats|numbers|ratings?)\b", re.IGNORECASE)
_TEAM_SPLITS = (
    (re.compile(r"\blast\s+(?:10|ten)\b", re.IGNORECASE), "last_10", " over the last 10 games"),
    (re.compile(r"\b(?:at\s+home|home)\b", re.IGNORECASE), "home", " at home"),
    (re.compile(r"\b(?:on\s+the\s+road|road|away)\b", re.IGNORECASE), "away", " on the road"),
)
# Checked before standings and records, which "win" and "leads" would also match.
_STREAK = re.compile(r"\b(?:win(?:ning)?\s+streaks?|streaks?|hottest\s+teams?)\b", re.IGNORECASE)
_WIN_STREAK_VALUE = re.compile(r"^\s*W\s*(\d+)\s*$", re.IGNORECASE)
_SALARY = re.compile(
    r"\b(salary|payroll|contract|how much does|how much is|how much do)\b",
    re.IGNORECASE,
)
_PAYROLL = re.compile(r"\bpayroll\b", re.IGNORECASE)
# The last two alternatives catch the split phrasing "how many leads have the
# Lakers blown", where the noun and the participle are not adjacent.
_BLOWN_LEADS = re.compile(
    r"\b(blown\s+leads?|blew\s+(?:a\s+|the\s+)?lead|collapses?|choked)\b"
    r"|\b(?:blow|blows|blowing|blew)\b[^?.]*\bleads?\b"
    r"|\bleads?\b[^?.]*\bblown\b"
    r"|\bblown\b[^?.]*\bleads?\b",
    re.IGNORECASE,
)
# Comeback phrasing, routed to the same flow family; it decides which side of
# the answer leads. "come back home" is about the schedule, not a deficit.
_COMEBACK = re.compile(
    r"\b(?:comebacks?|come\s+back(?!\s+home)|came\s+back|coming\s+back|"
    r"rall(?:y|ied|ies)\s+from|overc[ao]me|erased?\s+(?:a\s+)?(?:\d+\s*-?\s*point\s+)?deficits?|"
    r"(?:biggest|largest)\s+deficits?)\b",
    re.IGNORECASE,
)
# "by 15", "of 20", "from 18 down", "15+", "20 or more", "a 15-point lead"; "more
# than 15" / "over 15" mean 16 or more. Two digits at most and a word boundary,
# so "2025-26" never reads as a margin.
_FLOW_MARGIN = re.compile(
    r"\b(?:(more\s+than|over)|by|of|from|at\s+least)\s+(\d{1,2})\b(?!\s*-\s*\d)"
    r"|\b(\d{1,2})(?:\s*\+|\s*-?\s*(?:points?|pts?)\b|\s+or\s+more\b|\s+down\b)",
    re.IGNORECASE,
)
_MAX_FLOW_MARGIN = 60
_SEASON_STATS = re.compile(
    r"("
    r"(?:ppg|rpg|apg|points?\s+per\s+game|rebounds?\s+per\s+game|assists?\s+per\s+game)"
    r".{0,40}\b(?:by|per|each)\s+season"
    r"|"
    r"(?:by|per|each)\s+season.{0,40}"
    r"(?:ppg|rpg|apg|points?\s+per\s+game|rebounds?\s+per\s+game|assists?\s+per\s+game)"
    r")",
    re.IGNORECASE,
)
_CONFERENCE = re.compile(
    r"\b(eastern|western|east|west)\b",
    re.IGNORECASE,
)
# "2025-26" or "2025-2026"; both normalize to the warehouse's "2025-26".
_SEASON = re.compile(r"\b(\d{4})-(\d{2}|\d{4})\b")
_SINCE_SEASON = re.compile(r"\bsince\s+(\d{4})-(\d{2}|\d{4})\b", re.IGNORECASE)
_IN_CITY = re.compile(
    r"\b(?:in|at)\s+([A-Za-z][A-Za-z .'-]{1,40}?)"
    r"(?=\s+(?:since|during|from|after|before|in\s+the)|[?.!,]|$)",
    re.IGNORECASE,
)
_PLAYER_NAME = re.compile(
    r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b",
)
# Sentence-initial capitals that _PLAYER_NAME would glue onto a name
# ("Did Anthony Edwards" -> "Anthony Edwards").
_NAME_LEADING_WORDS = frozenset(
    {
        "can",
        "compare",
        "did",
        "do",
        "does",
        "has",
        "have",
        "how",
        "is",
        "show",
        "tell",
        "was",
        "what",
        "which",
        "who",
    }
)
# Abbreviations that are also English words only count when typed in capitals,
# or "What was the Lakers record" is a question about the Wizards. When no other
# team is named, the lowercase word is offered back as a "did you mean".
_WORD_ABBR_TEAMS: dict[str, tuple[str, str]] = {
    "MIN": ("Minnesota Timberwolves", "Timberwolves"),
    "WAS": ("Washington Wizards", "Wizards"),
}
_AT_HOME = re.compile(r"\b(?:at\s+home|home\s+(?:games?|record))\b", re.IGNORECASE)
_ON_ROAD = re.compile(
    r"\b(?:on\s+the\s+road|road\s+(?:games?|record)|away(?:\s+games?)?)\b",
    re.IGNORECASE,
)
# What _IN_CITY captures from "at home" / "on the road"; not cities.
_NOT_CITIES = frozenset({"home", "road", "the road"})

_CAPABILITY = (
    "I can answer back-to-back questions, player compares, "
    "team win percentage filtered by arena city, team head-to-head records, "
    "blown leads and comebacks, salary/payroll snapshots, "
    "standings, win streaks, per-season averages, injuries, the schedule, "
    "the MVP ladder, recent games, league leaders, who's trending, team stats and rosters "
    "(e.g. Kawhi B2Bs, LeBron vs Curry, Warriors in Chicago, Blazers vs Lakers, "
    "Lakers blown leads, Celtics comebacks from 15+, "
    "Curry salary, Warriors payroll, who leads the West, longest win streak, "
    "Curry PPG by season, Is Curry injured, Warriors next game, MVP ladder, "
    "Curry last game, who leads the league in scoring, who's hot, Warriors offensive rating, "
    "Warriors roster). "
)

_HIDDEN_ASK_KEYS = frozenset(
    {
        "player_id",
        "team_id",
        "filters_applied",
        "game_list",
        "player_name",
        "total_b2b_games",
        "avg_pts_in_b2b",
        "match_method",
        "source",
        "is_active",
    }
)
_B2B_ASK_KEYS = (
    "full_name",
    "season",
    "total_back_to_backs",
    "games_played_in_b2b",
    "games_sat_in_b2b",
    "avg_pts_b2b",
    "avg_pts_non_b2b",
    "avg_pts_overall",
)
_COMPARE_ASK_KEYS = (
    "full_name",
    "career_games_played",
    "career_ppg",
    "career_rpg",
    "career_apg",
)
# Order matters: the first match is the stat the answer leads with. "per game"
# is excluded from the counting stats, or "points per game" also asks for total
# points and "rebounds per game" for games played. Bare "rebounds" / "assists"
# read as per game, since there are no totals for them.
_COMPARE_STAT_PATTERNS = (
    (
        re.compile(r"\b(ppg|points?\s+per\s+game|scor(?:es|ing|er))\b", re.IGNORECASE),
        "career_ppg",
    ),
    (re.compile(r"\b(rpg|rebound(?:s|ing)?)\b", re.IGNORECASE), "career_rpg"),
    (re.compile(r"\b(apg|assists?)\b", re.IGNORECASE), "career_apg"),
    (re.compile(r"\b(seasons?)\b", re.IGNORECASE), "seasons_played"),
    (
        re.compile(r"\b(total\s+points|points)\b(?!\s+per\s+game)", re.IGNORECASE),
        "total_points",
    ),
    (re.compile(r"\bteams?\b", re.IGNORECASE), "teams_played_for"),
    (re.compile(r"(?<!per\s)\b(games?|gp)\b", re.IGNORECASE), "career_games_played"),
)
_PER_GAME_COMPARE = {"career_ppg": "PPG", "career_rpg": "RPG", "career_apg": "APG"}
_COUNT_COMPARE = {
    "career_games_played": ("game", "games"),
    "seasons_played": ("season", "seasons"),
    "total_points": ("point", "points"),
    "teams_played_for": ("team", "teams"),
}
# Two players and one of these, without "compare" or "vs": "Curry or LeBron,
# who scores more?", "Is Curry better than LeBron?".
_COMPARE_LOOSE = re.compile(r"\b(or|better|than|more|higher|fewer|less)\b", re.IGNORECASE)
# "Better" names no stat, so it is read as scoring rather than games played.
_BETTER = re.compile(r"\bbetter\b", re.IGNORECASE)
# One player and one of these is a season-averages question even without "by
# season": "How many rebounds does Curry average?", "Curry stats".
_PLAYER_AVERAGE = re.compile(
    r"\b(averag(?:e|es|ed|ing)|stats|numbers|stat\s+line|ppg|rpg|apg|per\s+game)\b",
    re.IGNORECASE,
)
# Season averages and league leaders: the three per-game stats the season-stats cube holds.
_SEASON_STAT_PATTERNS = (
    (re.compile(r"\b(?:ppg|points?|scor(?:es|ing|ers?))\b", re.IGNORECASE), "ppg"),
    (re.compile(r"\b(?:rpg|rebound(?:s|ing|ers?)?)\b", re.IGNORECASE), "rpg"),
    (re.compile(r"\b(?:apg|assists?)\b", re.IGNORECASE), "apg"),
)
_SEASON_STAT_LABELS = {"ppg": "PPG", "rpg": "RPG", "apg": "APG"}
_INJURY_ASK_KEYS = ("player_name", "team_abbreviation", "description", "update_date")
_SCHEDULE_ASK_KEYS = ("game_date", "opponent", "location", "national_tv")
_SLATE_ASK_KEYS = ("away_team", "home_team", "status", "national_tv")
_MVP_ASK_KEYS = ("mvp_rank", "full_name", "team_abbreviation", "mvp_score", "games_played")
_TREND_ASK_KEYS = (
    "full_name",
    "team_abbreviation",
    "trend_direction",
    "trend_rank",
    "mvp_game_score_last_10",
    "mvp_game_score_baseline",
    "mvp_game_score_change",
    "points_last_10",
    "points_change",
)
_TEAM_STATS_ASK_KEYS = (
    "split",
    "games",
    "wins",
    "losses",
    "net_rating",
    "net_rating_rank",
    "offensive_rating",
    "offensive_rating_rank",
    "defensive_rating",
    "defensive_rating_rank",
    "pace",
    "pace_rank",
    "points_per_game",
    "opponent_points_per_game",
    "three_point_pct",
)
_GAME_LOG_ASK_KEYS = (
    "game_date",
    "opponent",
    "location",
    "result",
    "minutes",
    "points",
    "rebounds",
    "assists",
)
_RECORD_ASK_KEYS = (
    "abbreviation",
    "team_name",
    "wins",
    "losses",
    "win_pct",
    "games",
    "arena",
)
_H2H_ASK_KEYS = (
    "abbreviation",
    "team_name",
    "opponent",
    "wins",
    "losses",
    "win_pct",
    "games",
)
_FLOW_ASK_KEYS = (
    "abbreviation",
    "team_name",
    "games",
    "min_margin",
    "blown_leads",
    "biggest_lead_blown",
    "comeback_wins",
    "biggest_comeback",
)
_SEASON_STATS_ASK_KEYS = (
    "full_name",
    "season",
    "games_played",
    "ppg",
    "rpg",
    "apg",
)
_SALARY_ASK_KEYS = (
    "full_name",
    "current_contract_season",
    "current_season_salary",
    "current_remaining_guaranteed",
)
_PAYROLL_ASK_KEYS = (
    "abbreviation",
    "team_name",
    "current_contract_season",
    "current_season_payroll",
    "current_remaining_guaranteed",
)
_STREAK_ASK_KEYS = (
    "abbreviation",
    "team_name",
    "conference",
    "streak",
    "wins",
    "losses",
)
_STANDINGS_ASK_KEYS = (
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
)


def _short_team_name(full_name: str) -> str:
    """ "Washington Wizards" -> "Wizards". The last word is the nickname for every
    team ("Portland Trail Blazers" -> "Blazers"), and each one is a TEAM_ALIASES
    key, so a follow-up written with it still resolves."""
    words = full_name.split()
    return words[-1] if words else full_name


def _possessive(name: str) -> str:
    return f"{name}'" if name.endswith("s") else f"{name}'s"


def _win_pct_label(win_pct: object) -> str:
    """.268 rather than 0.268, as standings print it."""
    if not isinstance(win_pct, (int, float)):
        return "n/a"
    text = f"{win_pct:.3f}"
    return text[1:] if text.startswith("0") else text


def _win_streak(value: object) -> int:
    """Length of a "W5" streak; 0 for a losing streak or none yet."""
    match = _WIN_STREAK_VALUE.match(str(value or ""))
    return int(match.group(1)) if match else 0


def _season_label(match: re.Match[str] | None) -> str | None:
    if match is None:
        return None
    start, end = match.group(1), match.group(2)
    return f"{start}-{end[-2:]}"


class NaturalLanguageQueryService:
    def __init__(self, cube: CubeAnalytics, today: Callable[[], date] | None = None) -> None:
        self.cube = cube
        self._today = today or (lambda: datetime.now(_EASTERN).date())

    def classify(self, question: str) -> str:
        text = question.strip()
        if not text:
            return "refuse"
        # Before the prediction guard: "who will win MVP" is answered from the
        # ladder, which reports a season so far, not a forecast.
        if _MVP.search(text):
            return "mvp"
        if _PREDICTION.search(text):
            return "refuse"
        if _B2B.search(text):
            return "b2b"
        if _SEASON_STATS.search(text):
            return "season_stats"
        if _STREAK.search(text):
            return "streak"
        if _INJURY.search(text):
            return "injuries"
        teams = self._extract_team_abbrs(text)
        if teams and _ROSTER.search(text):
            return "roster"
        names = [] if teams else self._extract_player_names(text)
        if names:
            if _GAME_LOG.search(text):
                return "game_log"
            if _PLAYING_TODAY.search(text):
                return "injuries"
        if _TRENDING.search(text):
            return "trends"
        if _SCHEDULE.search(text) or (_TODAY.search(text) and (teams or _SLATE.search(text))):
            return "schedule"
        ranking = self._ranking_family(text, teams, names)
        if ranking:
            return ranking
        if _STANDINGS.search(text) or _BEST_RECORD.search(text):
            return "refuse" if _PLAYER_LEADER.search(text) else "standings"
        if _SALARY.search(text):
            return "salary"
        if _COMPARE.search(text) or _AGAINST.search(text):
            # "Lakers vs Celtics" is a team head-to-head; only send it to the
            # player compare handler when no two teams are named, or it tries to
            # resolve "Portland Trailblazer" as a player and fails.
            if len(self._extract_team_abbrs(text)) >= 2:
                return "team_h2h"
            if _COMPARE.search(text):
                return "compare"
        loose = self._loose_player_family(text, teams, names)
        if loose:
            return loose
        if teams and (self._team_stat(text) or _TEAM_STATS_WORD.search(text)):
            return "team_stats"
        if _BLOWN_LEADS.search(text) or _COMEBACK.search(text):
            return "blown_leads"
        if _WIN_PCT.search(text) or (
            self._extract_team_abbr(text)
            and (_IN_CITY.search(text) or _AT_HOME.search(text) or _ON_ROAD.search(text))
        ):
            return "arena_city"
        return "refuse"

    def _ranking_family(self, text: str, teams: list[str], names: list[str]) -> str | None:
        """League leaders or a team-stat ranking. A named player is never a
        ranking; a named team narrows player leaders to it ("Who leads the
        Warriors in scoring?") and makes a team stat that team's own number."""
        ranks = _LEADER_WORDS.search(text) or _STANDINGS.search(text) or _BEST_RECORD.search(text)
        # "Did the Lakers blow a 20-point lead?" names a lead and points, not a leader.
        if names or not ranks or _BLOWN_LEADS.search(text) or _COMEBACK.search(text):
            return None
        player_stat = self._leader_stat(text)
        team_stat = self._team_stat(text)
        if team_stat and not teams and (_TEAM_WORD.search(text) or not player_stat):
            return "team_rank"
        if player_stat or _PLAYER_LEADER.search(text):
            return "leaders"
        return None

    def _leader_stat(self, text: str) -> str | None:
        return next((key for pattern, key in _SEASON_STAT_PATTERNS if pattern.search(text)), None)

    def _team_stat(self, text: str) -> str | None:
        return next((key for pattern, key in _TEAM_STAT_PATTERNS if pattern.search(text)), None)

    def _team_split(self, text: str) -> tuple[str, str]:
        return next(
            ((split, label) for pattern, split, label in _TEAM_SPLITS if pattern.search(text)),
            ("season", ""),
        )

    def _loose_player_family(self, text: str, teams: list[str], names: list[str]) -> str | None:
        """Player questions phrased without the strict keywords. Teams are
        excluded: a capitalised team name would otherwise read as a player."""
        if teams:
            return None
        if len(names) >= 2 and _COMPARE_LOOSE.search(text):
            return "compare"
        if len(names) == 1 and _PLAYER_AVERAGE.search(text):
            return "season_stats"
        return None

    def answer(self, question: str, season: str | None = None) -> QueryResponse:
        text = question.strip()
        if not text:
            return QueryResponse(
                answer="Please provide a non-empty question.",
                data=[],
                sql=None,
            )
        try:
            return self._answer_family(text, header_season=season)
        except CubeError as exc:
            return QueryResponse(answer=str(exc), data=[], sql=None)

    def _resolve_season(self, text: str, header_season: str | None) -> str | None:
        return self._extract_season(text) or header_season

    def _answer_family(self, text: str, header_season: str | None = None) -> QueryResponse:
        family = self.classify(text)
        if family == "b2b":
            return self._answer_back_to_backs(text, header_season)
        if family == "season_stats":
            return self._answer_season_stats(text)
        if family == "streak":
            return self._answer_streak(text, header_season)
        if family == "mvp":
            return self._answer_mvp(text, header_season)
        if family == "leaders":
            return self._answer_leaders(text, header_season)
        if family == "trends":
            return self._answer_trends(text)
        if family == "team_stats":
            return self._answer_team_stats(text)
        if family == "team_rank":
            return self._answer_team_rank(text)
        if family == "roster":
            return self._answer_roster(text)
        if family == "injuries":
            return self._answer_injuries(text)
        if family == "game_log":
            return self._answer_game_log(text, header_season)
        if family == "schedule":
            return self._answer_schedule(text, header_season)
        if family == "standings":
            return self._answer_standings(text, header_season)
        if family == "salary":
            if _PAYROLL.search(text):
                return self._answer_payroll(text)
            return self._answer_salary(text)
        if family == "team_h2h":
            return self._answer_team_h2h(text, header_season)
        if family == "compare":
            return self._answer_compare(text)
        if family == "blown_leads":
            return self._answer_blown_leads(text, header_season)
        if family == "arena_city":
            return self._answer_team_record(text, header_season)
        return QueryResponse(
            answer=f"{_CAPABILITY}Received: {text}",
            data=[],
            sql=None,
        )

    def _named_player(self, text: str) -> tuple[dict[str, Any] | None, QueryResponse | None]:
        """The first player named, or the answer to give when there isn't one."""
        names = self._extract_player_names(text)
        if not names:
            return None, None
        player = self._resolve_player(names[0])
        if player is None:
            return None, QueryResponse(
                answer=f"No player found matching '{names[0]}'.", data=[], sql=None
            )
        return player, None

    def _named_team(self, text: str) -> tuple[dict[str, Any] | None, QueryResponse | None]:
        """The first team named, or the answer to give when it isn't found."""
        abbr = self._extract_team_abbr(text)
        if abbr is None:
            return None, None
        team = self.cube.find_team(abbr)
        if team is None:
            return None, QueryResponse(
                answer=f"No team found for abbreviation '{abbr}'.", data=[], sql=None
            )
        return {**team, "abbreviation": abbr}, None

    def _answer_injuries(self, text: str) -> QueryResponse:
        team, missing = self._named_team(text)
        if missing:
            return missing
        if team is not None:
            abbr = team["abbreviation"]
            full_name = str(team["team_name"])
            name = _short_team_name(full_name)
            rows = self.cube.get_player_injuries(team_abbreviation=abbr)
            value = None
            if rows:
                value = _plural(len(rows), "player")
                listed = ", ".join(
                    f"{row.get('player_name')} ({_injury_status(row)})" for row in rows
                )
                answer = f"The {name} have {value} on the injury report: {listed}."
            else:
                answer = f"No {name} players are on the injury report."
            return QueryResponse(
                answer=answer,
                value=value,
                data=self._ask_rows([_injury_row(row) for row in rows], _INJURY_ASK_KEYS),
                sql=f"cube:player_injuries team={abbr}",
                entities=self._entities(("team", full_name), ("topic", "Injuries")),
                follow_ups=self._team_follow_ups(name, abbr, [f"When do the {name} play next?"]),
                show_data=len(rows) > 1,
            )
        player, missing = self._named_player(text)
        if missing:
            return missing
        if player is None:
            return self._missing_team(text, "Name a team or a player to check the injury report.")
        full_name = str(player["full_name"])
        rows = self.cube.get_player_injuries(player_id=player["player_id"])
        if rows:
            row = rows[0]
            value = _injury_status(row)
            updated = _short_game_date(row.get("update_date"))
            answer = f"{full_name} is on the injury report: {row.get('description') or value}" + (
                f" (updated {updated})." if updated else "."
            )
        else:
            value = None
            answer = f"{full_name} isn't on the injury report."
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows([_injury_row(row) for row in rows[:1]], _INJURY_ASK_KEYS),
            sql=f"cube:player_injuries player_id={player['player_id']}",
            entities=self._entities(("player", full_name), ("topic", "Injuries")),
            follow_ups=self._player_follow_ups(full_name, ["{} last game", "{} stats"]),
            show_data=False,
        )

    def _answer_schedule(self, text: str, header_season: str | None = None) -> QueryResponse:
        today = self._today()
        season = self._resolve_season(text, header_season)
        team, missing = self._named_team(text)
        if missing:
            return missing
        if team is None:
            if not _TODAY.search(text):
                return self._missing_team(text, "Name a team to see its next game.")
            return self._answer_slate(today, season)
        abbr = team["abbreviation"]
        full_name = str(team["team_name"])
        name = _short_team_name(full_name)
        rows = [
            row
            for row in self.cube.get_games_schedule(
                season=season, team_abbreviation=abbr, from_date=today.isoformat(), limit=5
            )
            if row.get("status") != "Final"
        ]
        games = [_schedule_row(row, abbr) for row in rows]
        entities = self._entities(("team", full_name), ("topic", "Schedule"))
        follow_ups = self._team_follow_ups(
            name, abbr, [f"Who is injured on the {name}?", f"{name} record"]
        )
        if not games:
            return QueryResponse(
                answer=f"The {name} have no games scheduled.",
                data=[],
                sql=f"cube:games_schedule team={abbr} from={today.isoformat()}",
                entities=entities,
                follow_ups=follow_ups,
            )
        game = games[0]
        is_today = game["game_date"] == today.isoformat()
        value = "tonight" if is_today else (_short_game_date(game["game_date"]) or "next")
        when = value if is_today else f"on {value}"
        opponent = _short_team_name(str(game["opponent"] or ""))
        matchup = (
            f"host the {opponent}" if game["location"] == "home" else f"play at the {opponent}"
        )
        tv = f" ({game['national_tv']})" if game.get("national_tv") else ""
        if _TODAY.search(text) and not is_today:
            answer = f"The {name} don't play today. Next, they {matchup} {when}{tv}."
        else:
            answer = f"The {name} {matchup} {when}{tv}."
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(games, _SCHEDULE_ASK_KEYS),
            sql=f"cube:games_schedule team={abbr} from={today.isoformat()}",
            entities=entities,
            follow_ups=follow_ups,
            show_data=len(games) > 1,
            highlight_row=0,
        )

    def _answer_slate(self, today: date, season: str | None) -> QueryResponse:
        rows = self.cube.get_games_schedule(
            season=season, from_date=today.isoformat(), to_date=today.isoformat(), limit=50
        )
        entities = self._entities(("topic", "Today's games"))
        sql = f"cube:games_schedule date={today.isoformat()}"
        if not rows:
            return QueryResponse(
                answer="No games are scheduled today.", data=[], sql=sql, entities=entities
            )
        value = _plural(len(rows), "game")
        listed = ", ".join(
            f"{_short_team_name(str(row.get('away_team_name') or row.get('away_team') or ''))} at "
            f"{_short_team_name(str(row.get('home_team_name') or row.get('home_team') or ''))}"
            + (f" ({row['national_tv']})" if row.get("national_tv") else "")
            for row in rows
        )
        return QueryResponse(
            answer=f"{value} today: {listed}.",
            value=value,
            data=self._ask_rows(rows, _SLATE_ASK_KEYS),
            sql=sql,
            entities=entities,
        )

    def _answer_mvp(self, text: str, header_season: str | None = None) -> QueryResponse:
        season = self._resolve_season(text, header_season)
        player, missing = (
            (None, None) if self._extract_team_abbrs(text) else self._named_player(text)
        )
        if missing:
            return missing
        if player is not None:
            full_name = str(player["full_name"])
            rows = [
                row
                for row in self.cube.get_player_mvp_scores(player["player_id"], season)
                if row.get("season_type") == "Regular Season"
            ]
            entities = self._entities(("player", full_name), ("topic", "MVP ladder"))
            if not rows or rows[0].get("mvp_rank") is None:
                return QueryResponse(
                    answer=f"{full_name} has no MVP score yet.",
                    data=[],
                    sql=None,
                    entities=entities,
                )
            row = rows[0]
            value = f"#{row['mvp_rank']}"
            return QueryResponse(
                answer=(
                    f"{full_name} is {value} on the MVP ladder "
                    f"(MVP score {row.get('mvp_score')}, {_plural(row.get('games_played') or 0, 'game')})."
                ),
                value=value,
                data=self._ask_rows(rows[:1], _MVP_ASK_KEYS),
                sql=f"cube:player_mvp_scores player_id={player['player_id']}",
                entities=entities,
                follow_ups=self._player_follow_ups(full_name, ["{} stats", "{} last game"]),
                show_data=False,
            )
        ladder = self.cube.get_mvp_ladder(season=season, limit=5)
        players = ladder.get("players") or []
        entities = self._entities(("topic", "MVP ladder"))
        if not players:
            return QueryResponse(
                answer="There is no MVP ladder yet.", data=[], sql=None, entities=entities
            )
        leader = players[0]
        value = str(leader.get("full_name"))
        answer = f"{value} leads the MVP ladder (MVP score {leader.get('mvp_score')})"
        if len(players) > 1:
            answer += f", ahead of {players[1].get('full_name')} ({players[1].get('mvp_score')})"
        return QueryResponse(
            answer=answer + ".",
            value=value,
            data=self._ask_rows(players, _MVP_ASK_KEYS),
            sql=f"cube:player_mvp_scores ladder season={ladder.get('season')!r}",
            entities=entities,
            follow_ups=self._player_follow_ups(value, ["{} MVP rank", "{} stats"]),
            highlight_row=0,
        )

    def _answer_leaders(self, text: str, header_season: str | None = None) -> QueryResponse:
        stat = self._leader_stat(text)
        if stat is None:
            return QueryResponse(
                answer="League leaders are by points, rebounds or assists per game.",
                data=[],
                sql=None,
            )
        if self._extract_conference(text):
            # Answering the league's leader to "who leads the West" would be wrong.
            return QueryResponse(
                answer="League leaders are league-wide or for one team, not by conference.",
                data=[],
                sql=None,
            )
        team, missing = self._named_team(text)
        if missing:
            return missing
        abbr = team["abbreviation"] if team else None
        team_name = str(team["team_name"]) if team else None
        scope = f"the {_short_team_name(team_name)}" if team_name else "the league"
        result = self.cube.get_season_leaders(
            stat, season=self._resolve_season(text, header_season), team_abbreviation=abbr, limit=5
        )
        players = result.get("players") or []
        label = _SEASON_STAT_LABELS[stat]
        entities = self._entities(("team", team_name), ("topic", f"{label} leaders"))
        sql = f"cube:player_season_stats leaders stat={stat} min_games={result.get('min_games')}"
        if not players:
            return QueryResponse(
                answer=f"No one has played enough games to lead {scope} yet.",
                data=[],
                sql=sql,
                entities=entities,
            )
        leader = players[0]
        value = f"{leader.get(stat)} {label}"
        answer = f"{leader.get('full_name')} leads {scope} in {_LEADER_NOUNS[stat]} ({value})"
        if len(players) > 1:
            answer += f", ahead of {players[1].get('full_name')} ({players[1].get(stat)})"
        answer += f". Players with at least {_plural(result.get('min_games') or 0, 'game')}."
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(players, ("full_name", "team_abbreviation", "games_played", stat)),
            sql=sql,
            entities=entities,
            follow_ups=self._player_follow_ups(
                str(leader.get("full_name")), ["{} stats", "{} last game"]
            ),
            highlight_row=0,
        )

    def _answer_trends(self, text: str) -> QueryResponse:
        team, missing = self._named_team(text)
        if missing:
            return missing
        abbr = team["abbreviation"] if team else None
        player, missing = (None, None) if team else self._named_player(text)
        if missing:
            return missing
        if player is not None:
            full_name = str(player["full_name"])
            row = self.cube.get_player_trend(player["player_id"])
            entities = self._entities(("player", full_name), ("topic", "Trend"))
            if not row or not row.get("is_qualified"):
                return QueryResponse(
                    answer=f"{full_name} doesn't have enough games for a trend yet.",
                    data=[],
                    sql=None,
                    entities=entities,
                )
            value = _TREND_LABELS.get(str(row.get("trend_direction")), "steady")
            return QueryResponse(
                answer=f"{full_name} is {value}: {_trend_line(row)}.",
                value=value,
                data=self._ask_rows([row], _TREND_ASK_KEYS),
                sql=f"cube:player_trends player_id={player['player_id']}",
                entities=entities,
                follow_ups=self._player_follow_ups(full_name, ["{} last 5 games", "{} stats"]),
                show_data=False,
            )
        direction = "down" if _TRENDING_DOWN.search(text) else "up"
        team_name = str(team["team_name"]) if team else None
        on_team = f" on the {_short_team_name(team_name)}" if team_name else ""
        rows = self.cube.get_trending_players(direction, team_abbreviation=abbr, limit=5)
        entities = self._entities(("team", team_name), ("topic", f"Trending {direction}"))
        sql = f"cube:player_trends direction={direction}" + (f" team={abbr}" if abbr else "")
        if not rows:
            return QueryResponse(
                answer=f"No one{on_team} is trending {direction} yet.",
                data=[],
                sql=sql,
                entities=entities,
            )
        leader = rows[0]
        value = str(leader.get("full_name"))
        answer = f"{value} is trending {direction} the most{on_team}: {_trend_line(leader)}"
        if len(rows) > 1:
            answer += f". Next: {rows[1].get('full_name')} ({_signed(rows[1].get('mvp_game_score_change'))})"
        return QueryResponse(
            answer=answer + ".",
            value=value,
            data=self._ask_rows(rows, _TREND_ASK_KEYS),
            sql=sql,
            entities=entities,
            follow_ups=self._player_follow_ups(value, ["{} last 5 games", "{} stats"]),
            highlight_row=0,
        )

    def _answer_team_stats(self, text: str) -> QueryResponse:
        team, missing = self._named_team(text)
        if missing or team is None:
            # Routing only sends a question here when a team is named.
            return missing or QueryResponse(answer="Name a team.", data=[], sql=None)
        abbr = team["abbreviation"]
        full_name = str(team["team_name"])
        name = _short_team_name(full_name)
        split, split_label = self._team_split(text)
        row = self.cube.get_team_stats(str(abbr), split)
        entities = self._entities(("team", full_name), ("topic", "Team stats"))
        sql = f"cube:team_stat_splits team={abbr} split={split}"
        if row is None:
            return QueryResponse(
                answer=f"No stats for the {name}{split_label} yet.",
                data=[],
                sql=sql,
                entities=entities,
            )
        follow_ups = self._team_follow_ups(
            name, str(abbr), [f"{name} record", f"Who is on the {name} roster?"]
        )
        stat = self._team_stat(text)
        if stat:
            label = _TEAM_STAT_LABELS[stat]
            if row.get(stat) is None:
                return QueryResponse(
                    answer=f"The {name} have no {label}{split_label} yet.",
                    data=[],
                    sql=sql,
                    entities=entities,
                )
            value = _team_stat_value(stat, row[stat])
            answer = (
                f"The {_possessive(name)} {label}{split_label} is {value}"
                f"{_rank_phrase(row.get(f'{stat}_rank'), row.get('team_count'))}."
            )
        else:
            shown = [
                key
                for key in (
                    "net_rating",
                    "offensive_rating",
                    "defensive_rating",
                    "pace",
                    "points_per_game",
                )
                if row.get(key) is not None
            ]
            if not shown:
                return QueryResponse(
                    answer=f"No stats for the {name}{split_label} yet.",
                    data=[],
                    sql=sql,
                    entities=entities,
                )
            value = _team_stat_value(shown[0], row[shown[0]])
            parts = [
                f"{_TEAM_STAT_LABELS[key]} {_team_stat_value(key, row[key])}"
                + _rank_phrase(row.get(f"{key}_rank"), row.get("team_count"), short=True)
                for key in shown
            ]
            answer = f"The {name}{split_label}: " + ", ".join(parts) + "."
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows([row], _TEAM_STATS_ASK_KEYS),
            sql=sql,
            entities=entities,
            follow_ups=follow_ups,
            show_data=False,
        )

    def _answer_team_rank(self, text: str) -> QueryResponse:
        # Routing sends a question here only when a team stat matched.
        stat = self._team_stat(text) or "net_rating"
        split, split_label = self._team_split(text)
        worst = bool(_WORST.search(text))
        rows = self.cube.get_team_stat_ranking(stat, split, worst=worst, limit=5)
        label = _TEAM_STAT_LABELS[stat]
        entities = self._entities(("topic", f"{label[0].upper()}{label[1:]} ranking"))
        sql = f"cube:team_stat_splits rank={stat} split={split}" + (" worst" if worst else "")
        if not rows:
            return QueryResponse(answer="No team stats yet.", data=[], sql=sql, entities=entities)
        top = rows[0]
        name = _short_team_name(str(top.get("team_name") or ""))
        value = _team_stat_value(stat, top.get(stat))
        answer = (
            f"The {name} rank{_rank_phrase(top.get(f'{stat}_rank'), top.get('team_count'), bare=True)}"
            f" in {label}{split_label} ({value})."
        )
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(rows, ("abbreviation", "team_name", stat, f"{stat}_rank")),
            sql=sql,
            entities=entities,
            follow_ups=self._team_follow_ups(
                name, str(top.get("abbreviation") or ""), [f"{name} stats"]
            ),
            highlight_row=0,
        )

    def _answer_roster(self, text: str) -> QueryResponse:
        team, missing = self._named_team(text)
        if missing or team is None:
            # Routing only sends a question here when a team is named.
            return missing or QueryResponse(answer="Name a team.", data=[], sql=None)
        abbr = team["abbreviation"]
        full_name = str(team["team_name"])
        name = _short_team_name(full_name)
        rows = self.cube.get_team_roster(str(abbr))
        entities = self._entities(("team", full_name), ("topic", "Roster"))
        sql = f"cube:players roster team={abbr}"
        if not rows:
            return QueryResponse(
                answer=f"No players are listed on the {name} roster.",
                data=[],
                sql=sql,
                entities=entities,
            )
        value = _plural(len(rows), "player")
        listed = ", ".join(str(row.get("full_name")) for row in rows)
        return QueryResponse(
            answer=f"The {name} have {value} on the roster: {listed}.",
            value=value,
            data=self._ask_rows(rows, ("full_name", "position")),
            sql=sql,
            entities=entities,
            follow_ups=self._team_follow_ups(
                name, str(abbr), [f"Who is injured on the {name}?", f"{name} stats"]
            ),
        )

    def _answer_game_log(self, text: str, header_season: str | None = None) -> QueryResponse:
        player, missing = self._named_player(text)
        if missing:
            return missing
        if player is None:
            return QueryResponse(
                answer="Could not identify a player for the game question.", data=[], sql=None
            )
        full_name = str(player["full_name"])
        season = self._resolve_season(text, header_season)
        # Games played only: a DNP is a log row with no minutes, not a game.
        logs = sorted(
            (
                _game_log_row(row)
                for row in self.cube.get_player_game_log(player["player_id"], season)
            ),
            key=lambda row: str(row["game_date"] or ""),
            reverse=True,
        )
        played = [row for row in logs if (row["minutes"] or 0) > 0]
        count_match = _LAST_N.search(text)
        wanted = 1
        if count_match:
            token = count_match.group(1).lower()
            wanted = max(1, min(_MAX_LAST_N, _NUMBER_WORDS.get(token) or int(token)))
        games = played[:wanted]
        entities = self._entities(("player", full_name), ("topic", "Game log"))
        follow_ups = self._player_follow_ups(full_name, ["{} stats", "Is {} injured?"])
        sql = f"cube:player_game_logs player_id={player['player_id']} season={season!r}"
        if not games:
            return QueryResponse(
                answer=f"No games yet for {full_name}.", data=[], sql=sql, entities=entities
            )
        if wanted == 1:
            game = games[0]
            value = _plural(game["points"] or 0, "point")
            result = "win" if game["result"] == "W" else "loss"
            where = "vs" if game["location"] == "home" else "at"
            day = _short_game_date(game["game_date"])
            answer = (
                f"{full_name} had {value}, {_plural(game['rebounds'] or 0, 'rebound')} and "
                f"{_plural(game['assists'] or 0, 'assist')} in a {result} {where} {game['opponent']}"
                + (f" on {day}" if day else "")
                + f" ({_plural(game['minutes'] or 0, 'minute')})."
            )
        else:
            n = len(games)
            averages = {
                key: round(sum(game[key] or 0 for game in games) / n, 1)
                for key in ("points", "rebounds", "assists")
            }
            wins = sum(1 for game in games if game["result"] == "W")
            value = f"{averages['points']} PPG"
            answer = (
                f"{full_name} averaged {value}, {averages['rebounds']} RPG and "
                f"{averages['assists']} APG over the last {_plural(n, 'game')} ({wins}-{n - wins})."
            )
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(games, _GAME_LOG_ASK_KEYS),
            sql=sql,
            entities=entities,
            follow_ups=follow_ups,
            show_data=len(games) > 1,
        )

    def _resolve_player(self, name: str) -> dict[str, Any] | None:
        normalized_name = " ".join(name.split())
        queries = [normalized_name]
        name_parts = normalized_name.split()
        if len(name_parts) > 1:
            # Basketball-Reference commonly stores players as "K. Leonard"
            # rather than their full first name. Searching the surname lets
            # the initial-aware match below resolve aliases such as Kawhi Leonard.
            queries.append(name_parts[-1])

        rows: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for query in queries:
            for row in self.cube.search_players(query):
                key = str(row.get("player_id") or row.get("full_name"))
                if key not in seen_ids:
                    seen_ids.add(key)
                    rows.append(row)
        if not rows:
            return None

        lowered = normalized_name.lower()
        for row in rows:
            if str(row["full_name"]).lower() == lowered:
                return row

        if len(name_parts) > 1:
            last_name = name_parts[-1].rstrip(".").casefold()
            first_initial = name_parts[0][0].casefold()
            for row in rows:
                full_name_parts = str(row["full_name"]).replace(".", "").split()
                if (
                    len(full_name_parts) > 1
                    and full_name_parts[-1].casefold() == last_name
                    and full_name_parts[0][:1].casefold() == first_initial
                ):
                    return row

            last_name_matches = [
                row
                for row in rows
                if str(row["full_name"]).split()[-1].rstrip(".").casefold() == last_name
            ]
            if len(last_name_matches) == 1:
                return last_name_matches[0]

        for row in rows:
            if lowered in str(row["full_name"]).lower():
                return row
        return rows[0]

    def _extract_player_names(self, question: str) -> list[str]:
        aliases = [
            ("kawhi leonard", "Kawhi Leonard"),
            ("kawhi", "Kawhi Leonard"),
            ("lebron james", "LeBron James"),
            ("lebron", "LeBron James"),
            ("stephen curry", "Stephen Curry"),
            ("steph curry", "Stephen Curry"),
            ("curry", "Stephen Curry"),
            ("giannis antetokounmpo", "Giannis Antetokounmpo"),
            ("giannis", "Giannis Antetokounmpo"),
            ("luka doncic", "Luka Doncic"),
            ("luka", "Luka Doncic"),
            ("nikola jokic", "Nikola Jokic"),
            ("jokic", "Nikola Jokic"),
            ("jayson tatum", "Jayson Tatum"),
            ("tatum", "Jayson Tatum"),
            ("kevin durant", "Kevin Durant"),
            ("durant", "Kevin Durant"),
        ]
        found: list[str] = []
        lowered = question.lower()
        for needle, canonical in aliases:
            if re.search(rf"\b{needle}\b", lowered) and canonical not in found:
                found.append(canonical)
        if found:
            return found
        names: list[str] = []
        for match in _PLAYER_NAME.finditer(question):
            words = match.group(1).split()
            while words and words[0].lower() in _NAME_LEADING_WORDS:
                words.pop(0)
            if words:
                names.append(" ".join(words))
        return names

    def _extract_team_abbrs(self, question: str) -> list[str]:
        """Every team named, in the order it appears.

        Longest alias first so "los angeles lakers" is not also counted as
        "lakers", then re-sorted by position: in "A vs B" the subject is the
        team mentioned first, and picking the longest name instead made
        "Portland ... vs Los Angeles Lakers" a question about the Lakers.
        """
        lowered = question.lower()
        claimed: list[tuple[int, int]] = []
        found: list[tuple[int, str]] = []
        for alias in sorted(TEAM_ALIASES, key=len, reverse=True):
            # Whole words only: "rankings" is not the Kings, "heated" not the Heat.
            for alias_match in re.finditer(rf"\b{re.escape(alias)}\b", lowered):
                start, end = alias_match.span()
                if not any(begin < end and start < finish for begin, finish in claimed):
                    claimed.append((start, end))
                    found.append((start, TEAM_ALIASES[alias]))
                    break
        for abbr in sorted(set(TEAM_ALIASES.values())):
            flags = 0 if abbr in _WORD_ABBR_TEAMS else re.IGNORECASE
            match = re.search(rf"\b{abbr}\b", question, flags)
            if match and not any(
                begin < match.end() and match.start() < finish for begin, finish in claimed
            ):
                claimed.append((match.start(), match.end()))
                found.append((match.start(), abbr.upper()))
        ordered: list[str] = []
        for _, abbr in sorted(found):
            if abbr not in ordered:
                ordered.append(abbr)
        return ordered

    def _extract_team_abbr(self, question: str) -> str | None:
        abbrs = self._extract_team_abbrs(question)
        return abbrs[0] if abbrs else None

    def _extract_conference(self, question: str) -> str | None:
        match = _CONFERENCE.search(question)
        if match is None:
            return None
        token = match.group(1).lower()
        if token.startswith("east"):
            return "East"
        if token.startswith("west"):
            return "West"
        return None

    def _extract_season(self, question: str) -> str | None:
        return _season_label(_SEASON.search(question))

    def _format_usd_compact(self, amount: int) -> str:
        """$62.6M, matching the frontend's formatUsdCompact."""
        if abs(amount) >= 1_000_000:
            millions = amount / 1_000_000
            return f"${millions:.0f}M" if millions.is_integer() else f"${millions:.1f}M"
        return f"${amount:,}"

    def _entities(self, *items: tuple[EntityKind, str | None]) -> list[QueryEntity]:
        return [QueryEntity(kind=kind, label=label) for kind, label in items if label]

    def _player_follow_ups(self, name: str, templates: list[str]) -> list[str]:
        """Fill each "{}" template with the shortest form of the name that reads
        back as the same player: "Curry" and "LeBron" do, "Edwards" alone does not,
        and "K. Leonard" is not read as a name at all (no follow-ups then). A
        "Seth Curry" would be read as Stephen, so it never shortens to "Curry"."""
        words = name.split()
        for candidate in (words[-1], words[0], name) if words else ():
            if self._extract_player_names(candidate)[:1] == [name]:
                return [template.format(candidate) for template in templates]
        return []

    def _team_follow_ups(self, name: str, abbr: str, questions: list[str]) -> list[str]:
        if self._extract_team_abbr(name) != abbr:
            return []
        return questions

    def _missing_team(self, question: str, answer: str) -> QueryResponse:
        """No team was named. If a lowercase "was" or "min" is in the question,
        offer the team it would be in capitals."""
        for abbr, (team_name, nickname) in _WORD_ABBR_TEAMS.items():
            matches = list(re.finditer(rf"\b{abbr}\b", question, re.IGNORECASE))
            if not matches:
                continue
            last = matches[-1]
            word = last.group(0)
            rewritten = question[: last.start()] + nickname + question[last.end() :]
            return QueryResponse(
                answer=(
                    f"\u201c{word}\u201d is also an everyday word, so it wasn't read as a team. "
                    f"Typing {abbr} in capitals, or \u201c{nickname}\u201d, always works."
                ),
                data=[],
                sql=None,
                clarify=QueryClarify(
                    prompt=f"Did you mean the {team_name}?",
                    action=f"Yes, {nickname}",
                    question=rewritten,
                ),
            )
        return QueryResponse(answer=answer, data=[], sql=None)

    def _ask_row(
        self,
        row: dict[str, Any],
        keys: tuple[str, ...] | None = None,
    ) -> dict[str, Any]:
        if keys is None:
            return {key: value for key, value in row.items() if key not in _HIDDEN_ASK_KEYS}
        return {key: row[key] for key in keys if key in row}

    def _ask_rows(
        self,
        rows: list[dict[str, Any]],
        keys: tuple[str, ...] | None = None,
    ) -> list[dict[str, Any]]:
        return [self._ask_row(row, keys) for row in rows]

    def _compare_stats(self, question: str) -> list[str]:
        """The compare stats the question names, in pattern order."""
        selected: list[str] = []
        for pattern, key in _COMPARE_STAT_PATTERNS:
            if pattern.search(question) and key not in selected:
                selected.append(key)
        return selected

    def _answer_back_to_backs(
        self, question: str, header_season: str | None = None
    ) -> QueryResponse:
        names = self._extract_player_names(question)
        if not names:
            return QueryResponse(
                answer="Could not identify a player for the back-to-back question.",
                data=[],
                sql=None,
            )
        player = self._resolve_player(names[0])
        if player is None:
            return QueryResponse(
                answer=f"No player found matching '{names[0]}'.",
                data=[],
                sql=None,
            )
        season = self._resolve_season(question, header_season)
        stats = self.cube.get_back_to_back_stats(player["player_id"], season)
        payload = self._ask_row(
            {
                "full_name": player["full_name"],
                **stats,
            },
            _B2B_ASK_KEYS,
        )
        if payload.get("season") is None:
            payload.pop("season", None)
        sat = stats.get("games_sat_in_b2b") or 0
        season_label = f" in {season}" if season else ""
        name = player["full_name"]
        entities = self._entities(("player", name), ("topic", "Back-to-backs"))
        follow_ups = self._player_follow_ups(name, ["{} salary", "{} PPG by season"])
        if not stats.get("total_back_to_backs"):
            return QueryResponse(
                answer=f"No back-to-back sets for {name}{season_label} yet.",
                data=[payload],
                sql=(
                    f"cube:player_game_logs back-to-back player_id={player['player_id']}"
                    f" season={season!r}"
                ),
                entities=entities,
                follow_ups=follow_ups,
                show_data=False,
            )
        value = f"{stats.get('total_back_to_backs') or 0} back-to-back sets"
        answer = (
            f"{player['full_name']} has {value}{season_label} "
            f"({stats.get('games_played_in_b2b') or 0} played, {sat} sat out). "
            f"Avg PTS on B2B: {stats.get('avg_pts_b2b')}; "
            f"non-B2B: {stats.get('avg_pts_non_b2b')}."
        )
        return QueryResponse(
            answer=answer,
            value=value,
            data=[payload],
            sql=(
                f"cube:player_game_logs back-to-back player_id={player['player_id']}"
                f" season={season!r}"
            ),
            entities=entities,
            follow_ups=follow_ups,
            show_data=False,
        )

    def _answer_season_stats(self, question: str) -> QueryResponse:
        names = self._extract_player_names(question)
        if not names:
            return QueryResponse(
                answer="Could not identify a player for the season-stats question.",
                data=[],
                sql=None,
            )
        player = self._resolve_player(names[0])
        if player is None:
            return QueryResponse(
                answer=f"No player found matching '{names[0]}'.",
                data=[],
                sql=None,
            )
        rows = self.cube.get_player_season_stats(player["player_id"])
        if not rows:
            return QueryResponse(
                answer=f"No season rows for {player['full_name']}.",
                data=[],
                sql=None,
            )
        # The stats the question names; none named ("Curry stats") means all three.
        stats = [key for pattern, key in _SEASON_STAT_PATTERNS if pattern.search(question)]
        stats = stats or list(_SEASON_STAT_LABELS)
        latest = rows[-1]
        name = player["full_name"]
        stats = [key for key in stats if latest.get(key) is not None]
        if not stats:
            return QueryResponse(answer=f"No averages yet for {name}.", data=[], sql=None)
        figures = [f"{latest.get(key)} {_SEASON_STAT_LABELS[key]}" for key in stats]
        value = figures[0] if len(figures) == 1 else ", ".join(figures[:-1]) + f" and {figures[-1]}"
        if _SEASON_STATS.search(question) and len(stats) == 1:
            key = stats[0]
            label = _SEASON_STAT_LABELS[key]
            answer = (
                f"{name} {label} by season: "
                + ", ".join(
                    f"{row.get('season')} {row.get(key)}" for row in rows if row.get("season")
                )
                + f" (latest {latest.get('season')}: {value})."
            )
        else:
            games = latest.get("games_played")
            game_label = f", {_plural(games, 'game')}" if games else ""
            answer = f"{name} averages {value} ({latest.get('season')}{game_label})."
        labeled = [{**row, "full_name": name} for row in rows]
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(labeled, _SEASON_STATS_ASK_KEYS),
            sql=f"cube:player_season_stats player_id={player['player_id']}",
            entities=self._entities(("player", name), ("topic", "Season averages")),
            follow_ups=self._player_follow_ups(
                name, ["{} salary", "How many back-to-backs has {} played?"]
            ),
        )

    def _answer_compare(self, question: str) -> QueryResponse:
        names = self._extract_player_names(question)
        if len(names) < 2:
            return QueryResponse(
                answer="Compare questions need at least two player names.",
                data=[],
                sql=None,
            )
        resolved: list[dict[str, Any]] = []
        for name in names[:4]:
            player = self._resolve_player(name)
            if player is None:
                return QueryResponse(
                    answer=f"No player found matching '{name}'.",
                    data=[],
                    sql=None,
                )
            resolved.append(player)
        ids = [p["player_id"] for p in resolved]
        selected = self._compare_stats(question)
        compare_keys = ("full_name", *selected) if selected else _COMPARE_ASK_KEYS
        # The stat the answer leads with: the first one named, else scoring for
        # "better", else games played.
        if selected:
            primary = selected[0]
        elif _BETTER.search(question):
            primary = "career_ppg"
        else:
            primary = "career_games_played"
        stat_keys = [key for key in compare_keys if key != "full_name"]
        rows = self.cube.compare_players(ids, stats=stat_keys)
        if len(rows) < 2:
            return QueryResponse(
                answer="Could not load stats for both players.",
                data=rows,
                sql=None,
            )
        # Highest first; a player with no figure sorts last.
        rows = sorted(
            rows,
            key=lambda row: (
                row.get(primary) is None,
                -float(row.get(primary) or 0),
                str(row.get("full_name") or ""),
            ),
        )
        answer, value = self._compare_sentence(rows[0], rows[1], primary)
        names = [str(row["full_name"]) for row in rows]
        follow_ups: list[str] = []
        for name in names[:2]:
            follow_ups += self._player_follow_ups(name, ["{} PPG by season"])
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(rows, compare_keys),
            sql=f"cube:players compare ordered by {primary}",
            entities=self._entities(
                *(("player", name) for name in names), ("topic", "Season compare")
            ),
            follow_ups=follow_ups,
        )

    def _compare_sentence(
        self, leader: dict[str, Any], runner: dict[str, Any], primary: str
    ) -> tuple[str, str | None]:
        lead_name, run_name = leader["full_name"], runner["full_name"]
        lead_value, run_value = leader.get(primary), runner.get(primary)
        if not lead_value:
            return f"No games yet this season for {lead_name} or {run_name}.", None
        if primary in _PER_GAME_COMPARE:
            label = _PER_GAME_COMPARE[primary]
            value = f"{lead_value} {label}"
            if run_value is None:
                return f"{lead_name} averages {value}; {run_name} has no games yet.", value
            if lead_value == run_value:
                return f"{lead_name} and {run_name} both average {value}.", value
            return f"{lead_name} averages {value}, ahead of {run_name} ({run_value}).", value
        singular, plural = _COUNT_COMPARE[primary]
        lead_count, run_count = int(lead_value), int(run_value or 0)
        diff = lead_count - run_count
        if diff == 0:
            verb = (
                "played the same number of"
                if primary == "career_games_played"
                else "the same number of"
            )
            return f"{lead_name} and {run_name} have {verb} {plural} ({lead_count}).", None
        value = f"{diff} more {singular if diff == 1 else plural}"
        verb = "has played" if primary == "career_games_played" else "has"
        return f"{lead_name} {verb} {value} ({lead_count}) than {run_name} ({run_count}).", value

    def _answer_team_record(self, question: str, header_season: str | None = None) -> QueryResponse:
        abbr = self._extract_team_abbr(question)
        if abbr is None:
            return self._missing_team(
                question, "Could not identify a team for the win-percentage question."
            )
        team = self.cube.find_team(abbr)
        if team is None:
            return QueryResponse(
                answer=f"No team found for abbreviation '{abbr}'.",
                data=[],
                sql=None,
            )

        location = None
        if _AT_HOME.search(question):
            location = "home"
        elif _ON_ROAD.search(question):
            location = "away"

        city = None
        city_match = _IN_CITY.search(question)
        if city_match:
            city = city_match.group(1).strip(" .,!")
            if (
                city.lower() in {"the", "a", "an"}
                or city.lower() in _NOT_CITIES
                or _AT_HOME.search(city)
                or _ON_ROAD.search(city)
            ):
                city = None

        since = _season_label(_SINCE_SEASON.search(question))

        extracted = self._extract_season(question)
        season = None if since and extracted == since else (extracted or header_season)

        record = self.cube.get_team_record(
            abbr,
            location=location,
            since_season=since,
            season=season,
            arena_city=city,
        )
        # A city is not a venue: Los Angeles is Crypto.com Arena only, because
        # the Clippers play in Inglewood. Naming the buildings is what makes the
        # answer checkable instead of merely plausible.
        arenas = sorted(
            {
                str(game.get("arena")).strip()
                for game in (record.get("game_list") or [])
                if game.get("arena")
            }
        )
        full_name = str(record.get("team_name") or team.get("team_name") or abbr)
        name = _short_team_name(full_name)
        since_label = f" since {since}" if since else ""
        season_label = f" in {season}" if season and not since else ""
        games = record.get("games") or 0
        if games == 0:
            what = (
                f"a game in {city}"
                if city
                else {"home": "a home game", "away": "a road game"}.get(location or "", "a game")
            )
            when = since_label or f" yet{season_label}"
            answer = f"The {name} haven't played {what}{when}."
            value = None
            rows: list[dict[str, Any]] = []
            highlight = None
        else:
            arena_label = f" ({', '.join(arenas)})" if city and arenas else ""
            where = (
                f" in {city}{arena_label}"
                if city
                else {"home": " at home", "away": " on the road"}.get(location or "", "")
            )
            value = f"{record['wins']}-{record['losses']}"
            answer = (
                f"The {name} are {value} "
                f"({_win_pct_label(record.get('win_pct'))}){where}{since_label}{season_label}."
            )
            rows, highlight = self._record_splits(
                abbr, record, city=city, location=location, since=since, season=season
            )
        location_label = {"home": "Home games", "away": "Road games"}.get(location or "")
        other_split = (
            f"{name} record on the road" if location == "home" else f"{name} record at home"
        )
        return QueryResponse(
            answer=answer,
            value=value,
            data=rows,
            sql=(
                f"cube:team_games record team={abbr} location={location!r} "
                f"arena_city={city!r} since_season={since!r} season={season!r}"
            ),
            entities=self._entities(
                ("team", full_name),
                ("city", city),
                ("location", location_label),
                ("topic", "Record"),
            ),
            follow_ups=self._team_follow_ups(
                name,
                abbr,
                [other_split, f"{name} payroll", f"How many leads have the {name} blown?"],
            ),
            show_data=bool(rows),
            highlight_row=highlight,
        )

    def _record_splits(
        self,
        abbr: str,
        record: dict[str, Any],
        *,
        city: str | None,
        location: str | None,
        since: str | None,
        season: str | None,
    ) -> tuple[list[dict[str, Any]], int]:
        """Overall / Home / Away around the asked record, which is the context a
        single W-L cannot give. The asked row is the one to highlight."""

        def split(label: str, row: dict[str, Any]) -> dict[str, Any]:
            return {
                "split": label,
                "wins": row.get("wins"),
                "losses": row.get("losses"),
                "win_pct": row.get("win_pct"),
            }

        rows: list[dict[str, Any]] = []
        if city:
            rows.append(split(f"In {city}", record))
        for label, split_location in (("Overall", None), ("Home", "home"), ("Away", "away")):
            same = split_location == location and not city
            row = (
                record
                if same
                else self.cube.get_team_record(
                    abbr, location=split_location, since_season=since, season=season
                )
            )
            rows.append(split(label, row))
        highlight = 0 if city else {"home": 1, "away": 2}.get(location or "", 0)
        return rows, highlight

    def _answer_team_h2h(self, question: str, header_season: str | None = None) -> QueryResponse:
        abbrs = self._extract_team_abbrs(question)
        subject, opponent = abbrs[0], abbrs[1]
        team = self.cube.find_team(subject)
        other = self.cube.find_team(opponent)
        if team is None or other is None:
            missing = subject if team is None else opponent
            return QueryResponse(
                answer=f"No team found for abbreviation '{missing}'.",
                data=[],
                sql=None,
            )
        season = self._resolve_season(question, header_season)
        record = self.cube.get_team_record(
            subject,
            opponent_abbreviation=opponent,
            season=season,
        )
        season_label = f" in {season}" if season else ""
        team_name = str(record.get("team_name") or team.get("team_name") or subject)
        opponent_name = str(other.get("team_name") or opponent)
        name, opponent_short = _short_team_name(team_name), _short_team_name(opponent_name)
        value = None
        if (record.get("games") or 0) == 0:
            answer = f"The {name} haven't played the {opponent_short} yet{season_label}."
        else:
            value = f"{record['wins']}-{record['losses']}"
            answer = (
                f"The {name} are {value} "
                f"({_win_pct_label(record.get('win_pct'))}) against the "
                f"{opponent_short}{season_label}."
            )
        payload = self._ask_row(
            {
                "abbreviation": record.get("abbreviation") or subject,
                "team_name": record.get("team_name") or team.get("team_name"),
                "opponent": other.get("team_name"),
                "wins": record.get("wins"),
                "losses": record.get("losses"),
                "win_pct": record.get("win_pct"),
                "games": record.get("games"),
            },
            _H2H_ASK_KEYS,
        )
        return QueryResponse(
            answer=answer,
            value=value,
            data=[payload],
            sql=f"cube:team_games record team={subject} opponent={opponent} season={season!r}",
            entities=self._entities(
                ("team", team_name),
                ("opponent", opponent_name),
                ("topic", "Head-to-head"),
            ),
            follow_ups=self._team_follow_ups(name, subject, [f"{name} record"])
            + self._team_follow_ups(opponent_short, opponent, [f"{opponent_short} record"]),
            show_data=False,
        )

    def _answer_blown_leads(self, question: str, header_season: str | None = None) -> QueryResponse:
        abbr = self._extract_team_abbr(question)
        if not abbr:
            return self._missing_team(
                question,
                "Name a team to see its blown leads and comebacks, e.g. 'Lakers blown leads'.",
            )
        team = self.cube.find_team(abbr)
        if team is None:
            return QueryResponse(
                answer=f"No team found for abbreviation '{abbr}'.",
                data=[],
                sql=None,
            )
        season = self._resolve_season(question, header_season)
        min_margin = _extract_flow_margin(question)
        flow = self.cube.get_team_flow(abbr, season=season, min_margin=min_margin)
        season_label = f" in {season}" if season else ""
        full_name = str(flow.get("team_name") or team.get("team_name") or abbr)
        name = _short_team_name(full_name)
        wants_comebacks = bool(_COMEBACK.search(question)) and not _BLOWN_LEADS.search(question)
        topic = "Comebacks" if wants_comebacks else "Blown leads"
        entities = self._entities(("team", full_name), ("topic", topic))
        other_topic = (
            f"How many leads have the {name} blown?"
            if wants_comebacks
            else f"{name} comebacks from 15 or more"
        )
        follow_ups = self._team_follow_ups(
            name, abbr, [other_topic, f"{name} record", f"{name} record at home"]
        )
        sql = f"cube:team_game_flow team={abbr} season={season!r}" + (
            f" min_margin={min_margin}" if min_margin is not None else ""
        )
        if not flow.get("games"):
            return QueryResponse(
                answer=f"The {name} haven't played a game yet{season_label}.",
                data=[],
                sql=sql,
                entities=entities,
                follow_ups=follow_ups,
            )
        margin = int(flow.get("min_margin") or 10)
        blown_line = _blown_line(flow, margin)
        comeback_line = _comeback_line(flow, margin)
        if wants_comebacks:
            answer = f"The {name} {comeback_line}{season_label}. They {blown_line}"
            count = flow["comeback_wins"]
            value = f"{count} game{'' if count == 1 else 's'}"
        else:
            answer = f"The {name} {blown_line}{season_label}. They {comeback_line}"
            count = flow["blown_leads"]
            value = _leads_phrase(count, margin)
        answer += f", across {flow['games']} games."
        payload = self._ask_row(flow, _FLOW_ASK_KEYS)
        return QueryResponse(
            answer=answer,
            value=value,
            data=[payload],
            sql=sql,
            entities=entities,
            follow_ups=follow_ups,
            show_data=False,
        )

    def _answer_standings(self, question: str, header_season: str | None = None) -> QueryResponse:
        conference = self._extract_conference(question)
        season = self._resolve_season(question, header_season)
        lowered = question.lower()
        wants_gb = "games back" in lowered or "games behind" in lowered
        abbr = self._extract_team_abbr(question) if wants_gb else None

        if abbr:
            team = self.cube.find_team(abbr)
            if team is None:
                return QueryResponse(
                    answer=f"No team found for abbreviation '{abbr}'.",
                    data=[],
                    sql=None,
                )
            row = self.cube.get_team_standing(team["team_id"], season=season)
            if row is None:
                return QueryResponse(
                    answer=f"No standings row for {team['team_name']}.",
                    data=[],
                    sql=None,
                )
            gb = row.get("games_back")
            gb_label = "0" if gb in (0, 0.0, None) else str(gb)
            full_name = str(row.get("team_name") or team["team_name"])
            name = _short_team_name(full_name)
            value = f"{gb_label} games back"
            answer = (
                f"The {name} are {value} "
                f"(#{row.get('conference_rank')} {row.get('conference')}, "
                f"{row.get('wins')}-{row.get('losses')})."
            )
            row_conference = row.get("conference")
            return QueryResponse(
                answer=answer,
                value=value,
                data=[self._ask_row(row, _STANDINGS_ASK_KEYS)],
                sql=f"cube:standings team_id={team['team_id']} season={season!r}",
                entities=self._entities(("team", full_name), ("topic", "Games back")),
                follow_ups=self._team_follow_ups(name, abbr, [f"{name} record"])
                + ([f"Who leads the {row_conference}?"] if row_conference else []),
                show_data=False,
            )

        rows = self.cube.list_standings(season=season, conference=conference)
        if not rows:
            return QueryResponse(
                answer="No standings rows found.",
                data=[],
                sql=None,
            )
        best_worst = _BEST_RECORD.search(question)
        worst = bool(best_worst and best_worst.group(1).lower() == "worst")
        if conference and not best_worst:
            leader = min(
                rows,
                key=lambda row: (
                    int(row.get("conference_rank") or 99),
                    str(row.get("team_name") or ""),
                ),
            )
        else:
            # With no conference named, conference_rank says nothing about the
            # league: both #1 seeds have it. Rank by record instead.
            def by_record(row: dict[str, Any]) -> tuple[float, int, str]:
                pct = float(row.get("win_pct") or 0.0)
                return (
                    pct if worst else -pct,
                    int(row.get("conference_rank") or 99),
                    str(row.get("team_name") or ""),
                )

            leader = min(rows, key=by_record)
        leader_name = _short_team_name(str(leader.get("team_name") or ""))
        record = f"({leader.get('wins')}-{leader.get('losses')})"
        where = f"the {conference}" if conference else "the league"
        if best_worst:
            answer = f"The {leader_name} have the {'worst' if worst else 'best'} record in {where} {record}."
        elif conference:
            answer = f"The {leader_name} lead the {conference} {record}."
        else:
            answer = f"The {leader_name} have the best record in the league {record}."
        leader_abbr = str(leader.get("abbreviation") or "")
        follow_ups = self._team_follow_ups(leader_name, leader_abbr, [f"{leader_name} record"])
        if conference:
            other = "East" if conference == "West" else "West"
            follow_ups.append(f"Who leads the {other}?")
        else:
            follow_ups += ["Who leads the West?", "Who leads the East?"]
        return QueryResponse(
            answer=answer,
            value=f"The {leader_name}",
            data=self._ask_rows(rows, _STANDINGS_ASK_KEYS),
            sql="cube:standings ordered by conference_rank",
            entities=self._entities(
                ("topic", f"{conference} standings" if conference else "Standings"),
            ),
            follow_ups=follow_ups,
            highlight_row=rows.index(leader),
        )

    def _answer_streak(self, question: str, header_season: str | None = None) -> QueryResponse:
        season = self._resolve_season(question, header_season)
        abbr = self._extract_team_abbr(question)
        if abbr:
            team = self.cube.find_team(abbr)
            if team is None:
                return QueryResponse(
                    answer=f"No team found for abbreviation '{abbr}'.",
                    data=[],
                    sql=None,
                )
            row = self.cube.get_team_standing(team["team_id"], season=season)
            full_name = str((row or {}).get("team_name") or team["team_name"])
            name = _short_team_name(full_name)
            streak = (row or {}).get("streak")
            run = re.match(r"^\s*([WL])\s*(\d+)\s*$", str(streak or ""), re.IGNORECASE)
            if run:
                verb = "won" if run.group(1).upper() == "W" else "lost"
                answer = f"The {name} have {verb} {run.group(2)} straight."
                value: str | None = f"{verb} {run.group(2)} straight"
            else:
                answer = f"The {name} haven't started a streak yet."
                value = None
            return QueryResponse(
                answer=answer,
                value=value,
                data=[self._ask_row(row, _STREAK_ASK_KEYS)] if row else [],
                sql=f"cube:standings streak team_id={team['team_id']} season={season!r}",
                entities=self._entities(("team", full_name), ("topic", "Win streak")),
                follow_ups=self._team_follow_ups(name, abbr, [f"{name} record"])
                + ["Which team has the longest win streak?"],
                show_data=False,
            )

        rows = self.cube.list_standings(season=season)
        ranked = sorted(
            (row for row in rows if _win_streak(row.get("streak"))),
            key=lambda row: (-_win_streak(row.get("streak")), str(row.get("team_name") or "")),
        )
        if not ranked:
            return QueryResponse(
                answer="No team is on a win streak yet.",
                data=[],
                sql="cube:standings streak",
                entities=self._entities(("topic", "Win streak")),
                follow_ups=["Who leads the West?"],
            )
        longest = _win_streak(ranked[0].get("streak"))
        leaders = [row for row in ranked if _win_streak(row.get("streak")) == longest]
        leader_names = [str(row.get("team_name") or row.get("abbreviation")) for row in leaders]
        short_names = [_short_team_name(name) for name in leader_names]
        named = (
            short_names[0]
            if len(short_names) == 1
            else ", ".join(short_names[:-1]) + f" and {short_names[-1]}"
        )
        verb = "have" if len(leaders) == 1 else "share"
        answer = f"The {named} {verb} the longest win streak: {longest} straight."
        follow_ups: list[str] = []
        for row, name in zip(leaders[:2], short_names, strict=False):
            follow_ups += self._team_follow_ups(
                name, str(row.get("abbreviation") or ""), [f"{name} record"]
            )
        return QueryResponse(
            answer=answer,
            value=f"{longest} straight",
            # The leaders plus the next few, so "longest" can be checked against the rest.
            data=self._ask_rows(ranked[:5], _STREAK_ASK_KEYS),
            sql="cube:standings streak ordered by win streak",
            entities=self._entities(
                *(("team", name) for name in leader_names), ("topic", "Win streak")
            ),
            follow_ups=follow_ups + ["Who leads the West?"],
        )

    def _answer_salary(self, question: str) -> QueryResponse:
        names = self._extract_player_names(question)
        if not names:
            return QueryResponse(
                answer="Could not identify a player for the salary question.",
                data=[],
                sql=None,
            )
        listed = self._resolve_player(names[0])
        if listed is None:
            return QueryResponse(
                answer=f"No player found matching '{names[0]}'.",
                data=[],
                sql=None,
            )
        contract_season = self._extract_season(question)
        player = self.cube.get_player_contract(listed["player_id"], contract_season)
        if player is None:
            return QueryResponse(
                answer=f"No player found matching '{names[0]}'.",
                data=[],
                sql=None,
            )
        name = str(player.get("full_name") or names[0])
        entities = self._entities(
            ("player", name),
            ("topic", "Salary"),
        )
        follow_ups = self._player_follow_ups(
            name, ["{} PPG by season", "How many back-to-backs has {} played?"]
        )
        salary = player.get("current_season_salary")
        if salary is None:
            return QueryResponse(
                answer=f"We don't have a current salary for {name}.",
                data=[self._ask_row(player, _SALARY_ASK_KEYS)],
                sql=f"cube:players salary snapshot player_id={player.get('player_id')}",
                entities=entities,
                follow_ups=follow_ups,
                show_data=False,
            )
        season = player.get("current_contract_season")
        season_label = f" in {season}" if season else ""
        value = self._format_usd_compact(int(salary))
        answer = f"{name} earns {value}{season_label}."
        return QueryResponse(
            answer=answer,
            value=value,
            data=[self._ask_row(player, _SALARY_ASK_KEYS)],
            sql=f"cube:players current_season_salary player_id={player['player_id']}",
            entities=entities,
            follow_ups=follow_ups,
            show_data=False,
        )

    def _answer_payroll(self, question: str) -> QueryResponse:
        abbr = self._extract_team_abbr(question)
        if abbr is None:
            return self._missing_team(
                question, "Could not identify a team for the payroll question."
            )
        contract_season = self._extract_season(question)
        team = self.cube.get_team_payroll(abbr, contract_season)
        if team is None:
            return QueryResponse(
                answer=f"No team found for abbreviation '{abbr}'.",
                data=[],
                sql=None,
            )
        full_name = str(team["team_name"])
        name = _short_team_name(full_name)
        entities = self._entities(
            ("team", full_name),
            ("topic", "Payroll"),
        )
        follow_ups = self._team_follow_ups(
            name, abbr, [f"{name} record", f"How many leads have the {name} blown?"]
        )
        payroll = team.get("current_season_payroll")
        if payroll is None:
            return QueryResponse(
                answer=f"We don't have a current payroll for the {name}.",
                data=[self._ask_row(team, _PAYROLL_ASK_KEYS)],
                sql=f"cube:teams payroll snapshot team_id={team['team_id']}",
                entities=entities,
                follow_ups=follow_ups,
                show_data=False,
            )
        season = team.get("current_contract_season")
        season_label = f" for {season}" if season else ""
        value = self._format_usd_compact(int(payroll))
        answer = f"The {_possessive(name)} payroll is {value}{season_label}."
        return QueryResponse(
            answer=answer,
            value=value,
            data=[self._ask_row(team, _PAYROLL_ASK_KEYS)],
            sql=f"cube:teams current_season_payroll team_id={team['team_id']}",
            entities=entities,
            follow_ups=follow_ups,
            show_data=False,
        )


def _plural(count: float, word: str) -> str:
    number = int(count) if float(count).is_integer() else count
    return f"{number} {word}{'' if number == 1 else 's'}"


def _ordinal(rank: int) -> str:
    suffix = "th" if 10 <= rank % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(rank % 10, "th")
    return f"{rank}{suffix}"


def _rank_phrase(rank: Any, count: Any, *, short: bool = False, bare: bool = False) -> str:
    """ ", 1st of 30" / " (1st)" / " 1st of 30"; empty without a rank."""
    if rank is None:
        return ""
    of = f" of {count}" if count else ""
    if short:
        return f" ({_ordinal(int(rank))})"
    return f"{'' if bare else ','} {_ordinal(int(rank))}{of}"


def _signed(value: Any) -> str:
    return "n/a" if value is None else f"{float(value):+.1f}"


def _team_stat_value(stat: str, value: Any) -> str:
    if value is None:
        return "n/a"
    number = float(value)
    if stat == "three_point_pct":
        return f"{number * 100:.1f}%"
    if stat == "net_rating":
        return f"{number:+.1f}"
    return f"{number:.1f}"


def _trend_line(row: dict[str, Any]) -> str:
    return (
        f"MVP game score {row.get('mvp_game_score_last_10')} over the last 10 games, "
        f"{_signed(row.get('mvp_game_score_change'))} on the games before "
        f"({row.get('mvp_game_score_baseline')})"
    )


def _to_number(value: Any) -> float | None:
    """Cube returns game log and schedule numbers as strings."""
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except TypeError, ValueError:
        return None
    return int(number) if number.is_integer() else number


def _injury_status(row: dict[str, Any]) -> str:
    """ "Out (Ankle) - Left ankle sprain" -> "Out"."""
    description = str(row.get("description") or "").strip()
    return description.split(" (")[0].split(" - ")[0].strip() or "listed"


def _injury_row(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "update_date": str(row.get("update_date") or "")[:10] or None}


def _schedule_row(row: dict[str, Any], abbr: str) -> dict[str, Any]:
    home = str(row.get("home_team") or "").upper() == abbr
    return {
        "game_date": str(row.get("game_date") or "")[:10] or None,
        "opponent": row.get("away_team_name" if home else "home_team_name"),
        "location": "home" if home else "away",
        "national_tv": row.get("national_tv"),
    }


def _game_log_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "game_date": str(row.get("game_date") or "")[:10] or None,
        "opponent": row.get("opponent"),
        "location": row.get("location"),
        "result": row.get("result"),
        "minutes": _to_number(row.get("minutes")),
        "points": _to_number(row.get("points")),
        "rebounds": _to_number(row.get("rebounds")),
        "assists": _to_number(row.get("assists")),
    }


def _extract_flow_margin(question: str) -> int | None:
    """The point margin a flow question names, or None for the default 10."""
    match = _FLOW_MARGIN.search(question)
    if not match:
        return None
    margin = int(match.group(2) or match.group(3)) + (1 if match.group(1) else 0)
    return margin if 1 <= margin <= _MAX_FLOW_MARGIN else None


def _leads_phrase(count: int, margin: int) -> str:
    """'3 double-digit leads' at the default margin, '1 lead of 15 or more' otherwise."""
    noun = "lead" if count == 1 else "leads"
    return f"{count} double-digit {noun}" if margin == 10 else f"{count} {noun} of {margin} or more"


def _flow_game_list(games: list[dict[str, Any]], limit: int = 3) -> str:
    """'22 vs UTA on Oct 25, 16 @ BOS on Nov 1' for the biggest few games."""
    parts = []
    for game in games[:limit]:
        where = "vs" if game.get("location") == "home" else "@"
        when = _short_game_date(game.get("game_date"))
        parts.append(
            f"{game['margin']} {where} {game.get('opponent_abbreviation') or '?'}"
            + (f" on {when}" if when else "")
        )
    return ", ".join(parts)


def _short_game_date(value: Any) -> str | None:
    if not value:
        return None
    try:
        parsed = date.fromisoformat(str(value)[:10])
    except ValueError:
        return None
    return f"{parsed:%b} {parsed.day}"


def _blown_line(flow: dict[str, Any], margin: int) -> str:
    count = flow["blown_leads"]
    line = f"blew {_leads_phrase(count, margin)}"
    games = flow.get("blown_lead_games")
    if count and games:
        line += f" ({_flow_game_list(games)})"
    elif count and flow.get("biggest_lead_blown"):
        line += f", the largest {flow['biggest_lead_blown']} points"
    return line


def _comeback_line(flow: dict[str, Any], margin: int) -> str:
    count = flow["comeback_wins"]
    line = f"won {count} game{'' if count == 1 else 's'} after trailing by {margin} or more"
    games = flow.get("comeback_games")
    if count and games:
        line += f" ({_flow_game_list(games)})"
    elif count and flow.get("biggest_comeback"):
        line += f", the largest from {flow['biggest_comeback']} down"
    return line
