import pytest


@pytest.mark.unit
def test_prediction_scorecard_serves_only_the_live_model(
    client, session, mapping_row, query_result
) -> None:
    row = {
        "season": "2025-26",
        "model_name": "elo",
        "model_version": "elo-v0",
        "n": 1230,
        "logloss": 0.65,
        "brier": 0.23,
        "accuracy": 0.64,
        "home_always_accuracy": 0.55,
        "calibration_error": 0.03,
        "market_n": 900,
        "market_logloss": 0.62,
        "market_brier": 0.21,
    }
    session.queue = [
        query_result(scalar="elo-v0"),
        query_result(
            [
                mapping_row(row),
                mapping_row({**row, "model_name": "logit", "model_version": "logit-v1"}),
            ]
        ),
    ]
    response = client.get("/api/v1/predictions/scorecard", params={"season": "2025-26"})
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["champion_model_version"] == "elo-v0"
    assert [r["model_version"] for r in body["rows"]] == ["elo-v0"]
    assert body["rows"][0]["is_champion"] is True
    assert body["rows"][0]["market_logloss"] == 0.62


@pytest.mark.unit
def test_prediction_scorecard_empty(client, session, query_result) -> None:
    session.queue = [query_result(scalar=None), query_result([])]
    response = client.get("/api/v1/predictions/scorecard")
    assert response.status_code == 200
    assert response.json()["data"] == {"champion_model_version": None, "rows": []}


@pytest.mark.unit
def test_prediction_scorecard_sql_reads_gold_only() -> None:
    from queries.predictions import GET_CHAMPION_MODEL_VERSION, LIST_PREDICTION_SCORECARD

    assert "gold.fct_prediction_scorecard" in str(LIST_PREDICTION_SCORECARD)
    assert "gold.fct_game_predictions" in str(GET_CHAMPION_MODEL_VERSION)
    assert "source." not in str(LIST_PREDICTION_SCORECARD)


@pytest.mark.unit
def test_prediction_calibration(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result([mapping_row({"bucket": "60–70%", "predicted": 0.65, "actual": 0.7, "n": 16})])
    ]
    response = client.get("/api/v1/predictions/calibration")
    assert response.status_code == 200
    assert response.json()["data"] == [
        {"bucket": "60–70%", "predicted": 0.65, "actual": 0.7, "n": 16}
    ]


@pytest.mark.unit
def test_prediction_calibration_empty(client, session, query_result) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/predictions/calibration")
    assert response.status_code == 200
    assert response.json()["data"] == []


@pytest.mark.unit
def test_prediction_games_pages(client, session, mapping_row, query_result) -> None:
    row = {
        "game_id": "00000000-0000-4000-8000-000000000201",
        "game_date": "2026-10-29",
        "home_team_abbreviation": "POR",
        "away_team_abbreviation": "MEM",
        "model_wp": 0.38,
        "home_won": False,
    }
    session.queue = [query_result([mapping_row(row)]), query_result(scalar=71)]
    response = client.get("/api/v1/predictions/games", params={"limit": 1, "offset": 5})
    assert response.status_code == 200
    body = response.json()
    assert body["data"][0]["home_won"] is False
    assert body["meta"] == {"total": 71, "limit": 1, "offset": 5}


@pytest.mark.unit
def test_prediction_games_rejects_a_huge_page(client) -> None:
    assert client.get("/api/v1/predictions/games", params={"limit": 101}).status_code == 422
