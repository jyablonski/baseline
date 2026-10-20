from datetime import date

import pytest
from ids import (
    GAME_ONE,
    GAME_TWO,
    MISSING_ID,
    TEAM_BOS,
    TEAM_CHI,
    TEAM_GSW,
    TEAM_MIN,
)


def _team_row() -> dict:
    return {
        "team_id": TEAM_GSW,
        "abbreviation": "GSW",
        "team_name": "Golden State Warriors",
        "conference": "West",
        "division": "Pacific",
        "city": "San Francisco",
        "nickname": "Warriors",
        "arena_name": "Chase Center",
        "arena_latitude": 37.76806,
        "arena_longitude": -122.38750,
        "current_season_payroll": None,
        "current_remaining_guaranteed": None,
        "current_contract_season": None,
    }


def _standing_row() -> dict:
    return {
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
        "games_back": 0,
        "streak": "W5",
        "last_10": "8-2",
    }


@pytest.mark.unit
def test_list_teams(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "team_id": TEAM_GSW,
                        "abbreviation": "GSW",
                        "team_name": "Golden State Warriors",
                        "conference": "West",
                        "division": "Pacific",
                        "city": "San Francisco",
                        "nickname": "Warriors",
                        "wins": 50,
                        "losses": 32,
                        "win_pct": 0.61,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/teams", params={"season": "2024-25"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["abbreviation"] == "GSW"
    assert row["nickname"] == "Warriors"
    assert row["wins"] == 50


@pytest.mark.unit
def test_find_by_abbreviation(session, mapping_row, query_result) -> None:
    from repositories.teams import TeamsRepository

    session.queue = [query_result(rows=[_team_row()])]
    repo = TeamsRepository(session)
    found = repo.find_by_abbreviation("GSW")
    assert found is not None
    assert found["abbreviation"] == "GSW"
    session.queue = [query_result(rows=[])]
    assert repo.find_by_abbreviation("XXX") is None


@pytest.mark.unit
def test_list_teams_with_season_records(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "team_id": TEAM_GSW,
                        "abbreviation": "GSW",
                        "team_name": "Golden State Warriors",
                        "conference": "West",
                        "division": "Pacific",
                        "city": "San Francisco",
                        "nickname": "Warriors",
                        "wins": 50,
                        "losses": 32,
                        "win_pct": 0.61,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/teams", params={"season": "2024-25"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["nickname"] == "Warriors"
    assert row["wins"] == 50
    assert row["win_pct"] == 0.61


@pytest.mark.unit
def test_get_team_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/teams/{MISSING_ID}")
    assert response.status_code == 404


@pytest.mark.unit
def test_get_team_with_season_record(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar="2024-25"),
        query_result(rows=[{"season_type": "Regular Season", "games": 82, "wins": 50}]),
        query_result(rows=[]),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    body = response.json()["data"]
    record = body["season_record"]
    assert record["wins"] == 50
    assert record["losses"] == 32
    assert record["win_pct"] == 0.61
    assert record["games"] == 82
    assert record["filters_applied"]["season_type"] == "Regular Season"
    assert body["record_season"] == "2024-25"
    assert body["play_in_record"] is None
    assert body["playoff_record"] is None
    assert body["standing"] is None
    assert body["current_season_payroll"] is None


@pytest.mark.unit
def test_get_team_attaches_standing(client, session, query_result) -> None:
    session.queue = [
        query_result(
            rows=[
                _team_row()
                | {
                    "current_season_payroll": 51_000_000,
                    "luxury_tax": 170_814_000,
                    "over_luxury_tax": False,
                }
            ]
        ),
        query_result(scalar="2024-25"),
        query_result(rows=[{"season_type": "Regular Season", "games": 82, "wins": 50}]),
        query_result(rows=[_standing_row()]),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["current_season_payroll"] == 51_000_000
    assert body["luxury_tax"] == 170_814_000
    assert body["over_luxury_tax"] is False
    assert body["standing"]["conference_rank"] == 1
    assert body["standing"]["conference"] == "West"
    assert body["standing"]["games_back"] == 0
    assert body["season_record"]["games"] == 82
    assert body["season_record"]["wins"] == 50


@pytest.mark.unit
def test_get_team_without_games(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar=None),
        query_result(rows=[]),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["season_record"] is None
    assert body["arena_name"] == "Chase Center"
    assert body["arena_latitude"] == 37.76806
    assert body["arena_longitude"] == -122.3875


@pytest.mark.unit
def test_get_team_splits_regular_season_play_in_playoffs(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar="2025-26"),
        query_result(
            rows=[
                {"season_type": "Regular Season", "games": 82, "wins": 48},
                {"season_type": "PlayIn", "games": 1, "wins": 1},
                {"season_type": "Playoffs", "games": 6, "wins": 2},
            ]
        ),
        query_result(rows=[]),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["record_season"] == "2025-26"
    assert body["season_record"]["wins"] == 48
    assert body["season_record"]["losses"] == 34
    assert body["season_record"]["games"] == 82
    assert body["season_record"]["filters_applied"]["season_type"] == "Regular Season"
    assert body["play_in_record"]["wins"] == 1
    assert body["play_in_record"]["losses"] == 0
    assert body["play_in_record"]["games"] == 1
    assert body["playoff_record"]["wins"] == 2
    assert body["playoff_record"]["losses"] == 4
    assert body["playoff_record"]["games"] == 6


@pytest.mark.unit
def test_get_team_prefers_official_standings_record(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar="2025-26"),
        query_result(rows=[{"season_type": "Regular Season", "games": 81, "wins": 59}]),
        query_result(
            rows=[
                _standing_row()
                | {
                    "season": "2025-26",
                    "wins": 60,
                    "losses": 22,
                    "win_pct": 0.732,
                    "record_source": "official",
                }
            ]
        ),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    record = response.json()["data"]["season_record"]
    assert record["wins"] == 60
    assert record["losses"] == 22
    assert record["games"] == 82
    assert record["win_pct"] == 0.732
    assert record["filters_applied"]["season_type"] == "Regular Season"


@pytest.mark.unit
def test_get_team_official_record_is_wins_plus_losses_not_game_fact_count(
    client, session, query_result
) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar="2025-26"),
        query_result(rows=[{"season_type": "Regular Season", "games": 81, "wins": 64}]),
        query_result(
            rows=[
                _standing_row()
                | {
                    "season": "2025-26",
                    "wins": 64,
                    "losses": 18,
                    "win_pct": 0.78,
                    "record_source": "official",
                }
            ]
        ),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert response.status_code == 200
    record = response.json()["data"]["season_record"]
    assert record["wins"] == 64
    assert record["losses"] == 18
    assert record["games"] == 82
    assert record["games"] != 81


@pytest.mark.unit
def test_team_games_invalid_location(client, session, query_result) -> None:
    session.queue = [query_result(rows=[_team_row()])]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}/games", params={"location": "chicago"})
    assert response.status_code == 400


@pytest.mark.unit
def test_team_games(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_ONE,
                        "season": "2024-25",
                        "season_type": "Regular Season",
                        "game_date": date(2024, 10, 22),
                        "arena": "United Center",
                        "arena_city": "Chicago",
                        "arena_state": "IL",
                        "home_team_id": TEAM_CHI,
                        "home_team_abbreviation": "CHI",
                        "home_team_name": "Chicago Bulls",
                        "home_score": 110,
                        "away_team_id": TEAM_GSW,
                        "away_team_abbreviation": "GSW",
                        "away_team_name": "Golden State Warriors",
                        "away_score": 118,
                        "winning_team_id": TEAM_GSW,
                        "winner_location": "away",
                        "score_margin": 8,
                        "location": "away",
                        "opponent_team_id": TEAM_CHI,
                        "opponent_abbreviation": "CHI",
                        "opponent_name": "Chicago Bulls",
                        "team_score": 118,
                        "opponent_score": 110,
                        "is_win": True,
                    }
                )
            ]
        ),
    ]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/games",
        params={"location": "away", "arena_city": "Chicago", "since_season": "2010-11"},
    )
    assert response.status_code == 200
    assert response.json()["data"][0]["is_win"] is True
    assert response.json()["data"][0]["score_margin"] == 8
    assert response.json()["data"][0]["arena_city"] == "Chicago"


@pytest.mark.unit
def test_team_games_loss_returns_team_centric_margin(
    client, session, mapping_row, query_result
) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_TWO,
                        "season": "2025-26",
                        "season_type": "Playoffs",
                        "game_date": date(2026, 4, 30),
                        "arena": "Ball Arena",
                        "arena_city": "Denver",
                        "arena_state": "CO",
                        "home_team_id": TEAM_GSW,
                        "home_team_abbreviation": "GSW",
                        "home_team_name": "Golden State Warriors",
                        "home_score": 98,
                        "away_team_id": TEAM_MIN,
                        "away_team_abbreviation": "MIN",
                        "away_team_name": "Minnesota Timberwolves",
                        "away_score": 110,
                        "winning_team_id": TEAM_MIN,
                        "winner_location": "away",
                        "score_margin": -12,
                        "location": "home",
                        "opponent_team_id": TEAM_MIN,
                        "opponent_abbreviation": "MIN",
                        "opponent_name": "Minnesota Timberwolves",
                        "team_score": 98,
                        "opponent_score": 110,
                        "is_win": False,
                    }
                )
            ]
        ),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}/games")
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["is_win"] is False
    assert row["score_margin"] == -12
    assert row["team_score"] == 98
    assert row["opponent_score"] == 110


@pytest.mark.unit
def test_team_games_sql_fills_arena_from_home_team() -> None:
    from queries.teams import LIST_TEAM_GAMES

    sql = str(LIST_TEAM_GAMES)
    assert "gold.dim_teams" in sql
    assert "coalesce" in sql.lower()
    assert "home_teams.city" in sql
    assert "fct_team_game_results.home_score - fct_team_game_results.away_score" in sql
    assert "fct_team_game_results.away_score - fct_team_game_results.home_score" in sql


@pytest.mark.unit
def test_team_games_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/teams/{MISSING_ID}/games")
    assert response.status_code == 404


@pytest.mark.unit
def test_team_record_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/teams/{MISSING_ID}/record")
    assert response.status_code == 404


@pytest.mark.unit
def test_team_record_empty(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(rows=[{"games": 0, "wins": 0}]),
    ]
    response = client.get(f"/api/v1/teams/{TEAM_GSW}/record")
    assert response.status_code == 200
    assert response.json()["data"]["win_pct"] == 0.0
    assert response.json()["data"]["games"] == 0


@pytest.mark.unit
def test_team_record_regular_season_filter(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(rows=[{"games": 82, "wins": 48}]),
    ]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/record",
        params={"season": "2025-26", "season_type": "Regular Season"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["wins"] == 48
    assert body["losses"] == 34
    assert body["games"] == 82
    assert body["filters_applied"]["season"] == "2025-26"
    assert body["filters_applied"]["season_type"] == "Regular Season"


@pytest.mark.unit
def test_team_record_play_in_alias(client, session, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(rows=[{"games": 1, "wins": 0}]),
    ]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/record",
        params={"season": "2025-26", "season_type": "Play-In"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["filters_applied"]["season_type"] == "PlayIn"


@pytest.mark.unit
def test_team_record_invalid_season_type(client, session, query_result) -> None:
    session.queue = [query_result(rows=[_team_row()])]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/record",
        params={"season_type": "Summer League"},
    )
    assert response.status_code == 400


@pytest.mark.unit
def test_record_sql_filters_season_type() -> None:
    from queries.teams import COMPUTE_RECORD, COMPUTE_RECORDS_BY_SEASON_TYPE

    assert "fct_team_game_results.season_type = :season_type" in str(COMPUTE_RECORD)
    assert "GROUP BY fct_team_game_results.season_type" in str(COMPUTE_RECORDS_BY_SEASON_TYPE)


@pytest.mark.unit
def test_list_teams_sql_reads_records_from_standings() -> None:
    from queries.teams import LIST_TEAMS

    sql = str(LIST_TEAMS)
    assert "gold.fct_team_game_results" in sql
    assert "season_type = 'Regular Season'" in sql
    # fct_standings already falls back to game results; the SQL must not redo it.
    assert "fct_standings.wins" in sql
    assert "fct_standings.record_source" in sql
    assert "records." not in sql
    assert "pts_scored_avg" in sql
    assert "pts_allowed_avg" in sql


@pytest.mark.unit
def test_list_teams_game_record_overlay(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(scalar=1),
        query_result(
            [
                mapping_row(
                    {
                        "team_id": TEAM_BOS,
                        "abbreviation": "BOS",
                        "team_name": "Boston Celtics",
                        "conference": "East",
                        "division": "Atlantic",
                        "city": "Boston",
                        "nickname": "Celtics",
                        "wins": 56,
                        "losses": 26,
                        "win_pct": 0.683,
                        "record_source": "games",
                        "pts_scored_avg": 116.4,
                        "pts_allowed_avg": 109.2,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/teams", params={"season": "2025-26"})
    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["abbreviation"] == "BOS"
    assert row["wins"] == 56
    assert row["losses"] == 26
    assert row["win_pct"] == 0.683
    assert row["record_source"] == "games"
    assert row["pts_scored_avg"] == 116.4
    assert row["pts_allowed_avg"] == 109.2


@pytest.mark.unit
def test_team_season_games(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(rows=[_team_row()]),
        query_result(
            [
                mapping_row(
                    {
                        "game_id": GAME_ONE,
                        "season": "2024-25",
                        "season_type": "Regular Season",
                        "game_date": date(2024, 10, 22),
                        "status": "Final",
                        "is_home": False,
                        "opponent_team_id": TEAM_CHI,
                        "opponent_abbreviation": "CHI",
                        "team_score": 118,
                        "opponent_score": 110,
                        "result": "W",
                        "win_probability": 0.41,
                        "is_back_to_back": False,
                    }
                ),
                mapping_row(
                    {
                        "game_id": GAME_TWO,
                        "season": "2024-25",
                        "season_type": "Regular Season",
                        "game_date": date(2024, 10, 23),
                        "status": "Scheduled",
                        "is_home": True,
                        "opponent_team_id": TEAM_BOS,
                        "opponent_abbreviation": "BOS",
                        "team_score": None,
                        "opponent_score": None,
                        "result": None,
                        "win_probability": None,
                        "is_back_to_back": True,
                    }
                ),
            ]
        ),
    ]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/season-games",
        params={"season": "2024-25", "season_type": "regular season"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 2
    played, upcoming = body["data"]
    assert (played["result"], played["team_score"], played["is_home"]) == ("W", 118, False)
    assert upcoming["result"] is None
    assert upcoming["is_back_to_back"] is True
    _, params = session.calls[-1]
    assert params["season"] == "2024-25"
    assert params["season_type"] == "Regular Season"


@pytest.mark.unit
def test_team_season_games_not_found(client, session, query_result) -> None:
    session.queue = [query_result(rows=[])]
    response = client.get(f"/api/v1/teams/{MISSING_ID}/season-games")
    assert response.status_code == 404


@pytest.mark.unit
def test_team_season_games_rejects_invalid_season_type(client, session, query_result) -> None:
    session.queue = [query_result(rows=[_team_row()])]
    response = client.get(
        f"/api/v1/teams/{TEAM_GSW}/season-games", params={"season_type": "Summer League"}
    )
    assert response.status_code == 400


@pytest.mark.unit
def test_team_season_games_sql_reads_every_state_and_flags_back_to_backs() -> None:
    from queries.teams import LIST_TEAM_SEASON_GAMES

    sql = str(LIST_TEAM_SEASON_GAMES)
    assert "FROM gold.fct_games_schedule" in sql
    assert "gold.fct_team_game_results" not in sql
    assert "lag(fct_games_schedule.game_date) OVER" in sql
    assert "THEN fct_game_predictions.model_wp" in sql
