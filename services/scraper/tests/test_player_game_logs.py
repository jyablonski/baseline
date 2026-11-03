from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from scrapers.player_game_logs import (
    boxscore_url,
    parse_boxscore_html,
    scrape_logs_for_games,
    scrape_player_game_logs,
)


@contextmanager
def _session(mock_session):
    yield mock_session


BOXSCORE_HTML = """
<table id="box-score-GSW"><tbody>
  <tr>
    <th data-stat="player"><a href="/players/c/curryst01.html">Stephen Curry</a></th>
    <td data-stat="mp">36:30</td><td data-stat="fg" csk="8-12">8-12</td>
    <td data-stat="fg_pct" csk=".667">.667</td><td data-stat="fg3" csk="4-7">4-7</td>
    <td data-stat="ft" csk="5-5">5-5</td><td data-stat="pts">25</td>
    <td data-stat="orb">1</td><td data-stat="drb">5</td>
    <td data-stat="trb">6</td><td data-stat="ast">8</td><td data-stat="stl">2</td>
    <td data-stat="blk">1</td><td data-stat="tov">3</td><td data-stat="pf">4</td>
    <td data-stat="plus_minus">12</td>
  </tr>
  <tr><th data-stat="player">Team Totals</th></tr>
</tbody></table>
"""

LIVE_BOXSCORE_HTML = """
<table id="box-GSW-game-basic"><tbody>
  <tr>
    <th data-stat="player"><a href="/players/c/curryst01.html">Stephen Curry</a></th>
    <td data-stat="mp">36:30</td><td data-stat="fg">8</td><td data-stat="fga">12</td>
    <td data-stat="fg_pct">.667</td><td data-stat="fg3">4</td><td data-stat="fg3a">7</td>
    <td data-stat="fg3_pct">.571</td><td data-stat="ft">5</td><td data-stat="fta">5</td>
    <td data-stat="pts">25</td><td data-stat="trb">6</td><td data-stat="ast">8</td>
  </tr>
</tbody></table>
<table id="box-GSW-q1-basic"><tbody><tr></tr></tbody></table>
"""


@pytest.mark.unit
def test_parse_bref_boxscore_html() -> None:
    game_id = uuid4()
    rows = parse_boxscore_html(
        BOXSCORE_HTML, game_id=game_id, game_date="2024-10-22", season="2024-25"
    )
    assert len(rows) == 1
    assert rows[0]["external_id"] == "curryst01"
    assert rows[0]["team_bref_abbreviation"] == "GSW"
    assert rows[0]["min"] == 36.5
    assert rows[0]["fgm"] == 8
    assert rows[0]["fga"] == 12
    assert rows[0]["fg3a"] == 7
    assert rows[0]["pts"] == 25
    assert rows[0]["orb"] == 1
    assert rows[0]["drb"] == 5
    assert rows[0]["pf"] == 4
    assert boxscore_url("202410220GSW").endswith("/boxscores/202410220GSW.html")


@pytest.mark.unit
def test_parse_boxscore_without_tables_is_empty() -> None:
    assert (
        parse_boxscore_html("<html></html>", game_id=uuid4(), game_date=None, season="2024-25")
        == []
    )


@pytest.mark.unit
def test_parse_live_boxscore_table_shape() -> None:
    rows = parse_boxscore_html(
        LIVE_BOXSCORE_HTML, game_id=uuid4(), game_date="2025-10-21", season="2025-26"
    )
    assert len(rows) == 1
    assert rows[0]["team_bref_abbreviation"] == "GSW"
    assert rows[0]["min"] == 36.5
    assert rows[0]["fgm"] == 8
    assert rows[0]["fga"] == 12
    assert rows[0]["fg3a"] == 7


@pytest.mark.unit
def test_scrape_logs_for_games_resolves_players_and_matchups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    game_id = uuid4()
    home_id, away_id = uuid4(), uuid4()
    game = SimpleNamespace(
        game_id=game_id,
        season="2024-25",
        game_date="2024-10-22",
        home_team_id=home_id,
        away_team_id=away_id,
        home_score=122,
        away_score=110,
        status="Final",
    )
    external = SimpleNamespace(game_id=game_id, external_id="202410220GSW")
    home = SimpleNamespace(team_id=home_id, abbreviation="GSW")
    away = SimpleNamespace(team_id=away_id, abbreviation="LAL")
    lookup, scrape = MagicMock(), MagicMock()
    lookup.query.return_value.filter.return_value.all.return_value = [game]
    scrape.scalars.side_effect = [
        SimpleNamespace(all=lambda: [external]),
        SimpleNamespace(all=lambda: []),
    ]
    scrape.query.return_value.filter.return_value.all.return_value = [home, away]
    captured: list[list[dict]] = []
    sessions = iter((_session(lookup), _session(scrape)))
    monkeypatch.setattr("scrapers.player_game_logs.get_session", lambda: next(sessions))
    monkeypatch.setattr("scrapers.player_game_logs.seed_team_catalog", lambda *args, **kwargs: 30)
    monkeypatch.setattr(
        "scrapers.player_game_logs.resolve_team_id",
        lambda _session, code: home_id if code == "GSW" else None,
    )
    monkeypatch.setattr("scrapers.player_game_logs.ensure_player", lambda *args, **kwargs: uuid4())
    monkeypatch.setattr(
        "scrapers.player_game_logs.upsert_rows",
        lambda _s, _m, rows, _c: captured.append(rows) or len(rows),
    )
    written = scrape_logs_for_games(
        [{"game_id": str(game_id)}],
        fetch_html=lambda url: BOXSCORE_HTML,
    )
    assert written == 1
    assert captured[0][0]["matchup"] == "GSW vs. LAL"
    assert captured[0][0]["wl"] == "W"


@pytest.mark.unit
def test_scrape_player_game_logs_passes_active_player_filter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    player_id = uuid4()
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "scrapers.player_game_logs._player_ids_for_season",
        lambda season, active_only=False: [player_id],
    )
    monkeypatch.setattr("scrapers.player_game_logs._final_games_for_season", lambda season: [])

    def fake_scrape(games, *, fetch_html=None, active_player_ids=None):
        captured["active_player_ids"] = active_player_ids
        return 0

    monkeypatch.setattr("scrapers.player_game_logs._scrape_games", fake_scrape)
    assert scrape_player_game_logs("2025-26", active_only=True) == 0
    assert captured["active_player_ids"] == {player_id}
