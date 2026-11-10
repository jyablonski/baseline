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
    assert session.calls[0][1] == {"team": None, "limit": 1, "offset": 5}


@pytest.mark.unit
def test_prediction_games_filter_to_either_side_of_one_team(client, session, query_result) -> None:
    session.queue = [query_result([]), query_result(scalar=0)]
    response = client.get("/api/v1/predictions/games", params={"team": " lac "})
    assert response.status_code == 200
    assert response.json()["data"] == []
    list_params, count_params = (call[1] for call in session.calls)
    assert list_params["team"] == "LAC"
    assert count_params == {"team": "LAC"}


@pytest.mark.unit
def test_prediction_games_rejects_a_huge_page(client) -> None:
    assert client.get("/api/v1/predictions/games", params={"limit": 101}).status_code == 422


@pytest.mark.unit
def test_live_model_weights(client, session, mapping_row, query_result) -> None:
    session.queue = [
        query_result(
            [
                mapping_row(
                    {
                        "model_version": "elo-v2",
                        "as_of": "2026-11-10T08:00:00",
                        "settings": {
                            "home_court_points": 1.3,
                            "home_games": 154,
                            "home_win_rate": 0.52,
                            "confidence": 0.9,
                            "back_to_back_points": -1.6,
                            "injury_points": -2.2,
                            "injury_unit": "notable_player",
                        },
                    }
                )
            ]
        )
    ]
    response = client.get("/api/v1/predictions/weights")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["model_version"] == "elo-v2"
    assert data["settings"]["home_court_points"] == 1.3
    assert data["settings"]["injury_unit"] == "notable_player"


@pytest.mark.unit
def test_live_model_weights_null_before_any_run_stored_them(client, session, query_result) -> None:
    session.queue = [query_result([])]
    response = client.get("/api/v1/predictions/weights")
    assert response.status_code == 200
    assert response.json()["data"] is None


@pytest.mark.unit
def test_live_model_weights_sql_reads_the_newest_stored_breakdown() -> None:
    from queries.predictions import GET_LIVE_MODEL_WEIGHTS

    sql = str(GET_LIVE_MODEL_WEIGHTS)
    assert "gold.fct_game_predictions" in sql
    assert "fct_game_predictions.breakdown IS NOT NULL" in sql
    assert "fct_game_predictions.as_of DESC" in sql
