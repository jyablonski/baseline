from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from click.testing import CliRunner

from main import cli
from scrapers.broadcasts import (
    EspnHTTPError,
    _is_retryable,
    espn_get,
    national_networks,
    parse_scoreboard,
    scrape_broadcasts,
)

TEAM_GSW = UUID("7bf8726a-a852-452d-b81f-14839127c5fb")
TEAM_LAC = UUID("a79dabb2-26c5-443c-bbb4-cabdd8db5958")
GAME_ONE = UUID("00000000-0000-4000-8000-000000000101")


def _broadcast(name: str, market: str, media_type: str = "TV") -> dict:
    return {
        "media": {"shortName": name},
        "market": {"type": market},
        "type": {"shortName": media_type},
    }


def _event(event_id: str, when: str, away: str, home: str, broadcasts: list[dict]) -> dict:
    return {
        "id": event_id,
        "date": when,
        "competitions": [
            {
                "competitors": [
                    {"homeAway": "home", "team": {"displayName": home}},
                    {"homeAway": "away", "team": {"displayName": away}},
                ],
                "geoBroadcasts": broadcasts,
            }
        ],
    }


# 03:00Z on the 23rd is a 23:00 ET tip on the 22nd.
NATIONAL_EVENT = _event(
    "401",
    "2026-10-23T03:00Z",
    "LA Clippers",
    "Golden State Warriors",
    [
        _broadcast("ERADM", "National", "Radio"),
        _broadcast("ESPN", "National"),
        _broadcast("Prime Video", "National", "Streaming"),
        _broadcast("ESPN", "National"),
        _broadcast("NBC Sports BA", "Home"),
    ],
)
LOCAL_EVENT = _event(
    "402",
    "2026-10-23T00:00Z",
    "Boston Celtics",
    "Miami Heat",
    [_broadcast("FanDuel SN Sun", "Home")],
)


@contextmanager
def _session(mock_session):
    yield mock_session


@pytest.mark.unit
def test_national_networks_keeps_tv_and_streaming_only() -> None:
    competition = NATIONAL_EVENT["competitions"][0]
    assert national_networks(competition) == "ESPN, Prime Video"
    assert national_networks(LOCAL_EVENT["competitions"][0]) is None
    assert national_networks({}) is None
    assert national_networks({"geoBroadcasts": ["junk", _broadcast("", "National")]}) is None


@pytest.mark.unit
def test_parse_scoreboard_flattens_events() -> None:
    rows = parse_scoreboard({"events": [NATIONAL_EVENT, LOCAL_EVENT]})
    assert rows == [
        {
            "espn_event_id": "401",
            "commence_time": datetime(2026, 10, 23, 3, 0),
            "home_team_name": "Golden State Warriors",
            "away_team_name": "LA Clippers",
            "game_id": None,
            "national_tv": "ESPN, Prime Video",
        },
        {
            "espn_event_id": "402",
            "commence_time": datetime(2026, 10, 23, 0, 0),
            "home_team_name": "Miami Heat",
            "away_team_name": "Boston Celtics",
            "game_id": None,
            "national_tv": None,
        },
    ]


@pytest.mark.unit
def test_parse_scoreboard_skips_bad_payload() -> None:
    assert parse_scoreboard(["not", "a", "dict"]) == []
    assert parse_scoreboard({}) == []
    no_home = _event("403", "2026-10-23T00:00Z", "Boston Celtics", "", [])
    no_date = _event("404", "", "Boston Celtics", "Miami Heat", [])
    junk_competitor = {
        "id": "405",
        "date": "2026-10-23T00:00Z",
        "competitions": [{"competitors": ["junk"]}],
    }
    payload = {
        "events": [
            "junk",
            {"id": "406", "competitions": []},
            {"id": "407", "competitions": ["junk"]},
            no_home,
            no_date,
            junk_competitor,
        ]
    }
    assert parse_scoreboard(payload) == []


@pytest.mark.unit
def test_espn_get_requests_one_day() -> None:
    calls: list[dict] = []

    def fake_get(url: str, **kwargs):
        calls.append({"url": url, **kwargs})
        return SimpleNamespace(status_code=200, json=lambda: {"events": []})

    assert espn_get(date(2026, 10, 22), get=fake_get) == {"events": []}
    assert calls[0]["params"] == {"dates": "20261022"}
    assert "scoreboard" in calls[0]["url"]


@pytest.mark.unit
def test_espn_get_does_not_retry_client_errors() -> None:
    calls: list[str] = []

    def fake_get(url: str, **kwargs):
        calls.append(url)
        return SimpleNamespace(status_code=400, json=lambda: {})

    with pytest.raises(EspnHTTPError, match="HTTP 400") as excinfo:
        espn_get(date(2026, 10, 22), get=fake_get)
    assert excinfo.value.url.endswith("dates=20261022")
    assert len(calls) == 1


@pytest.mark.unit
def test_is_retryable() -> None:
    assert _is_retryable(EspnHTTPError(500, "u"))
    assert _is_retryable(EspnHTTPError(429, "u"))
    assert not _is_retryable(EspnHTTPError(404, "u"))
    assert not _is_retryable(ValueError("bad json"))
    assert _is_retryable(ConnectionError("reset"))


@pytest.mark.unit
def test_scrape_broadcasts_walks_the_window_and_matches_games(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
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
                full_name="Los Angeles Clippers",
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
                # The Eastern calendar day, not the UTC one in the feed.
                game_date=date(2026, 10, 22),
            )
        ],
    ]
    monkeypatch.setattr("scrapers.broadcasts.get_session", lambda: _session(session))
    captured: list[tuple[list[dict], list[str]]] = []

    def fake_upsert(_session, _model, rows, conflict):
        captured.append((rows, conflict))
        return len(rows)

    monkeypatch.setattr("scrapers.broadcasts.upsert_rows", fake_upsert)
    days: list[date] = []

    def fetch_day(day: date):
        days.append(day)
        # The same event on two days must still be one row.
        return {"events": [NATIONAL_EVENT, LOCAL_EVENT]} if len(days) <= 2 else {"events": []}

    count = scrape_broadcasts(fetch_day=fetch_day, today=date(2026, 10, 22), days_ahead=2)

    assert count == 2
    assert days == [date(2026, 10, 22), date(2026, 10, 23), date(2026, 10, 24)]
    rows, conflict = captured[0]
    assert conflict == ["espn_event_id"]
    by_event = {row["espn_event_id"]: row for row in rows}
    assert by_event["401"]["game_id"] == GAME_ONE
    assert by_event["401"]["national_tv"] == "ESPN, Prime Video"
    assert by_event["402"]["game_id"] is None
    assert all(isinstance(row["scraped_at"], datetime) for row in rows)


@pytest.mark.unit
def test_scrape_broadcasts_defaults_to_two_weeks_from_today(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = MagicMock()
    session.query.return_value.all.side_effect = [[], []]
    monkeypatch.setattr("scrapers.broadcasts.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.broadcasts.upsert_rows", lambda *args: 0)
    days: list[date] = []
    monkeypatch.setattr(
        "scrapers.broadcasts.espn_get", lambda day: days.append(day) or {"events": []}
    )
    assert scrape_broadcasts() == 0
    assert len(days) == 15
    assert (days[-1] - days[0]).days == 14


@pytest.mark.unit
def test_cli_scrape_broadcasts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("main.scrape_broadcasts", lambda: 11)
    result = CliRunner().invoke(cli, ["scrape-broadcasts"])
    assert result.exit_code == 0
    assert "Upserted 11 broadcast rows" in result.output
