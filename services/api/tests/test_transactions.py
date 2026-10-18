from datetime import date

import pytest
from ids import TEAM_GSW

TRANSACTION_KEY = "a" * 64


def _transaction_row(**overrides) -> dict:
    row = {
        "transaction_key": TRANSACTION_KEY,
        "transaction_date": date(2025, 7, 6),
        "season": "2025-26",
        "description": "In a 7-team trade, the Atlanta Hawks traded Clint Capela.",
        "team_count": 14,
        "player_count": 12,
        "source_url": "https://www.basketball-reference.com/leagues/NBA_2026_transactions.html",
        "team_names": ["Atlanta Hawks", "Houston Rockets"],
        "team_abbreviations": ["ATL", "HOU"],
        "player_names": ["Clint Capela"],
        "linked_player_names": ["Clint Capela"],
    }
    row.update(overrides)
    return row


def _participant_row(**overrides) -> dict:
    row = {
        "transaction_key": TRANSACTION_KEY,
        "transaction_date": date(2025, 7, 6),
        "season": "2025-26",
        "participant_type": "team",
        "direction": "from",
        "display_name": "Atlanta Hawks",
        "bref_slug": "ATL",
        "player_id": None,
        "team_id": TEAM_GSW,
        "team_abbreviation": "ATL",
        "player_name": None,
        "match_method": "external_id",
    }
    row.update(overrides)
    return row


@pytest.mark.unit
def test_list_transactions(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result([mapping_row(_transaction_row())]),
    ]
    response = client.get("/api/v1/transactions", params={"season": "2025-26"})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    row = body["data"][0]
    assert row["transaction_key"] == TRANSACTION_KEY
    assert row["team_count"] == 14
    assert row["team_abbreviations"] == ["ATL", "HOU"]
    assert row["player_names"] == ["Clint Capela"]
    assert row["linked_player_names"] == ["Clint Capela"]


@pytest.mark.unit
def test_list_transactions_binds_normalized_filters(
    client, session, mapping_row, query_result
) -> None:
    """Abbreviations upper-case and blank search collapses to NULL."""
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get(
        "/api/v1/transactions",
        params={"team_abbreviation": "atl", "search": "   "},
    )
    assert response.status_code == 200
    _, params = session.calls[0]
    assert params["team_abbreviation"] == "ATL"
    assert params["search"] is None


@pytest.mark.unit
def test_list_transactions_wraps_search_in_wildcards(
    client, session, mapping_row, query_result
) -> None:
    """ILIKE wildcards belong to the bound value, not the SQL."""
    session.queue = [query_result(scalar=0), query_result([])]
    client.get("/api/v1/transactions", params={"search": "traded"})
    _, params = session.calls[0]
    assert params["search"] == "%traded%"


@pytest.mark.unit
def test_list_transactions_rejects_bad_player_id(client) -> None:
    response = client.get("/api/v1/transactions", params={"player_id": "not-a-uuid"})
    assert response.status_code == 422


@pytest.mark.unit
def test_list_transactions_rejects_oversized_limit(client) -> None:
    assert client.get("/api/v1/transactions", params={"limit": 500}).status_code == 422
