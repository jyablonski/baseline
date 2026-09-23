from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from click.testing import CliRunner

from main import cli
from scrapers.odds import (
    OddsHTTPError,
    american_implied_wp,
    de_vig_pair,
    match_odds_game_id,
    odds_get,
    parse_commence_time,
    parse_odds_events,
    scrape_odds,
)

TEAM_GSW = UUID("7bf8726a-a852-452d-b81f-14839127c5fb")
TEAM_LAC = UUID("a79dabb2-26c5-443c-bbb4-cabdd8db5958")
GAME_ONE = UUID("00000000-0000-4000-8000-000000000101")

SAMPLE_EVENTS = [
    {
        "id": "evt-1",
        "commence_time": "2024-10-22T23:30:00Z",
        "home_team": "Golden State Warriors",
        "away_team": "Los Angeles Clippers",
        "bookmakers": [
            {
                "key": "draftkings",
                "markets": [
                    {
                        "key": "h2h",
                        "outcomes": [
                            {"name": "Golden State Warriors", "price": -150},
                            {"name": "Los Angeles Clippers", "price": 130},
                        ],
                    },
                    {
                        "key": "spreads",
                        "outcomes": [
                            {"name": "Golden State Warriors", "price": -110, "point": -3.5},
                            {"name": "Los Angeles Clippers", "price": -110, "point": 3.5},
                        ],
                    },
                ],
            }
        ],
    }
]


@contextmanager
def _session(mock_session):
    yield mock_session


@pytest.mark.unit
def test_american_implied_wp_and_devig() -> None:
    assert american_implied_wp(-150) == pytest.approx(0.6)
    assert american_implied_wp(150) == pytest.approx(100 / 250)
    assert american_implied_wp(0) is None
    assert american_implied_wp(None) is None
    home, away = de_vig_pair(0.6, 0.45)
    assert home is not None and away is not None
    assert home + away == pytest.approx(1.0)
    assert de_vig_pair(None, 0.5) == (None, None)
    assert de_vig_pair(0.0, 0.0) == (None, None)


@pytest.mark.unit
def test_parse_commence_time() -> None:
    parsed = parse_commence_time("2024-10-22T23:30:00Z")
    assert parsed == datetime(2024, 10, 22, 23, 30, 0)
    assert parse_commence_time("") is None
    assert parse_commence_time("nope") is None
    now = datetime(2024, 1, 1, 12, 0, 0)
    assert parse_commence_time(now) is now


@pytest.mark.unit
def test_parse_odds_events_flattens_h2h_and_spreads() -> None:
    rows = parse_odds_events(SAMPLE_EVENTS)
    assert len(rows) == 2
    h2h = next(row for row in rows if row["market"] == "h2h")
    assert h2h["odds_event_id"] == "evt-1"
    assert h2h["bookmaker"] == "draftkings"
    assert h2h["home_price"] == -150
    assert h2h["home_implied_wp"] == pytest.approx(0.6)
    assert h2h["home_market_wp"] is not None
    spread = next(row for row in rows if row["market"] == "spreads")
    assert spread["spread_home"] == -3.5


@pytest.mark.unit
def test_parse_odds_events_skips_bad_payload() -> None:
    assert parse_odds_events({"not": "a list"}) == []
    assert parse_odds_events([{"id": ""}]) == []


@pytest.mark.unit
def test_match_odds_game_id() -> None:
    row = {
        "home_team_name": "Golden State Warriors",
        "away_team_name": "Los Angeles Clippers",
        "commence_time": datetime(2024, 10, 22, 23, 30, 0),
    }
    teams = {
        "golden state warriors": TEAM_GSW,
        "los angeles clippers": TEAM_LAC,
        "la clippers": TEAM_LAC,
    }
    game = SimpleNamespace(
        game_id=GAME_ONE,
        home_team_id=TEAM_GSW,
        away_team_id=TEAM_LAC,
        game_date=datetime(2024, 10, 22).date(),
    )
    assert match_odds_game_id(row, teams_by_name=teams, games=[game]) == GAME_ONE
    assert match_odds_game_id(row, teams_by_name=teams, games=[]) is None


@pytest.mark.unit
def test_scrape_odds_skips_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("scrapers.odds.settings", SimpleNamespace(odds_api_key=None))
    called = []
    monkeypatch.setattr("scrapers.odds.odds_get", lambda key: called.append(key))
    assert scrape_odds(api_key=None) == 0
    assert called == []


@pytest.mark.unit
def test_scrape_odds_upserts_with_match(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.query.return_value.all.side_effect = [
        [
            SimpleNamespace(
                team_id=TEAM_GSW,
                full_name="Golden State Warriors",
                city="Golden State",
                nickname="Warriors",
                abbreviation="GSW",
            ),
            SimpleNamespace(
                team_id=TEAM_LAC,
                full_name="LA Clippers",
                city="Los Angeles",
                nickname="Clippers",
                abbreviation="LAC",
            ),
        ],
        [
            SimpleNamespace(
                game_id=GAME_ONE,
                home_team_id=TEAM_GSW,
                away_team_id=TEAM_LAC,
                game_date=datetime(2024, 10, 22).date(),
            )
        ],
    ]
    monkeypatch.setattr("scrapers.odds.get_session", lambda: _session(session))
    captured: list[list[dict]] = []

    def fake_upsert(_session, _model, rows, _conflict):
        captured.append(rows)
        return len(rows)

    monkeypatch.setattr("scrapers.odds.upsert_rows", fake_upsert)
    pregame = datetime(2024, 10, 22, 12, 0)
    count = scrape_odds(api_key="test-key", fetch_events=lambda key: SAMPLE_EVENTS, now=pregame)
    assert count == 2
    assert captured[0][0]["game_id"] == GAME_ONE
    # Pruning is bounded to unstarted events so past lines survive as history.
    params = session.execute.call_args.args[1]
    assert params["now_utc"] == pregame


@pytest.mark.unit
def test_scrape_odds_never_writes_started_events(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.query.return_value.all.side_effect = [[], []]
    monkeypatch.setattr("scrapers.odds.get_session", lambda: _session(session))
    captured: list[list[dict]] = []

    def fake_upsert(_session, _model, rows, _conflict):
        captured.append(rows)
        return len(rows)

    monkeypatch.setattr("scrapers.odds.upsert_rows", fake_upsert)
    # 2024-10-22T23:30Z has tipped: live prices must not overwrite the pregame line.
    in_play = datetime(2024, 10, 23, 0, 15)
    count = scrape_odds(api_key="test-key", fetch_events=lambda key: SAMPLE_EVENTS, now=in_play)
    assert count == 0
    assert captured == [[]]


@pytest.mark.unit
def test_odds_get_success_and_http_error() -> None:
    ok = SimpleNamespace(status_code=200, json=lambda: SAMPLE_EVENTS)
    assert odds_get("key", get=lambda *args, **kwargs: ok) == SAMPLE_EVENTS
    response = SimpleNamespace(status_code=401, json=lambda: {})
    with pytest.raises(OddsHTTPError):
        odds_get("bad", get=lambda *args, **kwargs: response)


@pytest.mark.unit
def test_cli_scrape_odds(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("main.scrape_odds", lambda: 0)
    skipped = CliRunner().invoke(cli, ["scrape-odds"])
    assert skipped.exit_code == 0
    assert "skipped" in skipped.output.lower()
    monkeypatch.setattr("main.scrape_odds", lambda: 6)
    fetched = CliRunner().invoke(cli, ["scrape-odds"])
    assert fetched.exit_code == 0
    assert "6" in fetched.output
