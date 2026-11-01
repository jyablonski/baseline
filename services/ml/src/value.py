"""Read-only report on whether the model's edge against the moneyline pays.

Reads gold.fct_game_value and writes nothing. Thresholds live in the value_*
vars in services/dbt/dbt_project.yml; this shows what the graded games say about
them. ROI on a few dozen bets is mostly noise (about +/-1 / sqrt(n) per unit), so
the report leads with a test that uses every game: does moving off the market
toward the model predict results at all?
"""

from __future__ import annotations

import itertools
import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from db import get_session
from metrics import log_loss
from queries import SELECT_VALUE_GAMES

# One-sided 95%: the interval a "clearly positive" claim has to clear.
Z_90 = 1.645
SLOPE_ITERATIONS = 50
LOGIT_CLAMP = 30.0
EDGE_BANDS: tuple[tuple[float, float | None], ...] = (
    (0.0, 0.05),
    (0.05, 0.10),
    (0.10, 0.15),
    (0.15, 0.25),
    (0.25, None),
)
MIN_EDGES = (0.02, 0.05, 0.08, 0.10, 0.15)
MAX_EDGES: tuple[float | None, ...] = (0.15, 0.20, 0.30, None)
SIDES = ("any", "underdog", "model_underdog")
MIN_TEAM_GAMES = (0, 5, 10)
EASTERN = ZoneInfo("America/New_York")
TOP_RULES = 10
GAME_LIST_LIMIT = 15


@dataclass(frozen=True)
class ValueGame:
    game_date: date
    model_version: str
    is_champion: bool
    is_backfilled: bool
    home_team_abbreviation: str
    away_team_abbreviation: str
    value_team_abbreviation: str
    min_team_games: int
    value_model_wp: float
    value_market_wp: float
    value_decimal_odds: float
    edge_wp: float
    expected_value: float
    is_market_underdog: bool
    model_favors_underdog: bool
    is_value_pick: bool
    value_won: bool | None
    unit_profit: float | None

    @property
    def matchup(self) -> str:
        return f"{self.away_team_abbreviation}@{self.home_team_abbreviation}"


@dataclass(frozen=True)
class Summary:
    n: int
    win_rate: float
    model_rate: float
    market_rate: float
    roi: float
    roi_low: float | None
    roi_high: float | None


@dataclass(frozen=True)
class Rule:
    min_edge: float
    max_edge: float | None
    side: str
    min_team_games: int

    def matches(self, game: ValueGame) -> bool:
        if game.expected_value <= 0 or game.edge_wp < self.min_edge:
            return False
        if self.max_edge is not None and game.edge_wp > self.max_edge:
            return False
        if game.min_team_games < self.min_team_games:
            return False
        if self.side == "underdog":
            return game.is_market_underdog
        if self.side == "model_underdog":
            return game.model_favors_underdog
        return True

    def __str__(self) -> str:
        cap = "none" if self.max_edge is None else f"{self.max_edge:.2f}"
        return f"edge {self.min_edge:.2f}-{cap} side={self.side} team_games>={self.min_team_games}"


@dataclass(frozen=True)
class HoldoutResult:
    rule: Rule
    cutoff: date
    earlier: Summary
    later: Summary | None


def sweep_rules() -> list[Rule]:
    return [
        Rule(min_edge, max_edge, side, min_games)
        for min_edge, max_edge, side, min_games in itertools.product(
            MIN_EDGES, MAX_EDGES, SIDES, MIN_TEAM_GAMES
        )
        if max_edge is None or max_edge > min_edge
    ]


def summarize(games: Sequence[ValueGame]) -> Summary | None:
    """Flat one-unit betting results at the consensus price."""
    if not games:
        return None
    profits = [float(game.unit_profit or 0.0) for game in games]
    n = len(games)
    roi = sum(profits) / n
    low = high = None
    if n > 1:
        variance = sum((profit - roi) ** 2 for profit in profits) / (n - 1)
        half_width = Z_90 * math.sqrt(variance / n)
        # The normal approximation runs past the most a flat bettor can lose.
        low, high = max(-1.0, roi - half_width), roi + half_width
    return Summary(
        n=n,
        win_rate=sum(1 for game in games if game.value_won) / n,
        model_rate=sum(game.value_model_wp for game in games) / n,
        market_rate=sum(game.value_market_wp for game in games) / n,
        roi=roi,
        roi_low=low,
        roi_high=high,
    )


def _logit(prob: float) -> float:
    clipped = min(1.0 - 1e-6, max(1e-6, prob))
    return math.log(clipped / (1.0 - clipped))


def disagreement_slope(games: Sequence[ValueGame]) -> tuple[float, float] | None:
    """Fit logit(win) = logit(market) + b * (logit(model) - logit(market)).

    Returns (b, standard error). b near 0 means the market already holds what the
    model knows; b near 1 means the model should replace the market. The value
    side can stand in for the home side: flipping a game negates the outcome, the
    offset and the disagreement together, which leaves the likelihood unchanged.
    """
    rows = [
        (
            _logit(game.value_market_wp),
            _logit(game.value_model_wp) - _logit(game.value_market_wp),
            1.0 if game.value_won else 0.0,
        )
        for game in games
    ]
    slope = 0.0
    information = 0.0
    for _ in range(SLOPE_ITERATIONS):
        gradient = 0.0
        information = 0.0
        for offset, disagreement, won in rows:
            score = max(-LOGIT_CLAMP, min(LOGIT_CLAMP, offset + slope * disagreement))
            prob = 1.0 / (1.0 + math.exp(-score))
            gradient += disagreement * (won - prob)
            information += disagreement**2 * prob * (1.0 - prob)
        if information <= 0:
            return None
        step = gradient / information
        slope += step
        if abs(step) < 1e-8:
            break
    return slope, math.sqrt(1.0 / information)


def edge_bands(games: Sequence[ValueGame]) -> list[tuple[str, Summary | None]]:
    bands: list[tuple[str, Summary | None]] = []
    for low, high in EDGE_BANDS:
        label = f"{low:.2f}-{'up' if high is None else f'{high:.2f}'}"
        band = [
            game for game in games if game.edge_wp >= low and (high is None or game.edge_wp < high)
        ]
        bands.append((label, summarize(band)))
    return bands


def rank_rules(
    games: Sequence[ValueGame], rules: Sequence[Rule], *, min_bets: int
) -> list[tuple[Rule, Summary]]:
    """Rules with enough bets, best ROI first."""
    ranked: list[tuple[Rule, Summary]] = []
    for rule in rules:
        result = summarize([game for game in games if rule.matches(game)])
        if result is not None and result.n >= min_bets:
            ranked.append((rule, result))
    ranked.sort(key=lambda item: item[1].roi, reverse=True)
    return ranked


def holdout_check(
    games: Sequence[ValueGame], rules: Sequence[Rule], *, min_bets: int
) -> HoldoutResult | None:
    """Pick the best rule on the earlier half of the dates, grade it on the later.

    The best of a hundred-odd rules always looks good on the games that chose it.
    The later half is the honest number.
    """
    dates = sorted({game.game_date for game in games})
    if len(dates) < 2:
        return None
    cutoff = dates[len(dates) // 2]
    earlier = [game for game in games if game.game_date < cutoff]
    later = [game for game in games if game.game_date >= cutoff]
    ranked = rank_rules(earlier, rules, min_bets=max(min_bets // 2, 1))
    if not ranked:
        return None
    rule, earlier_summary = ranked[0]
    return HoldoutResult(
        rule=rule,
        cutoff=cutoff,
        earlier=earlier_summary,
        later=summarize([game for game in later if rule.matches(game)]),
    )


def _summary_line(label: str, result: Summary | None) -> str:
    if result is None:
        return f"  {label:<46} n=0"
    interval = "-"
    if result.roi_low is not None and result.roi_high is not None:
        interval = f"[{result.roi_low:+.1%}, {result.roi_high:+.1%}]"
    return (
        f"  {label:<46} n={result.n:<4} win={result.win_rate:.1%} "
        f"model={result.model_rate:.1%} market={result.market_rate:.1%} "
        f"roi={result.roi:+.1%} 90%={interval}"
    )


def _model_line(version: str, games: Sequence[ValueGame]) -> str:
    wins = [1 if game.value_won else 0 for game in games]
    model_loss = log_loss(wins, [game.value_model_wp for game in games])
    market_loss = log_loss(wins, [game.value_market_wp for game in games])
    fit = disagreement_slope(games)
    slope = "-" if fit is None else f"{fit[0]:+.2f} (se {fit[1]:.2f})"
    picks = summarize([game for game in games if game.is_value_pick])
    pick_text = "picks n=0" if picks is None else f"picks n={picks.n} roi={picks.roi:+.1%}"
    replayed = sum(1 for game in games if game.is_backfilled)
    return (
        f"  {version:<10} n={len(games):<4} replayed={replayed:<4} logloss={model_loss:.4f} "
        f"market={market_loss:.4f} slope={slope} {pick_text}"
    )


def _verdict(fit: tuple[float, float] | None) -> str:
    if fit is None:
        return "Not enough games to fit the slope."
    slope, error = fit
    if slope - Z_90 * error > 0:
        return "The model's disagreement with the market predicts results."
    return (
        "No evidence the model knows anything the market doesn't: treat its edges as "
        "noise, and any ROI below as luck."
    )


def _game_line(game: ValueGame) -> str:
    flag = "*" if game.is_value_pick else " "
    if game.value_won is None:
        result = "-"
    else:
        result = f"{'W' if game.value_won else 'L'} {float(game.unit_profit or 0.0):+.2f}"
    return (
        f"  {flag} {game.game_date} {game.matchup:<8} {game.value_team_abbreviation:<4} "
        f"model={game.value_model_wp:.1%} market={game.value_market_wp:.1%} "
        f"edge={game.edge_wp:+.1%} ev={game.expected_value:+.1%} "
        f"dec={game.value_decimal_odds:.2f} {result}"
    )


def render_report(
    games: Sequence[ValueGame],
    *,
    model: str | None = None,
    min_bets: int = 20,
    since: date | None = None,
    live_only: bool = False,
    today: date | None = None,
) -> list[str]:
    selected = [
        game
        for game in games
        if (since is None or game.game_date >= since) and not (live_only and game.is_backfilled)
    ]
    versions = sorted({game.model_version for game in selected})
    champion = next((game.model_version for game in selected if game.is_champion), None)
    chosen = model or champion or (versions[0] if versions else None)
    if chosen is None:
        return ["No games in gold.fct_game_value."]
    if chosen not in versions:
        return [f"No games for {chosen}. Models: {', '.join(versions) or 'none'}."]

    graded = [game for game in selected if game.value_won is not None]
    lines = ["Model vs market on graded games (slope 0: market knows it all; 1: trust the model)"]
    for version in versions:
        rows = [game for game in graded if game.model_version == version]
        lines.append(_model_line(version, rows) if rows else f"  {version:<10} n=0")

    scoped = [game for game in graded if game.model_version == chosen]
    lines += ["", f"{chosen}: {_verdict(disagreement_slope(scoped))}", "", "Results"]
    lines.append(_summary_line("is_value_pick", summarize([g for g in scoped if g.is_value_pick])))
    lines.append(_summary_line("every game's value side", summarize(scoped)))
    lines.append(
        _summary_line(
            "value side, market underdog", summarize([g for g in scoped if g.is_market_underdog])
        )
    )
    lines.append(
        _summary_line(
            "model above 50% on the underdog",
            summarize([g for g in scoped if g.model_favors_underdog]),
        )
    )

    lines += ["", "By edge (a real edge should earn more as it grows)"]
    lines += [_summary_line(label, result) for label, result in edge_bands(scoped)]

    rules = sweep_rules()
    ranked = rank_rules(scoped, rules, min_bets=min_bets)
    lines += ["", f"Threshold sweep: top {TOP_RULES} of {len(rules)} rules with n>={min_bets}"]
    lines += [_summary_line(str(rule), result) for rule, result in ranked[:TOP_RULES]]
    if not ranked:
        lines.append("  No rule has enough bets.")

    check = holdout_check(scoped, rules, min_bets=min_bets)
    lines += ["", "Out of sample: best rule on earlier games, graded on later ones"]
    if check is None:
        lines.append("  Not enough games.")
    else:
        lines.append(f"  {check.rule}")
        lines.append(_summary_line(f"before {check.cutoff}", check.earlier))
        lines.append(_summary_line(f"from {check.cutoff}", check.later))

    # Ungraded is not the same as upcoming: a past game can be waiting on its box
    # score or never have been played. The NBA's day is the Eastern one.
    first_day = today or datetime.now(EASTERN).date()
    upcoming = [
        g
        for g in selected
        if g.model_version == chosen and g.value_won is None and g.game_date >= first_day
    ]
    upcoming.sort(key=lambda game: (game.game_date, -game.expected_value))
    lines += ["", "Upcoming (* = is_value_pick)"]
    lines += [_game_line(game) for game in upcoming[:GAME_LIST_LIMIT]] or ["  None."]

    largest = sorted(scoped, key=lambda game: game.edge_wp, reverse=True)
    lines += ["", "Largest graded edges"]
    lines += [_game_line(game) for game in largest[:GAME_LIST_LIMIT]] or ["  None."]
    return lines


def load_value_games(session: Session) -> list[ValueGame]:
    rows = session.execute(SELECT_VALUE_GAMES).mappings().all()
    return [ValueGame(**row) for row in rows]


def value_report(
    *,
    model: str | None = None,
    min_bets: int = 20,
    since: date | None = None,
    live_only: bool = False,
) -> list[str]:
    with get_session() as session:
        games = load_value_games(session)
    return render_report(games, model=model, min_bets=min_bets, since=since, live_only=live_only)
