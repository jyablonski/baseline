from datetime import date

import pytest
from ids import TEAM_BOS, TEAM_CHI, TEAM_GSW, TEAM_LAC


def _standing_row(**overrides) -> dict:
    row = {
        "team_id": TEAM_GSW,
        "abbreviation": "GSW",
        "team_name": "Golden State Warriors",
        "season": "2024-25",
        "season_type": "Regular Season",
        "as_of_date": date(2025, 4, 13),
        "conference": "West",
        "division": "Pacific",
        "conference_rank": 1,
        "division_rank": 1,
        "wins": 50,
        "losses": 32,
        "win_pct": 0.61,
        "games_back": 0.0,
        "streak": "W5",
        "last_10": "8-2",
    }
    row.update(overrides)
    return row


@pytest.mark.unit
def test_list_standings(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=2),
        query_result(
            [
                mapping_row(_standing_row()),
                mapping_row(
                    _standing_row(
                        team_id=TEAM_LAC,
                        abbreviation="LAC",
                        team_name="LA Clippers",
                        conference_rank=2,
                        division_rank=2,
                        wins=48,
                        losses=33,
                        win_pct=0.593,
                        games_back=1.5,
                        streak="L1",
                        last_10="6-4",
                    )
                ),
            ]
        ),
    ]
    response = client.get("/api/v1/standings", params={"season": "2024-25"})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 2
    assert body["data"][0]["abbreviation"] == "GSW"
    assert body["data"][0]["conference_rank"] == 1
    assert body["data"][1]["games_back"] == 1.5


@pytest.mark.unit
def test_list_standings_conference_case_insensitive(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    _standing_row(
                        team_id=TEAM_CHI,
                        abbreviation="CHI",
                        team_name="Chicago Bulls",
                        conference="East",
                        division="Central",
                        conference_rank=5,
                        games_back=4,
                    )
                )
            ]
        ),
    ]
    response = client.get("/api/v1/standings", params={"conference": "east"})
    assert response.status_code == 200
    assert response.json()["data"][0]["conference"] == "East"


@pytest.mark.unit
def test_list_standings_rejects_invalid_conference(client) -> None:
    response = client.get("/api/v1/standings", params={"conference": "Midwest"})
    assert response.status_code == 400
    assert "East" in response.json()["detail"]


@pytest.mark.unit
def test_list_standings_sql_reads_fct_standings_only() -> None:
    from queries.standings import LIST_STANDINGS, LIST_STANDINGS_COUNT, TEAM_STANDING

    sql = str(LIST_STANDINGS)
    assert "FROM gold.fct_standings" in sql
    assert "fct_standings.record_source" in sql
    # Ranks, games back and form are derived in dbt, never recomputed here.
    assert "gold.fct_team_game_results" not in sql
    assert "OVER (" not in sql
    # Ordering follows the settled play-in bracket, falling back to record rank.
    assert "coalesce(fct_standings.playoff_seed, fct_standings.conference_rank)" in sql
    assert "FROM gold.fct_standings" in str(LIST_STANDINGS_COUNT)
    assert "fct_standings.team_id = :team_id" in str(TEAM_STANDING)


@pytest.mark.unit
def test_list_standings_passes_derived_rows_through(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    _standing_row(
                        team_id=TEAM_BOS,
                        abbreviation="BOS",
                        team_name="Boston Celtics",
                        season="2025-26",
                        as_of_date=None,
                        conference="East",
                        division="Atlantic",
                        conference_rank=1,
                        division_rank=None,
                        wins=56,
                        losses=26,
                        win_pct=0.683,
                        games_back=0.0,
                        streak="W2",
                        last_10="7-3",
                        record_source="games",
                    )
                )
            ]
        ),
    ]
    response = client.get("/api/v1/standings", params={"season": "2025-26"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["abbreviation"] == "BOS"
    assert row["wins"] == 56
    assert row["conference_rank"] == 1
    assert row["games_back"] == 0
    assert row["streak"] == "W2"
    assert row["record_source"] == "games"
