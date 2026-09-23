import pytest


@pytest.mark.unit
def test_prediction_scorecard_marks_champion(client, session, mapping_row, query_result) -> None:
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
    assert [r["is_champion"] for r in body["rows"]] == [True, False]
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
