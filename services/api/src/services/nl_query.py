"""Rule-based natural-language query routing over Cube named operations.

Covers B2B, career compare, arena-city W/L, blown leads, remaining
salary/payroll, and standings. Each handler runs a Cube query via CubeAnalytics. Adding a family
is a Cube member plus one intent — not a new gold SQL string.
"""

from __future__ import annotations

import re
from typing import Any

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
    r"\b(blown\s+leads?|blew\s+(?:a\s+|the\s+)?lead|collapses?|"
    r"comeback\s+wins?|came\s+back|choked)\b"
    r"|\bleads?\b[^?.]*\bblown\b"
    r"|\bblown\b[^?.]*\bleads?\b",
    re.IGNORECASE,
)
_SEASON_STATS = re.compile(
    r"("
    r"(?:ppg|rpg|apg|points?\s+per\s+game|rebounds?\s+per\s+game|assists?\s+per\s+game)"
    r".{0,40}\b(?:by|per|each)\s+season"
    r"|"
    r"(?:by|per|each)\s+season.{0,40}"
    r"(?:ppg|rpg|apg|points?\s+per\s+game)"
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
    "blown leads, salary/payroll snapshots, "
    "standings, win streaks, and per-season averages "
    "(e.g. Kawhi B2Bs, LeBron vs Curry, Warriors in Chicago, Blazers vs Lakers, "
    "Lakers blown leads, "
    "Curry salary, Warriors payroll, who leads the West, longest win streak, "
    "Curry PPG by season). "
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
_COMPARE_STAT_PATTERNS = (
    (re.compile(r"\b(ppg|points?\s+per\s+game)\b", re.IGNORECASE), "career_ppg"),
    (re.compile(r"\b(rpg|rebounds?\s+per\s+game)\b", re.IGNORECASE), "career_rpg"),
    (re.compile(r"\b(apg|assists?\s+per\s+game)\b", re.IGNORECASE), "career_apg"),
    (re.compile(r"\b(seasons?)\b", re.IGNORECASE), "seasons_played"),
    (re.compile(r"\b(total\s+points|points)\b", re.IGNORECASE), "total_points"),
    (re.compile(r"\bteams?\b", re.IGNORECASE), "teams_played_for"),
    (re.compile(r"\b(games?|gp)\b", re.IGNORECASE), "career_games_played"),
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
    def __init__(self, cube: CubeAnalytics) -> None:
        self.cube = cube

    def classify(self, question: str) -> str:
        text = question.strip()
        if not text:
            return "refuse"
        if _B2B.search(text):
            return "b2b"
        if _SEASON_STATS.search(text):
            return "season_stats"
        if _STREAK.search(text):
            return "streak"
        if _STANDINGS.search(text):
            return "standings"
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
        if _BLOWN_LEADS.search(text):
            return "blown_leads"
        if _WIN_PCT.search(text) or (
            self._extract_team_abbr(text)
            and (_IN_CITY.search(text) or _AT_HOME.search(text) or _ON_ROAD.search(text))
        ):
            return "arena_city"
        return "refuse"

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

    def _compare_ask_keys(self, question: str) -> tuple[str, ...]:
        selected: list[str] = []
        seen: set[str] = set()
        for pattern, key in _COMPARE_STAT_PATTERNS:
            if pattern.search(question) and key not in seen:
                selected.append(key)
                seen.add(key)
        if not selected:
            return _COMPARE_ASK_KEYS
        return ("full_name", *selected)

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
        latest = rows[-1]
        answer = (
            f"{player['full_name']} PPG by season: "
            + ", ".join(
                f"{row.get('season')} {row.get('ppg')}" for row in rows if row.get("season")
            )
            + f" (latest {latest.get('season')}: {latest.get('ppg')} PPG)."
        )
        value = f"{latest.get('ppg')} PPG"
        labeled = [{**row, "full_name": player["full_name"]} for row in rows]
        name = player["full_name"]
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
        compare_keys = self._compare_ask_keys(question)
        stat_keys = [key for key in compare_keys if key != "full_name"]
        rows = self.cube.compare_players(ids, stats=stat_keys)
        if len(rows) < 2:
            return QueryResponse(
                answer="Could not load stats for both players.",
                data=rows,
                sql=None,
            )
        leader = rows[0]
        runner = rows[1]
        leader_games = int(leader.get("career_games_played") or 0)
        runner_games = int(runner.get("career_games_played") or 0)
        diff = leader_games - runner_games
        value = None
        if leader_games == 0:
            answer = f"No career games for {leader['full_name']} or {runner['full_name']} yet."
        elif diff == 0:
            answer = (
                f"{leader['full_name']} and {runner['full_name']} have played "
                f"the same number of games ({leader_games})."
            )
        else:
            value = f"{diff} more games"
            answer = (
                f"{leader['full_name']} has played {value} "
                f"({leader_games}) than {runner['full_name']} ({runner_games})."
            )
        names = [str(row["full_name"]) for row in rows]
        follow_ups: list[str] = []
        for name in names[:2]:
            follow_ups += self._player_follow_ups(name, ["{} PPG by season"])
        return QueryResponse(
            answer=answer,
            value=value,
            data=self._ask_rows(rows, compare_keys),
            sql="cube:players compare ordered by career_games_played",
            entities=self._entities(
                *(("player", name) for name in names), ("topic", "Career compare")
            ),
            follow_ups=follow_ups,
        )

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
                question, "Name a team to see its blown leads, e.g. 'Lakers blown leads'."
            )
        team = self.cube.find_team(abbr)
        if team is None:
            return QueryResponse(
                answer=f"No team found for abbreviation '{abbr}'.",
                data=[],
                sql=None,
            )
        season = self._resolve_season(question, header_season)
        flow = self.cube.get_team_flow(abbr, season=season)
        season_label = f" in {season}" if season else ""
        full_name = str(flow.get("team_name") or team.get("team_name") or abbr)
        name = _short_team_name(full_name)
        entities = self._entities(("team", full_name), ("topic", "Blown leads"))
        follow_ups = self._team_follow_ups(
            name, abbr, [f"{name} record", f"{name} record at home", f"{name} payroll"]
        )
        if not flow.get("games"):
            return QueryResponse(
                answer=f"The {name} haven't played a game yet{season_label}.",
                data=[],
                sql=f"cube:team_game_flow team={abbr} season={season!r}",
                entities=entities,
                follow_ups=follow_ups,
            )
        blown = flow["blown_leads"]
        biggest = flow.get("biggest_lead_blown")
        # A "blown lead" is a loss after leading by 10+, so the biggest one is
        # only worth quoting when there was at least one.
        biggest_label = f", the largest {biggest} points" if blown and biggest else ""
        value = f"{blown} double-digit lead{'' if blown == 1 else 's'}"
        answer = (
            f"The {name} blew {value}{season_label}{biggest_label}. "
            f"They won {flow['comeback_wins']} game"
            f"{'' if flow['comeback_wins'] == 1 else 's'} after trailing by 10 or more"
        )
        if flow.get("comeback_wins") and flow.get("biggest_comeback"):
            answer += f", the largest from {flow['biggest_comeback']} down"
        answer += f", across {flow['games']} games."
        payload = self._ask_row(flow, _FLOW_ASK_KEYS)
        return QueryResponse(
            answer=answer,
            value=value,
            data=[payload],
            sql=f"cube:team_game_flow team={abbr} season={season!r}",
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
        leader = min(
            rows,
            key=lambda row: (
                int(row.get("conference_rank") or 99),
                str(row.get("team_name") or ""),
            ),
        )
        conf_label = conference or leader.get("conference") or "league"
        leader_name = _short_team_name(str(leader.get("team_name") or ""))
        answer = (
            f"The {leader_name} lead the {conf_label} "
            f"({leader.get('wins')}-{leader.get('losses')})."
        )
        leader_abbr = str(leader.get("abbreviation") or "")
        follow_ups = self._team_follow_ups(leader_name, leader_abbr, [f"{leader_name} record"])
        if conference:
            other = "East" if conference == "West" else "West"
            follow_ups.append(f"Who leads the {other}?")
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
