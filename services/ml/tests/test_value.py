from contextlib import contextmanager
from datetime import date, timedelta
from unittest.mock import MagicMock

import pytest
import value
from click.testing import CliRunner
from value import (
    Rule,
    ValueGame,
    disagreement_slope,
    edge_bands,
    holdout_check,
    load_value_games,
    rank_rules,
    render_report,
    summarize,
    sweep_rules,
)

from main import cli
from queries import SELECT_VALUE_GAMES

DAY_ONE = date(2026, 11, 1)


def _game(
    *,
    model_wp: float = 0.45,
    market_wp: float = 0.35,
    decimal: float = 2.75,
    won: bool | None = True,
    day: int = 0,
    version: str = "elo-v1",
    champion: bool = True,
    backfilled: bool = False,
    pick: bool = False,
    team_games: int = 12,
) -> ValueGame:
    profit = None if won is None else (decimal - 1 if won else -1.0)
    return ValueGame(
        game_date=DAY_ONE + timedelta(days=day),
        model_version=version,
        is_champion=champion,
        is_backfilled=backfilled,
        home_team_abbreviation="CHA",
        away_team_abbreviation="BKN",
        value_team_abbreviation="CHA",
        min_team_games=team_games,
        value_model_wp=model_wp,
        value_market_wp=market_wp,
        value_decimal_odds=decimal,
        edge_wp=model_wp - market_wp,
        expected_value=model_wp * decimal - 1,
        is_market_underdog=market_wp < 0.5,
        model_favors_underdog=market_wp < 0.5 and model_wp > 0.5,
        is_value_pick=pick,
        value_won=won,
        unit_profit=profit,
    )


@pytest.mark.unit
def test_summarize_grades_flat_bets_at_the_consensus_price() -> None:
    result = summarize([_game(won=True), _game(won=False)])
    assert result is not None
    assert result.n == 2
    assert result.win_rate == pytest.approx(0.5)
    assert result.roi == pytest.approx((1.75 - 1) / 2)
    assert result.roi_low is not None and result.roi_low < result.roi
    assert result.roi_high is not None and result.roi_high > result.roi


@pytest.mark.unit
def test_summarize_interval_stops_at_losing_the_whole_stake() -> None:
    result = summarize([_game(won=False), _game(won=False), _game(won=True, decimal=9.0)])
    assert result is not None
    assert result.roi_low == pytest.approx(-1.0)


@pytest.mark.unit
def test_summarize_has_no_interval_for_one_bet_and_nothing_for_none() -> None:
    single = summarize([_game()])
    assert single is not None
    assert single.roi_low is None
    assert summarize([]) is None


@pytest.mark.unit
def test_rule_applies_edge_cap_side_and_cold_start() -> None:
    underdog = _game(model_wp=0.45, market_wp=0.35)
    assert Rule(0.05, 0.20, "underdog", 10).matches(underdog)
    assert not Rule(0.15, None, "any", 0).matches(underdog)
    assert not Rule(0.02, 0.05, "any", 0).matches(underdog)
    assert not Rule(0.05, None, "any", 20).matches(underdog)
    assert not Rule(0.05, None, "model_underdog", 0).matches(underdog)
    favorite = _game(model_wp=0.72, market_wp=0.60, decimal=1.60)
    assert Rule(0.05, None, "any", 0).matches(favorite)
    assert not Rule(0.05, None, "underdog", 0).matches(favorite)


@pytest.mark.unit
def test_rule_rejects_a_bet_the_vig_makes_unprofitable() -> None:
    assert not Rule(0.02, None, "any", 0).matches(_game(model_wp=0.37, market_wp=0.35, decimal=2.6))


@pytest.mark.unit
def test_rule_reads_as_its_thresholds() -> None:
    assert str(Rule(0.05, 0.2, "underdog", 10)) == "edge 0.05-0.20 side=underdog team_games>=10"
    assert str(Rule(0.05, None, "any", 0)) == "edge 0.05-none side=any team_games>=0"


@pytest.mark.unit
def test_sweep_never_builds_an_empty_band() -> None:
    rules = sweep_rules()
    assert rules
    assert all(rule.max_edge is None or rule.max_edge > rule.min_edge for rule in rules)


@pytest.mark.unit
def test_slope_recovers_a_market_that_is_already_right() -> None:
    # Outcomes hit exactly the market rate whichever way the model leans.
    games = []
    for model_wp in (0.3, 0.7):
        games += [_game(model_wp=model_wp, market_wp=0.5, won=True) for _ in range(50)]
        games += [_game(model_wp=model_wp, market_wp=0.5, won=False) for _ in range(50)]
    fit = disagreement_slope(games)
    assert fit is not None
    assert fit[0] == pytest.approx(0.0, abs=1e-9)
    assert fit[1] > 0


@pytest.mark.unit
def test_slope_recovers_a_model_that_is_exactly_right() -> None:
    games = []
    for model_wp, wins in ((0.3, 30), (0.7, 70)):
        games += [_game(model_wp=model_wp, market_wp=0.5, won=True) for _ in range(wins)]
        games += [_game(model_wp=model_wp, market_wp=0.5, won=False) for _ in range(100 - wins)]
    fit = disagreement_slope(games)
    assert fit is not None
    assert fit[0] == pytest.approx(1.0, abs=1e-6)


@pytest.mark.unit
def test_slope_is_unfit_when_model_and_market_agree() -> None:
    assert disagreement_slope([_game(model_wp=0.4, market_wp=0.4)]) is None


@pytest.mark.unit
def test_edge_bands_split_on_the_lower_bound() -> None:
    bands = dict(
        edge_bands([_game(model_wp=0.40, market_wp=0.30), _game(model_wp=0.60, market_wp=0.30)])
    )
    assert bands["0.00-0.05"] is None
    assert bands["0.10-0.15"].n == 1
    assert bands["0.25-up"].n == 1


@pytest.mark.unit
def test_rank_rules_sorts_by_roi_and_enforces_min_bets() -> None:
    games = [_game(model_wp=0.45), _game(model_wp=0.45), _game(model_wp=0.60, won=False)]
    broad = Rule(0.05, None, "any", 0)
    narrow = Rule(0.05, 0.20, "any", 0)
    ranked = rank_rules(games, [broad, narrow], min_bets=2)
    assert [rule for rule, _ in ranked] == [narrow, broad]
    assert rank_rules(games, [broad], min_bets=4) == []


@pytest.mark.unit
def test_holdout_picks_on_earlier_games_and_grades_on_later_ones() -> None:
    games = [_game(day=0), _game(day=1), _game(day=2, won=False), _game(day=3, won=False)]
    rule = Rule(0.05, None, "any", 0)
    result = holdout_check(games, [rule], min_bets=2)
    assert result is not None
    assert result.cutoff == DAY_ONE + timedelta(days=2)
    assert result.earlier.roi > 0
    assert result.later is not None and result.later.roi == pytest.approx(-1.0)


@pytest.mark.unit
def test_holdout_needs_two_dates_and_a_qualifying_rule() -> None:
    rule = Rule(0.05, None, "any", 0)
    assert holdout_check([_game()], [rule], min_bets=1) is None
    assert holdout_check([_game(day=0), _game(day=1)], [rule], min_bets=10) is None


@pytest.mark.unit
def test_report_defaults_to_the_champion_and_lists_every_model() -> None:
    games = [_game(day=day, won=day % 2 == 0, pick=True) for day in range(4)] + [
        _game(version="elo-v2", champion=False, backfilled=True, model_wp=0.40)
    ]
    games.append(_game(day=9, won=None, pick=True))
    text = "\n".join(render_report(games, min_bets=1, today=DAY_ONE))
    assert "elo-v1: " in text
    assert "elo-v2" in text and "replayed=1" in text
    assert "is_value_pick" in text
    assert "Upcoming (* = is_value_pick)\n  * 2026-11-10 BKN@CHA" in text
    assert "W +1.75" in text


@pytest.mark.unit
def test_report_lists_games_from_today_as_upcoming() -> None:
    games = [_game(day=0, won=None), _game(day=1, won=None), _game(day=2, won=None)]
    text = "\n".join(render_report(games, today=DAY_ONE + timedelta(days=1)))
    section = text.split("Upcoming (* = is_value_pick)\n")[1].split("\n\n")[0]
    assert [line.split()[0] for line in section.splitlines()] == ["2026-11-02", "2026-11-03"]


@pytest.mark.unit
def test_report_says_when_nothing_is_flagged_or_graded() -> None:
    text = "\n".join(render_report([_game(won=None)], min_bets=1))
    assert "elo-v1  " in text and "n=0" in text
    assert "Not enough games to fit the slope." in text
    assert "No rule has enough bets." in text
    assert "Not enough games.\n" in text


@pytest.mark.unit
def test_report_calls_a_model_with_real_information() -> None:
    games = []
    for model_wp, wins in ((0.3, 15), (0.7, 85)):
        games += [_game(model_wp=model_wp, market_wp=0.5, won=True) for _ in range(wins)]
        games += [_game(model_wp=model_wp, market_wp=0.5, won=False) for _ in range(100 - wins)]
    assert "predicts results" in "\n".join(render_report(games))


@pytest.mark.unit
def test_report_filters_by_date_and_replays_and_rejects_unknown_models() -> None:
    games = [_game(day=0, backfilled=True), _game(day=5)]
    assert render_report(games, model="elo-v9")[0] == "No games for elo-v9. Models: elo-v1."
    assert render_report([]) == ["No games in gold.fct_game_value."]
    assert "n=1 " in render_report(games, live_only=True)[1]
    assert "n=1 " in render_report(games, since=DAY_ONE + timedelta(days=1))[1]


@pytest.mark.unit
def test_load_value_games_builds_rows_from_the_query() -> None:
    row = _game().__dict__
    session = MagicMock()
    session.execute.return_value.mappings.return_value.all.return_value = [row]
    games = load_value_games(session)
    assert session.execute.call_args.args[0] is SELECT_VALUE_GAMES
    assert games[0].matchup == "BKN@CHA"


@pytest.mark.unit
def test_cli_passes_filters_and_prints_the_report(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()

    @contextmanager
    def fake_session():
        yield session

    session.execute.return_value.mappings.return_value.all.return_value = [_game().__dict__]
    monkeypatch.setattr(value, "get_session", fake_session)
    result = CliRunner().invoke(
        cli, ["value-report", "--since", "2026-11-01", "--min-bets", "1", "--live-only"]
    )
    assert result.exit_code == 0, result.output
    assert "Model vs market on graded games" in result.output
