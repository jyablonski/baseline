from datetime import date
from uuid import UUID

import pytest
from ids import GAME_ONE, MISSING_ID, PLAYER_CURRY, TEAM_GSW


def _injury_row() -> dict:
    return {
        "player_id": PLAYER_CURRY,
        "player_name": "Stephen Curry",
        "team_id": TEAM_GSW,
        "team_abbreviation": "GSW",
        "injury_status": "Out",
        "injury_detail": "Ankle",
        "description": "Out (Ankle) - Left ankle sprain",
        "update_date": date(2026, 10, 20),
        "is_notable": True,
    }


@pytest.mark.unit
def test_list_injuries(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result([mapping_row(_injury_row())])]
    response = client.get("/api/v1/injuries", params={"team_id": TEAM_GSW, "notable": "true"})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["injury_status"] == "Out"
    _, params = session.calls[-1]
    assert params == {"team_id": UUID(TEAM_GSW), "notable": True}


@pytest.mark.unit
def test_list_injuries_unfiltered_binds_nulls(client, session, query_result) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/injuries")
    assert response.status_code == 200
    assert response.json()["data"] == []
    _, params = session.calls[-1]
    assert params == {"team_id": None, "notable": None}


@pytest.mark.unit
def test_game_injuries(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        **_injury_row(),
                        "game_id": GAME_ONE,
                        "side": "home",
                        "snapshot_date": date(2026, 10, 21),
                        "played": False,
                    }
                )
            ]
        ),
    ]
    response = client.get(f"/api/v1/games/{GAME_ONE}/injuries")
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert (row["side"], row["played"], row["snapshot_date"]) == ("home", False, "2026-10-21")


@pytest.mark.unit
def test_game_injuries_empty_report_is_not_an_error(client, session, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result([]),
    ]
    response = client.get(f"/api/v1/games/{GAME_ONE}/injuries")
    assert response.status_code == 200
    assert response.json()["data"] == []


@pytest.mark.unit
def test_game_injuries_unknown_game(client, session, query_result) -> None:
    session.queue = [query_result(scalar=None)]
    assert client.get(f"/api/v1/games/{MISSING_ID}/injuries").status_code == 404


@pytest.mark.unit
def test_injury_sql_orders_notable_and_ruled_out_first() -> None:
    from queries.games import LIST_SCHEDULE
    from queries.injuries import LIST_GAME_INJURIES, LIST_INJURIES

    assert "FROM gold.fct_player_injuries" in str(LIST_INJURIES)
    sql = str(LIST_GAME_INJURIES)
    assert "FROM gold.fct_game_injuries" in sql
    assert "fct_game_injuries.is_notable DESC" in sql
    assert "WHEN 'Out For Season' THEN 1" in sql
    # The Injuries cell is key players Out or Day To Day; only Out turns it red.
    schedule = str(LIST_SCHEDULE)
    assert "IN ('Out', 'Out For Season', 'Day To Day')" in schedule
    assert "AS has_key_injury" in schedule
    assert "AS key_players_out" in schedule
