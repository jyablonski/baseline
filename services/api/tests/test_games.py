from datetime import date

import pytest
from ids import (
    GAME_ONE,
    GAME_SCHEDULE,
    GAME_TWO,
    MISSING_ID,
    PLAYER_KAWHI,
    TEAM_GSW,
    TEAM_LAL,
    TEAM_NYK,
    TEAM_SAS,
)


@pytest.mark.unit
def test_list_games(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_ONE,
                        "season": "2024-25",
                        "season_type": "Regular Season",
                        "game_date": date(2024, 10, 22),
                        "arena": "Chase Center",
                        "arena_city": "San Francisco",
                        "arena_state": "CA",
                        "home_team_id": TEAM_GSW,
                        "home_team_abbreviation": "GSW",
                        "home_team_name": "Golden State Warriors",
                        "home_score": 120,
                        "away_team_id": TEAM_LAL,
                        "away_team_abbreviation": "LAL",
                        "away_team_name": "Los Angeles Lakers",
                        "away_score": 110,
                        "winning_team_id": TEAM_GSW,
                        "winner_location": "home",
                        "score_margin": 10,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/games", params={"season": "2024-25", "limit": 10})
    assert response.status_code == 200
    assert response.json()["data"][0]["game_id"] == GAME_ONE
    assert response.json()["data"][0]["arena_city"] == "San Francisco"


@pytest.mark.unit
def test_list_games_rejects_invalid_season_type(client) -> None:
    response = client.get("/api/v1/games", params={"season_type": "Summer League"})
    assert response.status_code == 400


@pytest.mark.unit
def test_list_games_accepts_regular_season_filter(client, session, query_result) -> None:
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get(
        "/api/v1/games",
        params={"season": "2025-26", "season_type": "Regular Season"},
    )
    assert response.status_code == 200
    assert response.json()["data"] == []


@pytest.mark.unit
def test_list_games_sql_fills_arena_from_home_team() -> None:
    from queries.games import LIST_GAMES

    sql = str(LIST_GAMES)
    assert "gold.dim_teams" in sql
    assert "coalesce" in sql.lower()
    assert "home_teams.city" in sql
    assert "fct_team_game_results.season_type = :season_type" in sql


@pytest.mark.unit
def test_get_game_play_by_play(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_TWO,
                        "action_number": 12,
                        "period": 1,
                        "clock": "PT11M32.00S",
                        "clock_remaining_seconds": 692,
                        "elapsed_seconds": 28,
                        "score_home": 2,
                        "score_away": 0,
                        "score_differential": 2,
                        "home_points": 2,
                        "away_points": 0,
                        "points_scored": 2,
                        "scoring_side": "home",
                        "team_id": TEAM_SAS,
                        "player_id": PLAYER_KAWHI,
                        "action_type": "Made Shot",
                        "sub_type": "2pt",
                        "description": "Wembanyama 2PT",
                    }
                )
            ]
        ),
    ]
    response = client.get(f"/api/v1/games/{GAME_TWO}/play-by-play")
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["score_differential"] == 2
    assert body["data"][0]["elapsed_seconds"] == 28


@pytest.mark.unit
def test_get_game_play_by_play_empty_when_ingested_game_has_none(
    client, session, query_result
) -> None:
    session.queue = [query_result(scalar=1), query_result([])]
    response = client.get(f"/api/v1/games/{GAME_ONE}/play-by-play")
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["total"] == 0


@pytest.mark.unit
def test_get_game_play_by_play_404(client, session, query_result) -> None:
    session.queue = [query_result(scalar=None)]
    response = client.get(f"/api/v1/games/{MISSING_ID}/play-by-play")
    assert response.status_code == 404
    assert response.json()["detail"] == "Game not found"


@pytest.mark.unit
def test_get_game_flow(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_TWO,
                        "season": "2025-26",
                        "game_date": date(2026, 6, 13),
                        "home_team_id": TEAM_SAS,
                        "home_team_abbreviation": "SAS",
                        "home_team_name": "San Antonio Spurs",
                        "home_score": 90,
                        "away_team_id": TEAM_NYK,
                        "away_team_abbreviation": "NYK",
                        "away_team_name": "New York Knicks",
                        "away_score": 94,
                        "winning_team_id": TEAM_NYK,
                        "winning_team_abbreviation": "NYK",
                        "winner_location": "away",
                        "scoring_play_count": 97,
                        "max_home_lead": 16,
                        "max_away_lead": 4,
                        "max_lead": 16,
                        "lead_changes": 13,
                        "ties": 5,
                        "home_lead_seconds": 2419,
                        "away_lead_seconds": 173,
                        "tied_seconds": 288,
                        "home_lead_pct": 0.84,
                        "away_lead_pct": 0.06,
                        "tied_pct": 0.10,
                        "game_elapsed_seconds": 2880,
                        "biggest_run_team_abbreviation": "NYK",
                        "biggest_run_winner_points": 16,
                        "biggest_run_opponent_points": 2,
                        "biggest_run_start_seconds": 2300,
                        "biggest_run_end_seconds": 2800,
                        "biggest_run_label": "NYK 16-2",
                    }
                )
            ]
        )
    ]
    response = client.get(f"/api/v1/games/{GAME_TWO}/flow")
    assert response.status_code == 200
    flow = response.json()["data"]
    assert flow["has_play_by_play"] is True
    assert flow["biggest_run_label"] == "NYK 16-2"
    assert flow["away_team_abbreviation"] == "NYK"


@pytest.mark.unit
def test_get_game_flow_empty_pbp(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_ONE,
                        "season": "2024-25",
                        "game_date": date(2024, 10, 22),
                        "home_team_id": TEAM_GSW,
                        "away_team_id": TEAM_LAL,
                        "winning_team_id": TEAM_GSW,
                        "winner_location": "home",
                        "scoring_play_count": None,
                        "biggest_run_label": None,
                    }
                )
            ]
        )
    ]
    response = client.get(f"/api/v1/games/{GAME_ONE}/flow")
    assert response.status_code == 200
    flow = response.json()["data"]
    assert flow["has_play_by_play"] is False
    assert flow["scoring_play_count"] is None


@pytest.mark.unit
def test_get_game_flow_404(client, session, query_result) -> None:
    session.queue = [query_result([])]
    response = client.get(f"/api/v1/games/{MISSING_ID}/flow")
    assert response.status_code == 404


@pytest.mark.unit
def test_flow_and_pbp_sql_use_gold_marts() -> None:
    from queries.games import GET_GAME_FLOW, LIST_PLAY_BY_PLAY

    assert "gold.fct_game_flow" in str(GET_GAME_FLOW)
    assert "gold.fct_play_by_play_scoring" in str(LIST_PLAY_BY_PLAY)
    assert "gold.fct_team_game_results" in str(GET_GAME_FLOW)
    assert "gold.dim_teams" in str(GET_GAME_FLOW)
    assert "primary_color" in str(GET_GAME_FLOW)


@pytest.mark.unit
def test_list_schedule(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_SCHEDULE,
                        "season": "2026-27",
                        "season_type": "Regular Season",
                        "game_date": date(2026, 10, 22),
                        "status": "Scheduled",
                        "arena": "Chase Center",
                        "arena_city": "San Francisco",
                        "arena_state": "CA",
                        "home_team_id": TEAM_GSW,
                        "home_team_abbreviation": "GSW",
                        "home_team_name": "Golden State Warriors",
                        "away_team_id": TEAM_LAL,
                        "away_team_abbreviation": "LAL",
                        "away_team_name": "Los Angeles Lakers",
                    }
                )
            ]
        ),
    ]
    response = client.get(
        "/api/v1/schedule",
        params={"season": "2026-27", "status": "Scheduled", "from_date": "2026-09-05"},
    )
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["game_id"] == GAME_SCHEDULE
    assert row["status"] == "Scheduled"
    assert row["away_team_abbreviation"] == "LAL"
    assert row["home_team_abbreviation"] == "GSW"
    assert "score_margin" not in row
    assert "home_score" not in row


@pytest.mark.unit
def test_list_schedule_empty(client, session, query_result) -> None:
    session.queue = [query_result(scalar=0), query_result([])]
    response = client.get("/api/v1/schedule", params={"season": "2024-25"})
    assert response.status_code == 200
    assert response.json()["data"] == []
    assert response.json()["meta"]["total"] == 0


@pytest.mark.unit
def test_list_schedule_sql_filters_upcoming() -> None:
    from queries.games import LIST_SCHEDULE, LIST_SCHEDULE_COUNT, LIST_SEASONS

    sql = str(LIST_SCHEDULE)
    assert "gold.fct_games_schedule" in sql
    assert "fct_games_schedule.game_date >= :from_date" in sql
    assert "gold.fct_team_game_results" not in sql
    assert "gold.fct_games_schedule" in str(LIST_SCHEDULE_COUNT)
    assert "gold.fct_games_schedule" in str(LIST_SEASONS)


@pytest.mark.unit
def test_list_seasons(client, session, query_result) -> None:
    session.queue = [query_result(rows=[("2024-25",), ("2023-24",)])]
    response = client.get("/api/v1/seasons")
    assert response.status_code == 200
    assert response.json()["data"] == ["2024-25", "2023-24"]
    assert response.json()["meta"]["total"] == 2


@pytest.mark.unit
def test_list_biggest_collapses(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_TWO,
                        "season": "2025-26",
                        "game_date": date(2026, 6, 10),
                        "home_team_abbreviation": "NYK",
                        "home_score": 107,
                        "away_team_abbreviation": "SAS",
                        "away_score": 106,
                        "largest_lead_blown": 29,
                        "blown_lead_team_abbreviation": "SAS",
                        "comeback_team_abbreviation": "NYK",
                        "blown_lead_period": 2,
                        "winner_margin_entering_fourth": -15,
                        "lead_changes": 3,
                        "overtime_periods": 0,
                    }
                )
            ]
        )
    ]
    response = client.get("/api/v1/games/collapses?limit=5")
    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["total"] == 1
    collapse = payload["data"][0]
    assert collapse["largest_lead_blown"] == 29
    assert collapse["blown_lead_team_abbreviation"] == "SAS"
    assert collapse["comeback_team_abbreviation"] == "NYK"
    assert collapse["winner_margin_entering_fourth"] == -15


@pytest.mark.unit
def test_list_biggest_collapses_filters_by_blown_lead_team(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/games/collapses?blown_lead_team=sas")
    assert response.status_code == 200
    assert response.json()["data"] == []
    # Lowercase in, uppercase bound: gold stores abbreviations uppercased.
    _, params = session.calls[-1]
    assert params["blown_lead_team"] == "SAS"


@pytest.mark.unit
def test_list_biggest_collapses_without_team_binds_null(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/games/collapses")
    assert response.status_code == 200
    _, params = session.calls[-1]
    assert params["blown_lead_team"] is None


@pytest.mark.unit
def test_biggest_collapses_query_excludes_wire_to_wire() -> None:
    from queries.games import LIST_BIGGEST_COLLAPSES

    sql = str(LIST_BIGGEST_COLLAPSES)
    assert "gold.fct_game_flow" in sql
    assert "largest_lead_blown > 0" in sql
    assert (
        ":blown_lead_team IS NULL OR fct_game_flow.blown_lead_team_abbreviation = :blown_lead_team"
        in sql
    )


BOX_SCORE_ROW = {
    "player_id": PLAYER_KAWHI,
    "player_name": "Kawhi Leonard",
    "team_id": TEAM_LAL,
    "team_abbreviation": "LAL",
    "team_name": "Los Angeles Lakers",
    "location": "home",
    "minutes": 36.0,
    "points": 28,
    "rebounds": 8,
    "assists": 5,
    "field_goals_made": 10,
    "field_goals_attempted": 21,
    "field_goal_pct": 0.476,
    "three_pointers_made": 2,
    "three_pointers_attempted": 6,
    "three_point_pct": 0.333,
    "free_throws_made": 6,
    "free_throws_attempted": 8,
    "free_throw_pct": 0.75,
    "true_shooting_pct": 0.571,
    "plus_minus": -7,
    "mvp_game_score": 18.6,
}


@pytest.mark.unit
def test_game_box_score(client, session, mapping_row, query_result) -> None:
    session.queue = [query_result(scalar=1), query_result([mapping_row(BOX_SCORE_ROW)])]
    response = client.get(f"/api/v1/games/{GAME_ONE}/box-score")
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["player_name"] == "Kawhi Leonard"
    assert row["field_goals_attempted"] == 21
    assert row["true_shooting_pct"] == 0.571
    assert row["plus_minus"] == -7
    assert row["mvp_game_score"] == 18.6


@pytest.mark.unit
def test_game_box_score_missing_game(client, session, query_result) -> None:
    session.queue = [query_result(scalar=None)]
    assert client.get(f"/api/v1/games/{MISSING_ID}/box-score").status_code == 404


@pytest.mark.unit
def test_box_score_sql_derives_true_shooting_and_orders_home_first() -> None:
    from queries.games import LIST_BOX_SCORE

    sql = str(LIST_BOX_SCORE)
    # 0.44 is the free-throw-to-possession constant; a plain fga denominator
    # would overstate anyone who gets to the line.
    assert "0.44 * fct_player_game_logs.free_throws_attempted" in sql
    assert "CASE WHEN fct_player_game_logs.location = 'home' THEN 0 ELSE 1 END" in sql
    assert "fct_player_game_logs.minutes DESC NULLS LAST" in sql


@pytest.mark.unit
def test_box_score_sql_drops_players_who_never_checked_in() -> None:
    """A DNP is recorded as a null minute count on some rows and a literal 0 on
    others, so excluding only nulls would still leave blank lines in the table."""
    from queries.games import LIST_BOX_SCORE

    sql = str(LIST_BOX_SCORE)
    assert "fct_player_game_logs.minutes IS NOT NULL" in sql
    assert "fct_player_game_logs.minutes > 0" in sql
