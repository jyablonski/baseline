from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from click.testing import CliRunner

from main import cli
from models import PlayerContract, TeamPayroll
from scrapers import BrefHTTPError, bref_get, bref_rate_limit
from scrapers.contracts import scrape_contracts, team_contracts_url
from scrapers.contracts_parse import (
    BREF_TEAM_ABBREVIATIONS,
    bref_team_abbreviation,
    normalize_player_name,
    parse_contracts_html,
    parse_salary_text,
    parse_team_list,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "contracts"


def _html(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@contextmanager
def _session(mock_session):
    yield mock_session


@pytest.mark.unit
def test_contract_helpers() -> None:
    assert normalize_player_name("Kristaps Porziņģis") == "kristaps porzingis"
    assert normalize_player_name("Tim Hardaway Jr.") == "tim hardaway"
    assert bref_team_abbreviation("PHX") == "PHO"
    assert parse_team_list(None) == list(BREF_TEAM_ABBREVIATIONS)
    assert parse_team_list("GSW, PHX, BRK") == ["GSW", "PHO", "BRK"]
    with pytest.raises(ValueError, match="Unknown"):
        parse_team_list("SEA")
    assert parse_salary_text("$62,587,158") == 62587158
    assert parse_salary_text("-") is None


@pytest.mark.unit
def test_parse_contracts_fixture_is_provider_keyed() -> None:
    players, payroll = parse_contracts_html(
        _html("gsw_contracts.html"),
        bref_team_abbreviation="GSW",
        source_url="https://www.basketball-reference.com/contracts/GSW.html",
    )
    by_key = {(row["bref_player_slug"], row["season"]): row for row in players}
    assert by_key[("curryst01", "2026-27")]["salary"] == 62587158
    assert by_key[("porzikr01", "2027-28")]["player_name_normalized"] == "kristaps porzingis"
    assert "team_id" not in by_key[("curryst01", "2026-27")]
    assert {row["season"] for row in payroll} == {"2026-27", "2027-28"}


@pytest.mark.unit
def test_parse_comment_wrapped_contracts() -> None:
    players, payroll = parse_contracts_html(
        _html("comment_wrapped.html"),
        bref_team_abbreviation="LAC",
        source_url="https://www.basketball-reference.com/contracts/LAC.html",
    )
    assert len(players) == 1
    assert players[0]["bref_player_slug"] == "leonaka01"
    assert payroll[0]["bref_team_abbreviation"] == "LAC"


@pytest.mark.unit
def test_scrape_contracts_canonicalizes_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    monkeypatch.setattr("scrapers.contracts.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.contracts.seed_team_catalog", lambda *args, **kwargs: 30)
    monkeypatch.setattr("scrapers.contracts.resolve_team_id", lambda *args, **kwargs: "team-id")
    monkeypatch.setattr("scrapers.contracts.ensure_player", lambda *args, **kwargs: "player-id")
    captured: list[tuple] = []

    def fake_upsert(_session, model, rows, conflict):
        captured.append((model, rows, conflict))
        return len(rows)

    monkeypatch.setattr("scrapers.contracts.upsert_rows", fake_upsert)
    counts = scrape_contracts("GSW", fetch_html=lambda url: _html("gsw_contracts.html"))
    assert counts == (4, 2)
    assert captured[0][0] is PlayerContract
    assert captured[0][2] == ["player_id", "team_id", "season"]
    assert captured[0][1][0]["player_id"] == "player-id"
    assert captured[1][0] is TeamPayroll
    # Rows this run did not rewrite for the team are players who left its page.
    statement, params = session.execute.call_args.args
    assert "DELETE FROM source.player_contracts" in str(statement)
    assert params["team_id"] == "team-id"
    assert params["scraped_at"] == captured[0][1][0]["scraped_at"]
    assert session.execute.call_count == 1


@pytest.mark.unit
def test_scrape_contracts_keeps_old_rows_when_a_page_parses_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty parse is a broken page, not a team with nobody under contract."""
    session = MagicMock()
    monkeypatch.setattr("scrapers.contracts.get_session", lambda: _session(session))
    monkeypatch.setattr("scrapers.contracts.seed_team_catalog", lambda *args, **kwargs: 30)
    monkeypatch.setattr("scrapers.contracts.upsert_rows", lambda *args: 0)
    counts = scrape_contracts("GSW", fetch_html=lambda url: "<html><body></body></html>")
    assert counts == (0, 0)
    session.execute.assert_not_called()


@pytest.mark.unit
def test_transport_exports_and_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    assert team_contracts_url("gsw").endswith("/contracts/GSW.html")
    response = SimpleNamespace(status_code=200, text="ok")
    monkeypatch.setattr("scrapers.BREF_REQUEST_DELAY_SECONDS", 0)
    assert bref_get("https://example.test", get=lambda *args, **kwargs: response) == "ok"
    bref_rate_limit()
    with pytest.raises(BrefHTTPError):
        bref_get(
            "https://example.test",
            get=lambda *args, **kwargs: SimpleNamespace(status_code=403, text="no"),
        )
    monkeypatch.setattr("main.scrape_contracts", lambda teams=None: (12, 3))
    result = CliRunner().invoke(cli, ["scrape-contracts", "--teams", "GSW"])
    assert result.exit_code == 0
    assert "12" in result.output
