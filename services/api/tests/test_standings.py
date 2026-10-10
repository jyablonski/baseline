from datetime import date

import pytest
from ids import TEAM_BOS, TEAM_CHI, TEAM_DET, TEAM_GSW, TEAM_LAC, TEAM_NYK, TEAM_OKC


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
        "conf_games_back": 0.0,
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
                        conf_games_back=1.5,
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
def test_list_standings_sql_overlays_regular_season_records() -> None:
    from queries.standings import LIST_STANDINGS, LIST_STANDINGS_COUNT

    sql = str(LIST_STANDINGS)
    assert "gold.dim_teams" in sql
    assert "gold.fct_team_game_results" in sql
    assert "season_type = 'Regular Season'" in sql
    assert "record_source" in sql
    assert "rank() OVER" in sql
    assert "first_value(" in sql
    assert "streak_group" in sql
    assert "lag(" in sql
    assert "form.last_10" in sql
    # Ordering follows the settled play-in bracket, falling back to record rank.
    assert "coalesce(fct_standings.playoff_seed," in sql
    assert "playoff_seed" in sql
    assert "gold.dim_teams" in str(LIST_STANDINGS_COUNT)


@pytest.mark.unit
def test_list_standings_game_record_overlay(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "team_id": TEAM_BOS,
                        "abbreviation": "BOS",
                        "team_name": "Boston Celtics",
                        "season": "2025-26",
                        "season_type": "Regular Season",
                        "as_of_date": None,
                        "conference": "East",
                        "division": "Atlantic",
                        "conference_rank": None,
                        "division_rank": None,
                        "wins": 56,
                        "losses": 26,
                        "win_pct": 0.683,
                        "games_back": None,
                        "conf_games_back": None,
                        "streak": None,
                        "last_10": None,
                        "record_source": "games",
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/standings", params={"season": "2025-26"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["abbreviation"] == "BOS"
    assert row["wins"] == 56
    assert row["losses"] == 26
    assert row["conference_rank"] == 1
    assert row["games_back"] == 0
    assert row["streak"] is None
    assert row["record_source"] == "games"


@pytest.mark.unit
def test_apply_derived_ranks_orders_by_record() -> None:
    from baseline_analytics.standings_rank import apply_derived_ranks

    rows = apply_derived_ranks(
        [
            {
                "team_id": TEAM_DET,
                "abbreviation": "DET",
                "team_name": "Detroit Pistons",
                "conference": "East",
                "wins": 59,
                "losses": 22,
                "win_pct": 0.728,
                "conference_rank": None,
                "games_back": None,
                "record_source": "games",
            },
            {
                "team_id": TEAM_NYK,
                "abbreviation": "NYK",
                "team_name": "New York Knicks",
                "conference": "East",
                "wins": 50,
                "losses": 32,
                "win_pct": 0.61,
                "conference_rank": None,
                "games_back": None,
                "record_source": "games",
            },
            {
                "team_id": TEAM_OKC,
                "abbreviation": "OKC",
                "team_name": "Oklahoma City Thunder",
                "conference": "West",
                "wins": 64,
                "losses": 17,
                "win_pct": 0.79,
                "conference_rank": None,
                "games_back": None,
                "record_source": "games",
            },
        ]
    )
    east = [row for row in rows if row["conference"] == "East"]
    west = [row for row in rows if row["conference"] == "West"]
    assert east[0]["abbreviation"] == "DET"
    assert east[0]["conference_rank"] == 1
    assert east[0]["games_back"] == 0
    assert east[1]["abbreviation"] == "NYK"
    assert east[1]["conference_rank"] == 2
    assert east[1]["games_back"] == 9.5
    assert west[0]["conference_rank"] == 1
    assert west[0]["games_back"] == 0


@pytest.mark.unit
def test_apply_derived_ranks_empty() -> None:
    from baseline_analytics.standings_rank import apply_derived_ranks

    assert apply_derived_ranks([]) == []


@pytest.mark.unit
def test_apply_derived_ranks_keeps_official_values() -> None:
    from baseline_analytics.standings_rank import apply_derived_ranks

    rows = apply_derived_ranks(
        [
            {
                "team_id": TEAM_BOS,
                "team_name": "Boston Celtics",
                "conference": "East",
                "wins": 50,
                "losses": 32,
                "win_pct": 0.61,
                "conference_rank": 5,
                "games_back": 12.0,
                "record_source": "official",
            }
        ]
    )
    assert rows[0]["conference_rank"] == 5
    assert rows[0]["games_back"] == 12.0
