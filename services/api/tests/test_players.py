from datetime import date

import pytest
from ids import (
    GAME_ONE,
    GAME_TWO,
    MISSING_ID,
    PLAYER_CURRY,
    PLAYER_KAWHI,
    PLAYER_LEBRON,
    TEAM_GSW,
)


@pytest.mark.unit
def test_list_players(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_KAWHI,
                        "full_name": "Kawhi Leonard",
                        "position": "F",
                        "team_abbreviation": "LAC",
                        "is_active": True,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/players", params={"search": "kawhi", "active": True})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["full_name"] == "Kawhi Leonard"
    assert body["data"][0]["career_games_played"] == 0


@pytest.mark.unit
def test_get_player_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/players/{MISSING_ID}")
    assert response.status_code == 404
    assert response.json()["detail"] == "Player not found"


@pytest.mark.unit
def test_get_player_detail(client, session, query_result) -> None:
    session.queue = [
        query_result(
            [
                {
                    "player_id": PLAYER_LEBRON,
                    "full_name": "LeBron James",
                    "position": "F",
                    "team_abbreviation": "LAL",
                    "is_active": True,
                    "first_name": "LeBron",
                    "last_name": "James",
                    "height": "6-9",
                    "weight": 250,
                    "birth_date": date(1984, 12, 30),
                    "career_games_played": 1500,
                    "seasons_played": 22,
                    "career_ppg": 27.1,
                    "career_rpg": 7.5,
                    "career_apg": 7.4,
                }
            ]
        )
    ]
    response = client.get(f"/api/v1/players/{PLAYER_LEBRON}")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["full_name"] == "LeBron James"
    assert body["current_season_salary"] is None
    assert body["current_remaining_guaranteed"] is None
    assert body["current_contract_season"] is None


@pytest.mark.unit
def test_get_player_includes_salary_snapshot(client, session, query_result) -> None:
    session.queue = [
        query_result(
            [
                {
                    "player_id": PLAYER_CURRY,
                    "full_name": "Stephen Curry",
                    "position": "G",
                    "team_abbreviation": "GSW",
                    "is_active": True,
                    "first_name": "Stephen",
                    "last_name": "Curry",
                    "height": "6-2",
                    "weight": 185,
                    "birth_date": date(1988, 3, 14),
                    "career_games_played": 1000,
                    "seasons_played": 16,
                    "career_ppg": 24.6,
                    "career_rpg": 4.7,
                    "career_apg": 6.4,
                    "current_season_salary": 50_000_000,
                    "current_remaining_guaranteed": 101_000_000,
                    "current_contract_season": "2024-25",
                }
            ]
        )
    ]
    response = client.get(f"/api/v1/players/{PLAYER_CURRY}")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["current_season_salary"] == 50_000_000
    assert body["current_remaining_guaranteed"] == 101_000_000
    assert body["current_contract_season"] == "2024-25"


@pytest.mark.unit
def test_compare_requires_two_ids(client) -> None:
    response = client.get("/api/v1/players/compare", params={"ids": PLAYER_LEBRON})
    assert response.status_code == 400


@pytest.mark.unit
def test_compare_rejects_bad_ids(client) -> None:
    response = client.get("/api/v1/players/compare", params={"ids": "a,b"})
    assert response.status_code == 400


@pytest.mark.unit
def test_compare_rejects_unknown_stat(client) -> None:
    response = client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}", "stat": "blocks"},
    )
    assert response.status_code == 400


@pytest.mark.unit
def test_compare_players(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_LEBRON,
                        "full_name": "LeBron James",
                        "career_games_played": 1500,
                        "career_ppg": 27.1,
                        "career_rpg": 7.5,
                        "career_apg": 7.4,
                        "career_avg_plus_minus": 6.2,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "career_games_played": 1000,
                        "career_ppg": 24.6,
                        "career_rpg": 4.7,
                        "career_apg": 6.4,
                        "career_avg_plus_minus": 5.1,
                    }
                ),
            ]
        )
    ]
    response = client.get(
        "/api/v1/players/compare", params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}"}
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body) == 2
    assert body[0]["career_avg_plus_minus"] == 6.2
    assert body[1]["career_avg_plus_minus"] == 5.1


@pytest.mark.unit
def test_compare_accepts_plus_minus_stat(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_LEBRON,
                        "full_name": "LeBron James",
                        "career_games_played": 1500,
                        "career_ppg": 27.1,
                        "career_rpg": 7.5,
                        "career_apg": 7.4,
                        "career_avg_plus_minus": None,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "career_games_played": 1000,
                        "career_ppg": 24.6,
                        "career_rpg": 4.7,
                        "career_apg": 6.4,
                        "career_avg_plus_minus": 5.1,
                    }
                ),
            ]
        )
    ]
    response = client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}", "stat": "plus_minus"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body[0]["career_avg_plus_minus"] is None
    assert body[1]["career_avg_plus_minus"] == 5.1


@pytest.mark.unit
def test_compare_sql_averages_box_plus_minus() -> None:
    from queries.players import compare_players_stmt

    sql = str(compare_players_stmt("career_avg_plus_minus"))
    assert "avg(plus_minus)" in sql
    assert "career_avg_plus_minus" in sql
    assert "fct_player_game_logs" in sql

    with pytest.raises(ValueError, match="Unsupported compare order column"):
        compare_players_stmt("blocks")


@pytest.mark.unit
def test_head_to_head_requires_exactly_two_ids(client) -> None:
    response = client.get("/api/v1/players/compare/head-to-head", params={"ids": PLAYER_LEBRON})
    assert response.status_code == 400


@pytest.mark.unit
def test_head_to_head_rejects_duplicate_ids(client) -> None:
    response = client.get(
        "/api/v1/players/compare/head-to-head",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_LEBRON}"},
    )
    assert response.status_code == 400


@pytest.mark.unit
def test_head_to_head_rejects_bad_ids(client) -> None:
    response = client.get("/api/v1/players/compare/head-to-head", params={"ids": "a,b"})
    assert response.status_code == 400


@pytest.mark.unit
def test_head_to_head_missing_player(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row({"player_id": PLAYER_LEBRON, "full_name": "LeBron James"}),
            ]
        )
    ]
    response = client.get(
        "/api/v1/players/compare/head-to-head",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}"},
    )
    assert response.status_code == 404


@pytest.mark.unit
def test_head_to_head_empty_meetings(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row({"player_id": PLAYER_LEBRON, "full_name": "LeBron James"}),
                mapping_row({"player_id": PLAYER_CURRY, "full_name": "Stephen Curry"}),
            ]
        ),
        query_result([]),
    ]
    response = client.get(
        "/api/v1/players/compare/head-to-head",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["games_played"] == 0
    assert body["games"] == []
    assert body["players"][0]["full_name"] == "LeBron James"
    assert body["players"][0]["games"] == 0
    assert body["players"][0]["ppg"] is None
    assert body["players"][0]["plus_minus"] is None


@pytest.mark.unit
def test_head_to_head_averages_and_logs(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row({"player_id": PLAYER_CURRY, "full_name": "Stephen Curry"}),
                mapping_row({"player_id": PLAYER_KAWHI, "full_name": "Kawhi Leonard"}),
            ]
        ),
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "game_id": GAME_TWO,
                        "game_date": date(2024, 10, 25),
                        "season": "2024-25",
                        "matchup": "GSW @ LAC",
                        "team_abbreviation": "GSW",
                        "opponent_abbreviation": "LAC",
                        "location": "away",
                        "result": "L",
                        "minutes": 37.0,
                        "points": 29,
                        "rebounds": 5,
                        "assists": 7,
                        "steals": 2,
                        "blocks": 0,
                        "turnovers": 2,
                        "plus_minus": -3,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_KAWHI,
                        "full_name": "Kawhi Leonard",
                        "game_id": GAME_TWO,
                        "game_date": date(2024, 10, 25),
                        "season": "2024-25",
                        "matchup": "LAC vs. GSW",
                        "team_abbreviation": "LAC",
                        "opponent_abbreviation": "GSW",
                        "location": "home",
                        "result": "W",
                        "minutes": 38.0,
                        "points": 30,
                        "rebounds": 9,
                        "assists": 6,
                        "steals": 2,
                        "blocks": 0,
                        "turnovers": 3,
                        "plus_minus": 4,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "game_id": GAME_ONE,
                        "game_date": date(2024, 10, 22),
                        "season": "2024-25",
                        "matchup": "GSW vs. LAC",
                        "team_abbreviation": "GSW",
                        "opponent_abbreviation": "LAC",
                        "location": "home",
                        "result": "W",
                        "minutes": 35.0,
                        "points": 32,
                        "rebounds": 4,
                        "assists": 8,
                        "steals": 1,
                        "blocks": 0,
                        "turnovers": 3,
                        "plus_minus": 10,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_KAWHI,
                        "full_name": "Kawhi Leonard",
                        "game_id": GAME_ONE,
                        "game_date": date(2024, 10, 22),
                        "season": "2024-25",
                        "matchup": "LAC @ GSW",
                        "team_abbreviation": "LAC",
                        "opponent_abbreviation": "GSW",
                        "location": "away",
                        "result": "L",
                        "minutes": 36.0,
                        "points": 28,
                        "rebounds": 8,
                        "assists": 5,
                        "steals": 2,
                        "blocks": 1,
                        "turnovers": 2,
                        "plus_minus": -8,
                    }
                ),
            ]
        ),
    ]
    response = client.get(
        "/api/v1/players/compare/head-to-head",
        params={"ids": f"{PLAYER_CURRY},{PLAYER_KAWHI}"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["games_played"] == 2
    curry, kawhi = body["players"]
    assert curry["full_name"] == "Stephen Curry"
    assert curry["games"] == 2
    assert curry["ppg"] == 30.5
    assert curry["rpg"] == 4.5
    assert curry["apg"] == 7.5
    assert curry["mpg"] == 36.0
    assert curry["plus_minus"] == 3.5
    assert kawhi["ppg"] == 29.0
    assert kawhi["plus_minus"] == -2.0
    assert body["games"][0]["lines"][0]["plus_minus"] == -3
    assert body["games"][0]["game_id"] == GAME_TWO
    assert [line["player_id"] for line in body["games"][0]["lines"]] == [PLAYER_CURRY, PLAYER_KAWHI]


@pytest.mark.unit
def test_head_to_head_sql_requires_opposite_teams() -> None:
    from queries.players import HEAD_TO_HEAD_LOGS

    assert "team_id IS DISTINCT FROM" in str(HEAD_TO_HEAD_LOGS)


@pytest.mark.unit
def test_compare_missing_player(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_LEBRON,
                        "full_name": "LeBron James",
                        "career_games_played": 1500,
                        "career_ppg": 27.1,
                        "career_rpg": 7.5,
                        "career_apg": 7.4,
                    }
                )
            ]
        )
    ]
    response = client.get(
        "/api/v1/players/compare", params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}"}
    )
    assert response.status_code == 404


@pytest.mark.unit
def test_game_log_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/players/{MISSING_ID}/game-log")
    assert response.status_code == 404


@pytest.mark.unit
def test_game_log(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(rows=[1]),
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_ONE,
                        "game_date": date(2024, 10, 22),
                        "season": "2024-25",
                        "opponent_abbreviation": "GSW",
                        "location": "home",
                        "result": "W",
                        "minutes": 36.5,
                        "points": 28,
                        "rebounds": 8,
                        "assists": 6,
                        "steals": 2,
                        "blocks": 1,
                        "turnovers": 3,
                        "plus_minus": 8,
                        "season_type": "Regular Season",
                        "mvp_game_score": 30.5,
                        "is_back_to_back": False,
                    }
                )
            ]
        ),
    ]
    response = client.get(f"/api/v1/players/{PLAYER_KAWHI}/game-log", params={"season": "2024-25"})
    assert response.status_code == 200
    assert response.json()["data"][0]["points"] == 28
    assert response.json()["data"][0]["game_id"] == str(GAME_ONE)
    assert response.json()["data"][0]["season"] == "2024-25"
    assert response.json()["data"][0]["steals"] == 2
    assert response.json()["data"][0]["plus_minus"] == 8
    assert response.json()["data"][0]["mvp_game_score"] == 30.5
    assert response.json()["data"][0]["season_type"] == "Regular Season"


@pytest.mark.unit
def test_back_to_backs_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/players/{MISSING_ID}/back-to-backs")
    assert response.status_code == 404


@pytest.mark.unit
def test_back_to_backs(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[{"player_id": PLAYER_KAWHI, "full_name": "Kawhi Leonard"}]),
        query_result(
            rows=[
                {
                    "total_back_to_backs": 12,
                    "games_played_in_b2b": 10,
                    "games_sat_in_b2b": 2,
                    "avg_pts_b2b": 24.1,
                    "avg_pts_non_b2b": 26.4,
                }
            ]
        ),
    ]
    response = client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/back-to-backs", params={"season": "2024-25"}
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total_back_to_backs"] == 12
    assert body["games_sat_in_b2b"] == 2
    assert body["avg_pts_b2b"] == 24.1


@pytest.mark.unit
def test_list_players_team_filter(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "position": "G",
                        "team_abbreviation": "GSW",
                        "is_active": True,
                        "career_games_played": 1000,
                        "career_ppg": 24.6,
                        "career_rpg": 4.7,
                        "career_apg": 6.4,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/players", params={"team_id": TEAM_GSW})
    assert response.status_code == 200
    assert response.json()["data"][0]["career_ppg"] == 24.6


@pytest.mark.unit
def test_game_log_rejects_bad_sort(client, session, query_result) -> None:
    session.queue = [query_result(rows=[1])]
    response = client.get(f"/api/v1/players/{PLAYER_KAWHI}/game-log", params={"sort": "fg_pct"})
    assert response.status_code == 400


@pytest.mark.unit
def test_game_log_rejects_bad_order(client, session, query_result) -> None:
    session.queue = [query_result(rows=[1])]
    response = client.get(f"/api/v1/players/{PLAYER_KAWHI}/game-log", params={"order": "sideways"})
    assert response.status_code == 400


@pytest.mark.unit
def test_game_log_b2b_filter(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(rows=[1]),
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_date": date(2024, 10, 23),
                        "opponent_abbreviation": "CHI",
                        "location": "away",
                        "result": "W",
                        "minutes": 34.0,
                        "points": 24,
                        "rebounds": 7,
                        "assists": 4,
                        "is_back_to_back": True,
                    }
                )
            ]
        ),
    ]
    response = client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/game-log",
        params={"is_back_to_back": True, "sort": "points", "order": "asc"},
    )
    assert response.status_code == 200
    assert response.json()["data"][0]["is_back_to_back"] is True


@pytest.mark.unit
def test_season_stats_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/players/{MISSING_ID}/season-stats")
    assert response.status_code == 404


@pytest.mark.unit
def test_season_stats(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(rows=[1]),
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_KAWHI,
                        "season": "2024-25",
                        "games_played": 3,
                        "ppg": 27.3,
                        "rpg": 8.0,
                        "apg": 5.0,
                    }
                )
            ]
        ),
    ]
    response = client.get(f"/api/v1/players/{PLAYER_KAWHI}/season-stats")
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["season"] == "2024-25"
    assert row["ppg"] == 27.3


@pytest.mark.unit
def test_list_players_mvp_sort_binds_season(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_KAWHI,
                        "full_name": "Kawhi Leonard",
                        "position": "F",
                        "team_abbreviation": "LAC",
                        "is_active": True,
                        "mvp_season": "2024-25",
                        "mvp_score": 25.5,
                        "mvp_rank": 1,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/players", params={"sort": "mvp", "season": "2024-25"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["mvp_season"] == "2024-25"
    assert row["mvp_score"] == 25.5
    assert row["mvp_rank"] == 1
    stmt, params = session.calls[1]
    assert params["season"] == "2024-25"
    assert "regular_season_mvp.mvp_rank NULLS LAST" in str(stmt)


@pytest.mark.unit
def test_list_players_rejects_bad_sort(client, session) -> None:
    response = client.get("/api/v1/players", params={"sort": "ppg"})
    assert response.status_code == 400
    assert session.calls == []


@pytest.mark.unit
def test_player_sql_reads_one_mvp_ladder_per_season_type() -> None:
    from queries.players import PLAYER_BY_ID, compare_players_stmt, list_players_stmt

    for sql in (str(list_players_stmt("name")), str(PLAYER_BY_ID)):
        assert "fct_player_mvp_scores" in sql
        assert "season_type = 'Regular Season'" in sql
        assert "season_type = 'Playoffs'" not in sql
    assert "season_type = 'Playoffs'" in str(compare_players_stmt("mvp_score"))

    with pytest.raises(ValueError, match="Unsupported player sort"):
        list_players_stmt("ppg")


@pytest.mark.unit
def test_compare_accepts_mvp_stat(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "player_id": PLAYER_LEBRON,
                        "full_name": "LeBron James",
                        "career_games_played": 1500,
                        "mvp_season": "2024-25",
                        "mvp_score": 24.1,
                        "mvp_rank": 4,
                        "playoff_mvp_score": 27.9,
                        "playoff_mvp_rank": 3,
                    }
                ),
                mapping_row(
                    {
                        "player_id": PLAYER_CURRY,
                        "full_name": "Stephen Curry",
                        "career_games_played": 1000,
                        "mvp_season": "2024-25",
                        "mvp_score": 20.4,
                        "mvp_rank": 11,
                    }
                ),
            ]
        )
    ]
    response = client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_LEBRON},{PLAYER_CURRY}", "stat": "mvp", "season": "2024-25"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body[0]["playoff_mvp_rank"] == 3
    assert body[1]["playoff_mvp_score"] is None
    stmt, params = session.calls[0]
    assert params["season"] == "2024-25"
    assert "regular_season_mvp.mvp_score DESC NULLS LAST" in str(stmt)
