from contextlib import contextmanager
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from scrapers.play_by_play import (
    NoFinalGamesError,
    map_play_by_play_action,
    parse_play_by_play_html,
    play_by_play_url,
    scrape_play_by_play,
)


@contextmanager
def _session(mock_session):
    yield mock_session


PBP_HTML = """
<table id="pbp"><tbody>
  <tr>
    <td data-stat="quarter">1</td><td data-stat="time">11:32</td>
    <td data-stat="home_score">2</td><td data-stat="away_score">0</td>
    <td data-stat="a1">Stephen Curry makes 2-pt shot</td>
    <td data-stat="a2">Golden State Warriors</td>
    <td><a href="/players/c/curryst01.html">Stephen Curry</a><a href="/teams/GSW/2025.html">GSW</a></td>
  </tr>
</tbody></table>
"""

LIVE_PBP_HTML = """
<table id="pbp"><tbody>
  <tr class="thead" id="q1"><th colspan="6">1st Q</th></tr>
  <tr class="thead"><th>Time</th><th>Houston</th><th></th><th>Score</th><th></th><th>Oklahoma City</th></tr>
  <tr>
    <td>11:32.0</td>
    <td><a href="/players/c/curryst01.html">Stephen Curry makes 2-pt shot</a></td>
    <td></td><td>2-0</td><td></td><td></td>
  </tr>
  <tr>
    <td>11:01.0</td><td></td><td></td><td>2-2</td><td></td>
    <td><a href="/players/d/duranke01.html">Kevin Durant makes 2-pt shot</a></td>
  </tr>
</tbody></table>
"""


@pytest.mark.unit
def test_parse_bref_play_by_play_html() -> None:
    game_id = uuid4()
    rows = parse_play_by_play_html(PBP_HTML, game_id=game_id, season="2024-25")
    assert len(rows) == 1
    assert rows[0]["game_id"] == game_id
    assert rows[0]["player_external_id"] == "curryst01"
    assert rows[0]["team_bref_abbreviation"] == "GSW"
    assert rows[0]["description"] == "Stephen Curry makes 2-pt shot | Golden State Warriors"
    assert parse_play_by_play_html("<html></html>", game_id=game_id, season="2024-25") == []
    assert play_by_play_url("202410220GSW").endswith("/boxscores/pbp/202410220GSW.html")


@pytest.mark.unit
def test_parse_live_bref_play_by_play_layout() -> None:
    rows = parse_play_by_play_html(
        LIVE_PBP_HTML,
        game_id=uuid4(),
        season="2025-26",
        home_bref_abbreviation="OKC",
        away_bref_abbreviation="HOU",
    )
    assert len(rows) == 2
    assert rows[0]["period"] == 1
    assert rows[0]["clock"] == "11:32.0"
    assert rows[0]["score_home"] == 0
    assert rows[0]["score_away"] == 2
    assert rows[0]["team_bref_abbreviation"] == "HOU"
    assert rows[1]["team_bref_abbreviation"] == "OKC"

    jump_ball = LIVE_PBP_HTML.replace(
        "</tbody>",
        "<tr><td>12:00.0</td><td>Jump ball</td></tr></tbody>",
    )
    jump_rows = parse_play_by_play_html(
        jump_ball,
        game_id=uuid4(),
        season="2025-26",
        home_bref_abbreviation="OKC",
        away_bref_abbreviation="HOU",
    )
    assert jump_rows[-1]["description"] == "Jump ball"
    assert jump_rows[-1]["score_home"] is None


@pytest.mark.unit
def test_map_play_by_play_action_normalizes_values() -> None:
    game_id = uuid4()
    stamp = datetime.now()
    row = map_play_by_play_action(
        {
            "action_number": "4",
            "action_id": "5",
            "period": "1",
            "score_home": "2",
            "description": "shot",
        },
        game_id=game_id,
        season="2024-25",
        scraped_at=stamp,
    )
    assert row is not None
    assert row["game_id"] == game_id
    assert row["action_number"] == 4
    assert row["action_id"] == 5
    assert row["score_home"] == 2
    assert row["scraped_at"] == stamp
    assert map_play_by_play_action({}, game_id=game_id, season="2024-25", scraped_at=stamp) is None


@pytest.mark.unit
def test_scrape_play_by_play_requires_completed_games(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("scrapers.play_by_play._final_games_for_season", lambda season: [])
    with pytest.raises(NoFinalGamesError, match="2024-25"):
        scrape_play_by_play("2024-25")


@pytest.mark.unit
def test_scrape_play_by_play_resolves_player_and_upserts(monkeypatch: pytest.MonkeyPatch) -> None:
    game_id = uuid4()
    home_team_id, away_team_id = uuid4(), uuid4()
    game = SimpleNamespace(
        game_id=game_id,
        season="2024-25",
        home_team_id=home_team_id,
        away_team_id=away_team_id,
    )
    external = SimpleNamespace(game_id=game_id, external_id="202410220GSW")
    first, second = MagicMock(), MagicMock()
    game_query, team_query = MagicMock(), MagicMock()
    game_query.filter.return_value.all.return_value = [game]
    team_query.filter.return_value.all.return_value = [
        SimpleNamespace(team_id=home_team_id, abbreviation="GSW"),
        SimpleNamespace(team_id=away_team_id, abbreviation="LAL"),
    ]
    first.query.side_effect = [game_query, team_query]
    first.scalars.side_effect = [
        SimpleNamespace(all=lambda: [external]),
        SimpleNamespace(all=lambda: []),
    ]
    captured: list[list[dict]] = []
    monkeypatch.setattr(
        "scrapers.play_by_play.get_session",
        lambda: iter((_session(first), _session(second))).__next__(),
    )
    monkeypatch.setattr("scrapers.play_by_play.seed_team_catalog", lambda *args, **kwargs: 30)
    team_id = uuid4()
    monkeypatch.setattr(
        "scrapers.play_by_play.resolve_team_id",
        lambda _session, code: team_id if code == "GSW" else None,
    )
    ensured: list[dict] = []
    monkeypatch.setattr(
        "scrapers.play_by_play.ensure_player",
        lambda *args, **kwargs: ensured.append(kwargs) or uuid4(),
    )
    monkeypatch.setattr(
        "scrapers.play_by_play.upsert_rows",
        lambda _s, _m, rows, _c: captured.append(rows) or len(rows),
    )
    written = scrape_play_by_play(
        game_ids=[game_id],
        fetch_actions=lambda external_id: [
            {
                # BRef files a foul under the fouled team's column, so the
                # row's team is GSW while the fouler plays for LAL.
                "action_number": 1,
                "team_bref_abbreviation": "GSW",
                "player_external_id": "doncilu01",
                "player_name": "Luka Dončić",
                "description": "Personal foul by L. Dončić",
            }
        ],
    )
    assert written == 1
    assert captured[0][0]["team_id"] == team_id
    # The fouler must keep his roster team rather than take the row's team.
    assert ensured[0].get("team_id") is None


ASSISTED_PBP_HTML = """
<table id="pbp"><tbody>
  <tr class="thead" id="q1"><th colspan="6">1st Q</th></tr>
  <tr>
    <td>10:04.0</td>
    <td></td><td></td><td>4-2</td><td></td>
    <td>
      <a href="/players/h/holmgch01.html">C. Holmgren</a> makes 2-pt layup from 1 ft
      (assist by <a href="/players/d/dortlu01.html">L. Dort</a>)
    </td>
  </tr>
</tbody></table>
"""


FOULS_PBP_HTML = """
<table id="pbp"><tbody>
  <tr class="thead" id="q4"><th colspan="6">4th Q</th></tr>
  <tr>
    <td>1:12.0</td><td></td><td></td><td>110-114</td><td></td>
    <td>Personal foul by <a href="/players/d/doncilu01.html">L. Dončić</a>
      (drawn by <a href="/players/d/diabamo01.html">M. Diabaté</a> )</td>
  </tr>
  <tr>
    <td>1:05.0</td><td></td><td></td><td>110-114</td><td></td>
    <td>Flagrant foul type 1 by <a href="/players/v/vandeja01.html">J. Vanderbilt</a>
      (drawn by <a href="/players/m/millebr02.html">B. Miller</a> )</td>
  </tr>
  <tr>
    <td>0:58.0</td>
    <td>Offensive foul by <a href="/players/d/doncilu01.html">L. Dončić</a>
      (drawn by <a href="/players/j/jamessi01.html">S. James</a> )</td>
    <td></td><td>110-114</td><td></td><td></td>
  </tr>
  <tr>
    <td>0:40.0</td>
    <td>Loose ball foul by <a href="/players/w/willizi02.html">Z. Williams</a>
      (drawn by <a href="/players/d/diabamo01.html">M. Diabaté</a> )</td>
    <td></td><td>110-114</td><td></td><td></td>
  </tr>
  <tr>
    <td>0:31.0</td>
    <td>Technical foul by <a href="/players/d/doncilu01.html">L. Dončić</a></td>
    <td></td><td>110-114</td><td></td><td></td>
  </tr>
  <tr>
    <td>0:20.0</td><td></td><td></td><td>110-114</td><td></td>
    <td>Rescinded technical foul by <a href="/players/d/doncilu01.html">L. Dončić</a></td>
  </tr>
</tbody></table>
"""


@pytest.mark.unit
def test_fouls_are_credited_to_the_foulers_team() -> None:
    """BRef files personal / shooting / take / flagrant fouls and rescinded
    technicals in the opponent's column, and offensive / loose-ball / technical
    fouls in the fouler's. Away is LAL, home is CHA."""
    rows = parse_play_by_play_html(
        FOULS_PBP_HTML,
        game_id=uuid4(),
        season="2026-27",
        home_bref_abbreviation="CHO",
        away_bref_abbreviation="LAL",
    )
    teams = [(row["player_external_id"], row["team_bref_abbreviation"]) for row in rows]
    assert teams == [
        ("doncilu01", "LAL"),
        ("vandeja01", "LAL"),
        ("doncilu01", "LAL"),
        ("willizi02", "LAL"),
        ("doncilu01", "LAL"),
        ("doncilu01", "LAL"),
    ]


def _mangle(value: str) -> str:
    """Reproduce UTF-8 bytes decoded as latin-1, the way requests mangles BRef."""
    return value.encode("utf-8").decode("latin-1")


@pytest.mark.unit
def test_primary_player_is_the_actor_not_the_assister() -> None:
    """BRef names the scorer first; crediting the last link would credit the assister."""
    rows = parse_play_by_play_html(
        ASSISTED_PBP_HTML,
        game_id=uuid4(),
        season="2025-26",
        home_bref_abbreviation="OKC",
        away_bref_abbreviation="HOU",
    )
    assert len(rows) == 1
    assert rows[0]["player_external_id"] == "holmgch01"
    assert rows[0]["secondary_player_external_id"] == "dortlu01"
    assert rows[0]["team_bref_abbreviation"] == "OKC"


@pytest.mark.unit
def test_single_player_event_has_no_secondary() -> None:
    rows = parse_play_by_play_html(
        LIVE_PBP_HTML,
        game_id=uuid4(),
        season="2025-26",
        home_bref_abbreviation="OKC",
        away_bref_abbreviation="HOU",
    )
    assert rows[0]["player_external_id"] == "curryst01"
    assert rows[0]["secondary_player_external_id"] is None


@pytest.mark.unit
def test_map_action_carries_secondary_player() -> None:
    secondary = uuid4()
    mapped = map_play_by_play_action(
        {"action_number": 3, "secondary_player_id": secondary},
        game_id=uuid4(),
        season="2025-26",
        scraped_at=datetime(2025, 10, 1),
    )
    assert mapped is not None
    assert mapped["secondary_player_id"] == secondary


@pytest.mark.unit
def test_repair_mojibake_round_trip() -> None:
    from scrapers import repair_mojibake

    assert repair_mojibake(_mangle("Nikola Joki\u0107")) == "Nikola Joki\u0107"
    assert repair_mojibake(_mangle("Dennis Schr\u00f6der")) == "Dennis Schr\u00f6der"
    # Already-correct text and plain ASCII are left alone.
    assert repair_mojibake("Nikola Joki\u0107") == "Nikola Joki\u0107"
    assert repair_mojibake("Kevin Durant") == "Kevin Durant"


@pytest.mark.unit
def test_repair_encoded_text_updates_only_mangled_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    from scrapers import play_by_play as pbp

    mangled_player = SimpleNamespace(
        full_name=_mangle("Nikola Joki\u0107"), first_name="Nikola", last_name=None
    )
    clean_player = SimpleNamespace(full_name="Kevin Durant", first_name="Kevin", last_name="Durant")
    mangled_action = SimpleNamespace(description=_mangle("Foul by A. \u015eeng\u00fcn"))
    clean_action = SimpleNamespace(description="Foul by K. Durant")

    def fake_query(model):
        if model is pbp.Player:
            return SimpleNamespace(all=lambda: [mangled_player, clean_player])
        return SimpleNamespace(
            filter=lambda *_: SimpleNamespace(all=lambda: [mangled_action, clean_action])
        )

    session = SimpleNamespace(query=fake_query)
    monkeypatch.setattr(pbp, "get_session", lambda: _session(session))

    assert pbp.repair_encoded_text() == (1, 1)
    assert mangled_player.full_name == "Nikola Joki\u0107"
    assert mangled_player.last_name == "Joki\u0107"
    assert clean_player.full_name == "Kevin Durant"
    assert mangled_action.description == "Foul by A. \u015eeng\u00fcn"
    assert clean_action.description == "Foul by K. Durant"
