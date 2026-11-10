from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from click.testing import CliRunner

from main import cli, main
from models import Player, PlayerExternalId
from scrapers.players import (
    parse_player_directory_html,
    parse_player_profile_html,
    parse_roster_html,
    player_directory_url,
    player_profile_url,
)
from scrapers.teams import scrape_teams


@contextmanager
def _session(mock_session):
    yield mock_session


ROSTER_HTML = """
<table id="roster"><tbody>
  <tr><th data-stat="player"><a href="/players/c/curryst01.html">Stephen Curry</a></th>
  <td data-stat="number">30</td><td data-stat="pos">PG</td><td data-stat="height">6-2</td>
  <td data-stat="weight">185</td><td data-stat="birth_date">1988-03-14</td><td data-stat="years">2010-2025</td></tr>
</tbody></table>
"""

PLAYER_DIRECTORY_HTML = """
<table id="players"><tbody>
  <tr><th data-stat="player"><a href="/players/c/curryst01.html">Stephen Curry</a></th></tr>
</tbody></table>
"""


@pytest.mark.unit
def test_scrape_teams_uses_repo_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    monkeypatch.setattr("scrapers.teams.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.teams.seed_team_catalog", lambda _session: 30)
    assert scrape_teams() == 30


@pytest.mark.unit
def test_parse_roster_html_emits_bref_external_id() -> None:
    rows = parse_roster_html(ROSTER_HTML, team_id="team-id", source_url="https://example.test")
    assert rows[0]["provider"] == "basketball-reference"
    assert rows[0]["external_id"] == "curryst01"
    assert rows[0]["team_id"] == "team-id"
    assert rows[0]["weight"] == 185


@pytest.mark.unit
def test_parse_roster_comment_wrapper_and_invalid_birth_date() -> None:
    html = '<!-- <table id="roster"><tbody><tr><th data-stat="player"><a href="/players/x/testpl01.html">Test Player</a></th><td data-stat="birth_date">bad</td></tr></tbody></table> -->'
    rows = parse_roster_html(html, team_id="team-id", source_url="https://example.test")
    assert rows[0]["external_id"] == "testpl01"
    assert rows[0]["birth_date"] is None


def test_parse_roster_uses_visible_position_and_height_over_sort_keys() -> None:
    html = """
    <table id="roster"><tbody>
      <tr>
        <th data-stat="player"><a href="/players/t/testpl01.html">Test Player</a></th>
        <td data-stat="pos" csk="1">PG</td>
        <td data-stat="height" csk="74.0">6-2</td>
        <td data-stat="weight" csk="185">185</td>
        <td data-stat="birth_date" csk="1988-03-14">1988-03-14</td>
      </tr>
    </tbody></table>
    """
    from scrapers.players import parse_roster_html

    rows = parse_roster_html(html, team_id="team", source_url="https://example.test/roster")
    assert rows[0]["position"] == "PG"
    assert rows[0]["height"] == "6-2"
    assert (
        parse_roster_html("<html></html>", team_id="team-id", source_url="https://example.test")
        == []
    )


@pytest.mark.unit
def test_parse_player_directory_html_and_url() -> None:
    assert player_directory_url("C") == "https://www.basketball-reference.com/players/c/"
    with pytest.raises(ValueError):
        player_directory_url("12")
    assert parse_player_directory_html(PLAYER_DIRECTORY_HTML) == {"curryst01": "Stephen Curry"}

    wrapped = f"<!-- {PLAYER_DIRECTORY_HTML} -->"
    assert parse_player_directory_html(wrapped) == {"curryst01": "Stephen Curry"}
    assert player_profile_url("CurryST01") == (
        "https://www.basketball-reference.com/players/c/curryst01.html"
    )
    with pytest.raises(ValueError):
        player_profile_url("not-a-valid-slug!")
    assert parse_player_profile_html("<h1>Stephen Curry</h1>") == "Stephen Curry"
    assert parse_player_profile_html("<html></html>") is None


@pytest.mark.unit
def test_player_parsers_skip_non_player_rows() -> None:
    malformed = """
    <table id="roster"><tbody>
      <tr class="thead"><th data-stat="player">Player</th></tr>
      <tr><td data-stat="other">No player cell</td></tr>
      <tr><th data-stat="player">Player</th></tr>
      <tr><th data-stat="player"><a href="/not-a-player">Unknown Player</a></th></tr>
    </tbody></table>
    """
    assert parse_roster_html(malformed, team_id="team-id", source_url="https://example.test") == []
    assert parse_player_directory_html("<!-- <table id='other'></table> -->") == {}


@pytest.mark.unit
def test_scrape_players_fetches_bref_rosters(monkeypatch: pytest.MonkeyPatch) -> None:
    import catalog.teams

    entry = catalog.teams.TEAM_CATALOG[0]
    player_id = "player-id"
    session = MagicMock()
    session.get.return_value = MagicMock()
    monkeypatch.setattr("catalog.teams.TEAM_CATALOG", (entry,))
    monkeypatch.setattr("scrapers.players.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.players.seed_team_catalog", lambda *args, **kwargs: 1)
    monkeypatch.setattr("scrapers.players.ensure_player", lambda *args, **kwargs: player_id)
    assert (
        __import__("scrapers.players", fromlist=["scrape_players"]).scrape_players(
            season="2024-25", fetch_html=lambda url: ROSTER_HTML
        )
        == 1
    )


@pytest.mark.unit
def test_scrape_players_stops_on_rate_limit_instead_of_writing_a_partial_roster(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import catalog.teams

    import scrapers
    from scrapers.players import scrape_players

    get_session = MagicMock()
    monkeypatch.setattr("catalog.teams.TEAM_CATALOG", catalog.teams.TEAM_CATALOG[:2])
    monkeypatch.setattr("scrapers.players.get_session", get_session)
    fetched: list[str] = []

    def rate_limited(url: str) -> str:
        fetched.append(url)
        raise scrapers.BrefRateLimitedError(url, first_url=url)

    with pytest.raises(scrapers.BrefRateLimitedError):
        scrape_players(season="2024-25", fetch_html=rate_limited)
    assert len(fetched) == 1
    get_session.assert_not_called()


@pytest.mark.unit
def test_scrape_players_repairs_existing_non_roster_player(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import catalog.teams

    entry = catalog.teams.TEAM_CATALOG[0]
    old_player_id = "old-player-id"
    roster_player_id = "roster-player-id"
    old_player = Player(
        player_id=old_player_id,
        first_name="O.",
        last_name="Player",
        full_name="O. Player",
    )
    roster_player = Player(
        player_id=roster_player_id,
        first_name="Stephen",
        last_name="Curry",
        full_name="Stephen Curry",
    )
    crosswalk = PlayerExternalId(
        player_id=old_player_id,
        provider="basketball-reference",
        external_id="oldpl01",
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [crosswalk]

    def get(model, key):
        if model is PlayerExternalId:
            return crosswalk if key == ("basketball-reference", "oldpl01") else None
        if model is Player:
            return old_player if key == old_player_id else roster_player
        return None

    session.get.side_effect = get

    def fetch_html(url: str) -> str:
        if url.endswith("/players/c/"):
            return PLAYER_DIRECTORY_HTML
        if url.endswith("/players/o/oldpl01.html"):
            return "<h1>Old Player</h1>"
        return ROSTER_HTML

    monkeypatch.setattr("catalog.teams.TEAM_CATALOG", (entry,))
    monkeypatch.setattr("scrapers.players.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.players.seed_team_catalog", lambda *args, **kwargs: 1)
    monkeypatch.setattr("scrapers.players.ensure_player", lambda *args, **kwargs: roster_player_id)

    from scrapers.players import scrape_players

    assert scrape_players(season="2024-25", fetch_html=fetch_html) == 1
    assert old_player.full_name == "Old Player"
    assert old_player.first_name == "Old"
    assert old_player.last_name == "Player"


@pytest.mark.unit
def test_cli_entrypoint_and_core_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[bool] = []
    monkeypatch.setattr("main.cli", lambda: called.append(True))
    main()
    assert called == [True]

    monkeypatch.setattr("main.scrape_teams", lambda: 30)
    monkeypatch.setattr("main.scrape_players", lambda: 10)
    monkeypatch.setattr("main.scrape_games", lambda season: 82)
    monkeypatch.setattr("main.scrape_player_game_logs", lambda season, active_only=False: 5)
    monkeypatch.setattr("main.scrape_standings", lambda season: 30)
    runner = CliRunner()
    assert runner.invoke(cli, ["scrape-teams"]).exit_code == 0
    assert runner.invoke(cli, ["scrape-players"]).exit_code == 0
    assert runner.invoke(cli, ["scrape-games", "--season", "2024-25"]).exit_code == 0
    assert runner.invoke(cli, ["scrape-game-logs", "--season", "2024-25"]).exit_code == 0
    assert runner.invoke(cli, ["scrape-standings", "--season", "2024-25"]).exit_code == 0
