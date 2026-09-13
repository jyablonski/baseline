from datetime import UTC, datetime

import pytest


@pytest.mark.unit
def test_health(client) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.unit
def test_status_watermark(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            rows=[
                mapping_row(
                    {
                        "last_scraped_at": datetime(2026, 9, 4, 4, 12, tzinfo=UTC),
                        "player_count": 12,
                        "game_count": 40,
                        "season_count": 2,
                        "first_season": "2010-11",
                        "last_season": "2025-26",
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/status")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["player_count"] == 12
    assert body["game_count"] == 40
    assert body["season_count"] == 2
    assert body["first_season"] == "2010-11"
    assert body["last_season"] == "2025-26"
    assert body["last_scraped_at"].startswith("2026-09-04T04:12:00")


@pytest.mark.unit
def test_status_missing_scrape_row(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            rows=[
                mapping_row(
                    {
                        "last_scraped_at": None,
                        "player_count": 0,
                        "game_count": 0,
                        "season_count": 0,
                        "first_season": None,
                        "last_season": None,
                    }
                )
            ]
        ),
    ]
    response = client.get("/api/v1/status")
    assert response.status_code == 200
    assert response.json()["data"]["last_scraped_at"] is None


@pytest.mark.unit
def test_status_sql_falls_back_to_source_scraped_at() -> None:
    from queries.status import WAREHOUSE_STATUS

    sql = str(WAREHOUSE_STATUS)
    assert "source.scrape_pipeline" in sql
    assert "source.games" in sql
    assert "source.player_game_logs" in sql
    assert "coalesce(" in sql.lower()


@pytest.mark.unit
def test_query_back_to_back(client) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "How many back-to-backs has LeBron played?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "LeBron James" in body["answer"]
    assert body["data"]
    assert "cube:" in (body.get("sql") or "")


@pytest.mark.unit
def test_query_compare(client) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "Compare LeBron vs Curry career games"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "LeBron" in body["answer"]
    assert len(body["data"]) == 2
    assert "player_id" not in body["data"][0]


@pytest.mark.unit
def test_query_compare_try_chip(client) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "How many more career games has LeBron played than Stephen Curry?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "I can answer" not in body["answer"]
    assert "more games" in body["answer"]
    assert "career" not in body["answer"]
    assert len(body["data"]) == 2
    assert [row["full_name"] for row in body["data"]] == [
        "LeBron James",
        "Stephen Curry",
    ]


@pytest.mark.unit
def test_query_unrecognized(client, session, query_result) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "What is the meaning of life?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert "salary/payroll" in body["answer"]
    assert "standings" in body["answer"]


@pytest.mark.unit
def test_query_standings_who_leads_west(client) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "Who leads the West?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "Thunder" in body["answer"]
    assert body["data"]
    assert body["data"][0]["abbreviation"] == "OKC"


@pytest.mark.unit
def test_query_salary_curry(client) -> None:
    response = client.post(
        "/api/v1/query",
        json={"question": "What is Curry's salary?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "Stephen Curry" in body["answer"]
    assert "55,772,427" in body["answer"]
    assert body["data"][0]["current_season_salary"] == 55772427


@pytest.mark.unit
def test_query_rejects_empty_question(client) -> None:
    response = client.post("/api/v1/query", json={"question": ""})
    assert response.status_code == 422


@pytest.mark.unit
def test_query_cube_down_is_clear(client, cube_analytics) -> None:
    from cube.errors import CubeUnavailableError

    def boom(name: str):
        raise CubeUnavailableError(
            "Ask is unavailable because the Cube semantic layer is down. "
            "There is no gold SQL fallback."
        )

    cube_analytics.search_players = boom
    response = client.post(
        "/api/v1/query",
        json={"question": "How many back-to-backs has Kawhi played?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["data"] == []
    assert "Cube semantic layer is down" in body["answer"]
    assert "gold SQL" in body["answer"]
