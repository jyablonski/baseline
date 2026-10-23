"""API integration tests against Testcontainers Postgres + seeded gold."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from ids import (
    GAME_ONE,
    GAME_SCHEDULE,
    GAME_SCHEDULE_TWO,
    GAME_THREE,
    GAME_TWO,
    MISSING_ID,
    PLAYER_CURRY,
    PLAYER_KAWHI,
    TEAM_GSW,
    TEAM_LAC,
)


@pytest.mark.integration
def test_health_real_app(integration_client) -> None:
    response = integration_client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.integration
def test_list_players_seeded(integration_client) -> None:
    response = integration_client.get("/api/v1/players", params={"search": "Kawhi"})
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    assert body["data"][0]["full_name"] == "Kawhi Leonard"
    assert body["data"][0]["team_abbreviation"] == "LAC"
    # Diacritics in the query are folded before matching full_name_ascii.
    accented = integration_client.get("/api/v1/players", params={"search": "Káwhi"})
    assert accented.json()["data"][0]["full_name"] == "Kawhi Leonard"


@pytest.mark.integration
def test_get_player_and_game_log(integration_client) -> None:
    detail = integration_client.get(f"/api/v1/players/{PLAYER_KAWHI}")
    assert detail.status_code == 200
    assert detail.json()["data"]["career_games_played"] == 3

    logs = integration_client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/game-log",
        params={"season": "2024-25"},
    )
    assert logs.status_code == 200
    body = logs.json()
    assert body["meta"]["total"] == 3
    assert body["data"][0]["points"] == 30


@pytest.mark.integration
def test_player_back_to_backs(integration_client) -> None:
    response = integration_client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/back-to-backs",
        params={"season": "2024-25"},
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["total_back_to_backs"] == 1
    assert body["games_played_in_b2b"] == 1
    assert body["avg_pts_b2b"] == 24.0


@pytest.mark.integration
def test_compare_players(integration_client) -> None:
    response = integration_client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_KAWHI},{PLAYER_CURRY}", "stat": "ppg"},
    )
    assert response.status_code == 200
    rows = response.json()["data"]
    names = [row["full_name"] for row in rows]
    assert names[0] == "Stephen Curry"
    by_id = {row["player_id"]: row for row in rows}
    assert by_id[PLAYER_CURRY]["career_avg_plus_minus"] == 3.5
    assert by_id[PLAYER_KAWHI]["career_avg_plus_minus"] == 0.7


@pytest.mark.integration
def test_teams_and_record(integration_client) -> None:
    teams = integration_client.get("/api/v1/teams")
    assert teams.status_code == 200
    assert teams.json()["meta"]["total"] == 3

    detail = integration_client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert detail.status_code == 200
    team = detail.json()["data"]
    assert team["arena_name"] == "Chase Center"
    assert team["arena_latitude"] == pytest.approx(37.76806)
    assert team["arena_longitude"] == pytest.approx(-122.38750)

    record = integration_client.get(f"/api/v1/teams/{TEAM_LAC}/record")
    assert record.status_code == 200
    body = record.json()["data"]
    assert body["wins"] == 2
    assert body["losses"] == 1
    assert body["win_pct"] == 0.667


@pytest.mark.integration
def test_games_and_seasons(integration_client) -> None:
    games = integration_client.get("/api/v1/games", params={"season": "2024-25"})
    assert games.status_code == 200
    assert games.json()["meta"]["total"] == 3

    one_day = integration_client.get("/api/v1/games", params={"game_date": "2024-10-22"}).json()
    assert one_day["meta"]["total"] == 1
    opener = one_day["data"][0]
    assert opener["game_id"] == GAME_ONE
    # Only the top-ranked highlight, and no series number outside the playoffs.
    assert opener["lead_highlight"] == "Stephen Curry scores 42"
    # GSW came back from 8 down, from fct_game_flow.
    assert opener["largest_lead_blown"] == 8
    # GSW won at 30% on the morning line, from fct_game_upsets.
    assert opener["winner_market_wp"] == pytest.approx(0.30)
    assert opener["series_game_number"] is None
    assert opener["home_team_conference"] == opener["away_team_conference"] == "West"

    dates = integration_client.get("/api/v1/games/dates").json()["data"]
    assert [row["game_date"] for row in dates] == ["2024-10-25", "2024-10-23", "2024-10-22"]
    assert dates[0] == {"game_date": "2024-10-25", "season": "2024-25", "game_count": 1}
    assert (
        integration_client.get("/api/v1/games/dates", params={"season": "2019-20"}).json()["data"]
        == []
    )

    # Only games still to play, oldest first: the two Finals in the seed are left out.
    upcoming = integration_client.get("/api/v1/schedule/dates").json()
    today = date.today()
    assert upcoming["data"] == [
        {
            "game_date": (today + timedelta(days=14)).isoformat(),
            "season": "2024-25",
            "game_count": 1,
        },
        {
            "game_date": (today + timedelta(days=15)).isoformat(),
            "season": "2024-25",
            "game_count": 1,
        },
    ]
    assert upcoming["meta"] == {"total": 2, "limit": 2, "offset": 0}
    later = integration_client.get(
        "/api/v1/schedule/dates", params={"from_date": (today + timedelta(days=15)).isoformat()}
    ).json()["data"]
    assert [row["game_date"] for row in later] == [(today + timedelta(days=15)).isoformat()]
    # A Final's date never shows up, even when asked for from long before it.
    since_opening = integration_client.get(
        "/api/v1/schedule/dates", params={"from_date": "2024-10-01"}
    ).json()["data"]
    assert "2024-10-22" not in [row["game_date"] for row in since_opening]
    assert (
        integration_client.get("/api/v1/schedule/dates", params={"season": "2019-20"}).json()[
            "data"
        ]
        == []
    )

    seasons = integration_client.get("/api/v1/seasons")
    assert seasons.status_code == 200
    assert seasons.json()["data"] == ["2024-25"]

    schedule = integration_client.get("/api/v1/schedule", params={"season": "2024-25"})
    assert schedule.status_code == 200
    body = schedule.json()
    assert body["meta"]["total"] == 2
    assert body["data"][0]["game_id"] == GAME_SCHEDULE
    assert body["data"][0]["status"] == "Scheduled"
    assert body["data"][0]["home_team_abbreviation"] == "GSW"


@pytest.mark.integration
def test_schedule_carries_predictions_and_consensus_odds(integration_client) -> None:
    response = integration_client.get("/api/v1/schedule", params={"season": "2024-25"})
    assert response.status_code == 200
    by_id = {row["game_id"]: row for row in response.json()["data"]}

    priced = by_id[GAME_SCHEDULE]
    assert priced["prediction_model_version"] == "elo-v0"
    assert priced["home_win_probability"] == pytest.approx(0.6)
    assert priced["away_win_probability"] == pytest.approx(0.4)
    assert priced["market_home_wp"] == pytest.approx(0.58)
    assert priced["home_moneyline"] == -150
    assert priced["away_moneyline"] == 130
    # Median of the two books' lines, and books are counted once per h2h market.
    assert priced["home_spread"] == pytest.approx(-4.0)
    assert priced["odds_bookmaker_count"] == 2

    assert priced["national_tv"] == "ESPN, ABC"

    bare = by_id[GAME_SCHEDULE_TWO]
    for key in (
        "national_tv",
        "prediction_model_version",
        "home_win_probability",
        "away_win_probability",
        "market_home_wp",
        "home_moneyline",
        "away_moneyline",
        "home_spread",
        "odds_bookmaker_count",
    ):
        assert bare[key] is None


@pytest.mark.integration
def test_game_detail_matches_schedule_row(integration_client) -> None:
    schedule = integration_client.get("/api/v1/schedule", params={"season": "2024-25"})
    listed = {row["game_id"]: row for row in schedule.json()["data"]}[GAME_SCHEDULE]

    response = integration_client.get(f"/api/v1/games/{GAME_SCHEDULE}")
    assert response.status_code == 200
    game = response.json()["data"]
    # The single game and the schedule share their SQL, so they must agree.
    for key, value in listed.items():
        assert game[key] == value, key
    assert game["home_score"] is None
    # Entering a game after every seeded Final: GSW split with LAC, LAC also beat CHI.
    assert (game["home_wins"], game["home_losses"]) == (1, 1)
    assert (game["away_wins"], game["away_losses"]) == (2, 1)
    assert game["home_streak"] == "W5"
    assert game["away_last_10"] == "6-4"
    assert game["lead_highlight"] is None


@pytest.mark.integration
def test_game_detail_final(integration_client) -> None:
    first = integration_client.get(f"/api/v1/games/{GAME_ONE}").json()["data"]
    assert first["status"] == "Final"
    assert (first["home_score"], first["away_score"]) == (120, 110)
    # Opening night: nothing played before it, and no runner-up highlight.
    assert (first["home_wins"], first["home_losses"], first["away_wins"], first["away_losses"]) == (
        0,
        0,
        0,
        0,
    )
    assert first["lead_highlight"] == "Stephen Curry scores 42"
    assert (first["home_team_nickname"], first["home_team_conference"]) == ("Warriors", "West")
    assert (first["away_team_nickname"], first["away_team_conference"]) == ("Clippers", "West")
    # Form is today's, so a played game never shows it.
    assert first["home_streak"] is None

    third = integration_client.get(f"/api/v1/games/{GAME_THREE}").json()["data"]
    # The game itself is excluded: LAC (home) 1-1, GSW 1-0 going in.
    assert (third["home_wins"], third["home_losses"]) == (1, 1)
    assert (third["away_wins"], third["away_losses"]) == (1, 0)

    assert integration_client.get(f"/api/v1/games/{MISSING_ID}").status_code == 404


@pytest.mark.integration
def test_upsets(integration_client) -> None:
    response = integration_client.get("/api/v1/games/upsets")
    assert response.status_code == 200
    upsets = response.json()["data"]
    # The favourite's win (GAME_TWO) is not listed; biggest surprise first.
    assert [row["game_id"] for row in upsets] == [GAME_ONE, GAME_THREE]
    assert upsets[0]["winner_market_wp"] == 0.3
    assert upsets[0]["model_called_upset"] is True
    assert upsets[1]["model_winner_wp"] == 0.4

    playoffs = integration_client.get("/api/v1/games/upsets", params={"season_type": "Playoffs"})
    assert playoffs.json()["data"] == []
    other = integration_client.get("/api/v1/games/upsets", params={"season": "2019-20"})
    assert other.json()["data"] == []


@pytest.mark.integration
def test_upsets_carry_context_and_filter_by_either_team(integration_client) -> None:
    upsets = integration_client.get("/api/v1/games/upsets").json()["data"]
    first, third = upsets
    assert first["winner_fair_moneyline"] == 233
    # The season opener: nobody had a record yet. Kawhi was ruled out.
    assert (first["home_wins"], first["home_losses"], first["away_wins"], first["away_losses"]) == (
        0,
        0,
        0,
        0,
    )
    assert first["away_notable_out"] == ["Kawhi Leonard"]
    assert first["home_notable_out"] == []
    # Entering GAME_THREE: LAC (home) 1-1, GSW 1-0.
    assert (third["home_wins"], third["home_losses"], third["away_wins"], third["away_losses"]) == (
        1,
        1,
        1,
        0,
    )

    lac = integration_client.get("/api/v1/games/upsets", params={"team": "lac"}).json()["data"]
    assert [row["game_id"] for row in lac] == [GAME_ONE, GAME_THREE]
    chi = integration_client.get("/api/v1/games/upsets", params={"team": "CHI"}).json()["data"]
    assert chi == []
    paged = integration_client.get("/api/v1/games/upsets", params={"limit": 1, "offset": 1})
    assert [row["game_id"] for row in paged.json()["data"]] == [GAME_THREE]


@pytest.mark.integration
def test_collapses_filter_by_either_side(integration_client) -> None:
    collapses = integration_client.get("/api/v1/games/collapses").json()["data"]
    # Wire-to-wire GAME_TWO is not a collapse.
    assert [row["game_id"] for row in collapses] == [GAME_THREE, GAME_ONE]
    assert collapses[0]["largest_lead_blown"] == 15

    gsw = integration_client.get("/api/v1/games/collapses", params={"team": "GSW"}).json()["data"]
    assert [row["game_id"] for row in gsw] == [GAME_THREE, GAME_ONE]
    paged = integration_client.get("/api/v1/games/collapses", params={"limit": 1, "offset": 1})
    assert [row["game_id"] for row in paged.json()["data"]] == [GAME_ONE]


@pytest.mark.integration
def test_closest_games(integration_client) -> None:
    response = integration_client.get("/api/v1/games/closest", params={"season": "2024-25"})
    assert response.status_code == 200
    games = response.json()["data"]
    assert [row["game_id"] for row in games] == [GAME_THREE, GAME_TWO, GAME_ONE]
    assert (games[0]["final_margin"], games[0]["lead_changes"], games[0]["overtime_periods"]) == (
        3,
        12,
        1,
    )
    assert games[0]["winning_team_abbreviation"] == "LAC"
    # No play-by-play: unknown, not zero.
    assert games[1]["lead_changes"] is None

    gsw = integration_client.get("/api/v1/games/closest", params={"team": "gsw"}).json()["data"]
    assert [row["game_id"] for row in gsw] == [GAME_THREE, GAME_ONE]


@pytest.mark.integration
def test_largest_margins(integration_client) -> None:
    games = integration_client.get("/api/v1/games/largest-margins").json()["data"]
    assert [row["game_id"] for row in games] == [GAME_ONE, GAME_TWO, GAME_THREE]
    assert (games[0]["final_margin"], games[0]["winning_team_abbreviation"]) == (10, "GSW")
    assert games[0]["is_wire_to_wire"] is False
    # Led all the way per the mart, but with no play-by-play it cannot be known.
    assert games[1]["is_wire_to_wire"] is None
    chi = integration_client.get("/api/v1/games/largest-margins", params={"team": "CHI"}).json()
    assert [row["game_id"] for row in chi["data"]] == [GAME_TWO]


@pytest.mark.integration
def test_transactions_link_only_matched_players(integration_client) -> None:
    response = integration_client.get(
        "/api/v1/transactions", params={"team_abbreviation": "lac", "limit": 10}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["meta"]["total"] == 1
    trade = body["data"][0]
    assert trade["team_abbreviations"] == ["GSW", "LAC"]
    assert trade["player_names"] == ["Stephen Curry", "Unmatched Prospect"]
    assert trade["linked_player_names"] == ["Stephen Curry"]

    by_player = integration_client.get(
        "/api/v1/transactions", params={"player_id": PLAYER_CURRY, "limit": 1}
    ).json()
    # Newest first, paged.
    assert by_player["meta"]["total"] == 2
    assert [row["transaction_key"] for row in by_player["data"]] == ["tx-trade"]


@pytest.mark.integration
def test_game_detail_carries_the_upset(integration_client) -> None:
    first = integration_client.get(f"/api/v1/games/{GAME_ONE}").json()["data"]
    assert (first["is_upset"], first["winner_market_wp"], first["model_called_upset"]) == (
        True,
        0.3,
        True,
    )
    # An upset the model did not see coming either.
    third = integration_client.get(f"/api/v1/games/{GAME_THREE}").json()["data"]
    assert (third["is_upset"], third["model_called_upset"]) == (True, False)
    # No line for a game that has not been played.
    upcoming = integration_client.get(f"/api/v1/games/{GAME_SCHEDULE}").json()["data"]
    assert (upcoming["is_upset"], upcoming["winner_market_wp"]) == (None, None)


@pytest.mark.integration
def test_team_season_games(integration_client) -> None:
    response = integration_client.get(
        f"/api/v1/teams/{TEAM_GSW}/season-games", params={"season": "2024-25"}
    )
    assert response.status_code == 200
    games = response.json()["data"]
    # The two seeded Finals GSW played, then its two upcoming games, in date order.
    assert [game["game_id"] for game in games] == [
        GAME_ONE,
        GAME_THREE,
        GAME_SCHEDULE,
        GAME_SCHEDULE_TWO,
    ]
    first, third, home_next, away_next = games
    assert (first["is_home"], first["result"], first["team_score"]) == (True, "W", 120)
    assert (third["is_home"], third["result"], third["opponent_score"]) == (False, "L", 118)
    assert third["opponent_abbreviation"] == "LAC"
    assert home_next["result"] is None
    assert home_next["win_probability"] == pytest.approx(0.6)
    # The away side of the same prediction.
    assert away_next["is_home"] is False
    # CURRENT_DATE + 14, then + 15: a back-to-back.
    assert (home_next["is_back_to_back"], away_next["is_back_to_back"]) == (False, True)

    # No season: the team's newest on the schedule.
    latest = integration_client.get(f"/api/v1/teams/{TEAM_GSW}/season-games")
    assert [game["game_id"] for game in latest.json()["data"]] == [
        game["game_id"] for game in games
    ]
    other = integration_client.get(
        f"/api/v1/teams/{TEAM_GSW}/season-games", params={"season_type": "Playoffs"}
    )
    assert other.json()["data"] == []


@pytest.mark.integration
def test_injuries(integration_client) -> None:
    current = integration_client.get("/api/v1/injuries").json()["data"]
    assert [(row["player_name"], row["injury_status"]) for row in current] == [
        ("Stephen Curry", "Out"),
        ("Kawhi Leonard", "Day To Day"),
    ]
    gsw = integration_client.get("/api/v1/injuries", params={"team_id": TEAM_GSW}).json()["data"]
    assert [row["player_name"] for row in gsw] == ["Stephen Curry"]

    final = integration_client.get(f"/api/v1/games/{GAME_ONE}/injuries").json()["data"]
    assert [(row["player_name"], row["side"], row["played"]) for row in final] == [
        ("Kawhi Leonard", "away", False)
    ]
    # Home side first, then the away side.
    upcoming = integration_client.get(f"/api/v1/games/{GAME_SCHEDULE}/injuries").json()["data"]
    assert [row["side"] for row in upcoming] == ["home", "away"]
    assert integration_client.get(f"/api/v1/games/{GAME_THREE}/injuries").json()["data"] == []

    # The schedule chips: only the notable player ruled out, not the doubt.
    schedule = integration_client.get("/api/v1/schedule", params={"season": "2024-25"}).json()
    by_id = {row["game_id"]: row for row in schedule["data"]}
    assert by_id[GAME_SCHEDULE]["home_notable_out"] == ["Stephen Curry"]
    assert by_id[GAME_SCHEDULE]["away_notable_out"] == []
    assert by_id[GAME_SCHEDULE_TWO]["home_notable_out"] == []
    game = integration_client.get(f"/api/v1/games/{GAME_SCHEDULE}").json()["data"]
    assert game["home_notable_out"] == ["Stephen Curry"]

    player = integration_client.get(f"/api/v1/players/{PLAYER_CURRY}").json()["data"]
    assert (player["injury_status"], player["injury_detail"]) == ("Out", "Ankle")


@pytest.mark.integration
def test_daily_highlights(integration_client) -> None:
    latest = integration_client.get("/api/v1/games/highlights")
    assert latest.status_code == 200
    rows = latest.json()["data"]
    # Undated: the newest day with highlights, and a game highlight has no subject.
    assert [row["headline"] for row in rows] == ["Clippers beat Bulls in overtime"]
    assert rows[0]["game_id"] == GAME_TWO
    assert rows[0]["team_id"] is None
    assert rows[0]["is_featured"] is True

    dated = integration_client.get(
        "/api/v1/games/highlights", params={"game_date": "2024-10-22", "season": "2024-25"}
    )
    assert dated.status_code == 200
    rows = dated.json()["data"]
    # One per game: the runner-up on the same game stays out.
    assert [row["headline"] for row in rows] == ["Stephen Curry scores 42"]
    assert rows[0]["game_id"] == GAME_ONE
    assert rows[0]["stat_value"] == 42
    assert rows[0]["score"] == pytest.approx(12.54)

    other_season = integration_client.get("/api/v1/games/highlights", params={"season": "2019-20"})
    assert other_season.status_code == 200
    assert other_season.json()["data"] == []


@pytest.mark.integration
def test_prediction_scorecard(integration_client) -> None:
    response = integration_client.get("/api/v1/predictions/scorecard")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["champion_model_version"] == "elo-v0"
    assert [(row["season"], row["model_version"]) for row in body["rows"]] == [
        ("2024-25", "elo-v0"),
        ("2024-25", "logit-v1"),
        ("2023-24", "elo-v0"),
    ]
    assert [row["is_champion"] for row in body["rows"]] == [True, False, True]
    assert body["rows"][2]["market_logloss"] is None

    filtered = integration_client.get("/api/v1/predictions/scorecard", params={"season": "2023-24"})
    assert len(filtered.json()["data"]["rows"]) == 1


@pytest.mark.integration
def test_status_and_coverage(integration_client, postgres_engine) -> None:
    from sqlalchemy import text

    response = integration_client.get("/api/v1/status")
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["last_scraped_at"] is None
    assert body["player_count"] == 2
    assert body["game_count"] == 3
    assert body["season_count"] == 1
    assert body["first_season"] == "2024-25"
    assert body["last_season"] == "2024-25"

    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO source.teams (
                    team_id, canonical_slug, abbreviation, full_name, city, nickname,
                    conference, division, scraped_at
                ) VALUES (
                    :team_id, 'golden-state-warriors', 'GSW', 'Golden State Warriors', 'San Francisco',
                    'Warriors', 'West', 'Pacific', :ts
                )
                """
            ),
            {"team_id": TEAM_GSW, "ts": "2026-08-01 12:00:00"},
        )
    fallback = integration_client.get("/api/v1/status")
    assert fallback.status_code == 200
    assert fallback.json()["data"]["last_scraped_at"] == "2026-08-01T12:00:00Z"

    with postgres_engine.begin() as conn:
        conn.execute(
            text("UPDATE source.scrape_pipeline SET last_success_at = :ts WHERE id = 1"),
            {"ts": "2026-09-04 04:12:00"},
        )
    stamped = integration_client.get("/api/v1/status")
    assert stamped.status_code == 200
    assert stamped.json()["data"]["last_scraped_at"] == "2026-09-04T04:12:00Z"


@pytest.mark.integration
def test_player_directory_and_season_stats(integration_client) -> None:
    players = integration_client.get(
        "/api/v1/players",
        params={"team_id": TEAM_LAC, "active": True},
    )
    assert players.status_code == 200
    row = players.json()["data"][0]
    assert row["full_name"] == "Kawhi Leonard"
    assert row["career_games_played"] == 3
    assert row["career_ppg"] == 27.3

    logs = integration_client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/game-log",
        params={"is_back_to_back": True},
    )
    assert logs.status_code == 200
    assert logs.json()["meta"]["total"] == 1
    assert logs.json()["data"][0]["points"] == 24

    seasons = integration_client.get(f"/api/v1/players/{PLAYER_KAWHI}/season-stats")
    assert seasons.status_code == 200
    assert seasons.json()["data"][0]["season"] == "2024-25"
    assert seasons.json()["data"][0]["games_played"] == 3

    compare = integration_client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_KAWHI},{PLAYER_CURRY}"},
    )
    assert compare.status_code == 200
    kawhi = next(item for item in compare.json()["data"] if item["player_id"] == PLAYER_KAWHI)
    assert kawhi["team_abbreviation"] == "LAC"
    assert kawhi["first_season"] == "2024-25"
    assert kawhi["career_avg_plus_minus"] == 0.7


@pytest.mark.integration
def test_player_mvp_ladder(integration_client) -> None:
    ladder = integration_client.get("/api/v1/players", params={"sort": "mvp"})
    assert ladder.status_code == 200
    rows = ladder.json()["data"]
    assert [row["full_name"] for row in rows] == ["Kawhi Leonard", "Stephen Curry"]
    assert rows[0]["mvp_season"] == "2024-25"
    assert rows[0]["mvp_rank"] == 1
    assert rows[1]["mvp_score"] == 22.5

    unscored = integration_client.get(
        "/api/v1/players", params={"sort": "mvp", "season": "2023-24"}
    )
    assert unscored.status_code == 200
    assert [row["full_name"] for row in unscored.json()["data"]] == [
        "Kawhi Leonard",
        "Stephen Curry",
    ]
    assert all(row["mvp_rank"] is None for row in unscored.json()["data"])
    assert unscored.json()["data"][0]["mvp_season"] == "2023-24"

    curry = integration_client.get(f"/api/v1/players/{PLAYER_CURRY}")
    assert curry.json()["data"]["mvp_rank"] == 2

    compare = integration_client.get(
        "/api/v1/players/compare",
        params={"ids": f"{PLAYER_CURRY},{PLAYER_KAWHI}", "stat": "mvp"},
    )
    assert compare.status_code == 200
    by_id = {row["player_id"]: row for row in compare.json()["data"]}
    assert compare.json()["data"][0]["player_id"] == PLAYER_KAWHI
    assert by_id[PLAYER_KAWHI]["mvp_score"] == 25.5
    assert by_id[PLAYER_KAWHI]["playoff_mvp_score"] is None
    assert by_id[PLAYER_CURRY]["playoff_mvp_rank"] == 1
    assert by_id[PLAYER_CURRY]["career_avg_plus_minus"] == 3.5

    logs = integration_client.get(
        f"/api/v1/players/{PLAYER_KAWHI}/game-log",
        params={"sort": "mvp_game_score", "order": "desc"},
    )
    assert logs.status_code == 200
    top = logs.json()["data"][0]
    assert top["mvp_game_score"] == 30.5
    assert top["season_type"] == "Regular Season"


@pytest.mark.integration
def test_player_value(integration_client) -> None:
    response = integration_client.get("/api/v1/players/value")
    assert response.status_code == 200
    rows = response.json()["data"]
    # Ladder order, Regular Season only: the playoff row does not add a point.
    assert [(row["full_name"], row["mvp_rank"]) for row in rows] == [
        ("Kawhi Leonard", 1),
        ("Stephen Curry", 2),
    ]
    curry = rows[1]
    assert curry["player_id"] == PLAYER_CURRY
    assert curry["team_abbreviation"] == "GSW"
    assert curry["team_id"] == TEAM_GSW
    assert curry["mvp_season"] == "2024-25"
    assert curry["mvp_score"] == pytest.approx(22.5)
    assert curry["games_played"] == 2
    assert curry["salary"] == 50000000
    assert curry["salary_season"] == "2024-25"

    # A season nobody has played yet shows the latest scored one instead of nothing.
    unplayed = integration_client.get("/api/v1/players/value", params={"season": "2026-27"})
    assert unplayed.status_code == 200
    assert [row["mvp_season"] for row in unplayed.json()["data"]] == ["2024-25", "2024-25"]


@pytest.mark.integration
def test_compare_head_to_head(integration_client) -> None:
    h2h = integration_client.get(
        "/api/v1/players/compare/head-to-head",
        params={"ids": f"{PLAYER_KAWHI},{PLAYER_CURRY}"},
    )
    assert h2h.status_code == 200
    meeting = h2h.json()["data"]
    assert meeting["games_played"] == 2
    by_id = {row["player_id"]: row for row in meeting["players"]}
    assert by_id[PLAYER_KAWHI]["ppg"] == 29.0
    assert by_id[PLAYER_CURRY]["ppg"] == 30.5
    assert by_id[PLAYER_KAWHI]["plus_minus"] == -2.0
    assert by_id[PLAYER_CURRY]["plus_minus"] == 3.5
    assert {game["game_id"] for game in meeting["games"]} == {GAME_ONE, GAME_THREE}


@pytest.mark.integration
def test_teams_directory_records(integration_client) -> None:
    teams = integration_client.get("/api/v1/teams", params={"season": "2024-25"})
    assert teams.status_code == 200
    by_abbr = {row["abbreviation"]: row for row in teams.json()["data"]}
    assert by_abbr["GSW"]["wins"] == 50
    assert by_abbr["GSW"]["nickname"] == "Warriors"
    assert by_abbr["CHI"]["conference"] == "East"


@pytest.mark.integration
def test_salary_payroll_and_standings(integration_client) -> None:
    curry = integration_client.get(f"/api/v1/players/{PLAYER_CURRY}")
    assert curry.status_code == 200
    player = curry.json()["data"]
    assert player["current_season_salary"] == 50_000_000
    assert player["current_remaining_guaranteed"] == 101_000_000
    assert player["current_contract_season"] == "2024-25"

    standings = integration_client.get("/api/v1/standings", params={"conference": "West"})
    assert standings.status_code == 200
    rows = standings.json()["data"]
    assert standings.json()["meta"]["total"] == 2
    assert rows[0]["abbreviation"] == "GSW"
    assert rows[0]["conference_rank"] == 1
    assert rows[0]["games_back"] == 0
    assert rows[1]["abbreviation"] == "LAC"
    assert rows[1]["games_back"] == 1.5

    team = integration_client.get(f"/api/v1/teams/{TEAM_GSW}")
    assert team.status_code == 200
    body = team.json()["data"]
    assert body["current_season_payroll"] == 51_000_000
    assert body["standing"]["conference_rank"] == 1
    assert body["standing"]["conference"] == "West"


@pytest.mark.integration
def test_admin_health_against_real_schema(integration_client, postgres_engine) -> None:
    """Exercise the admin SQL for real.

    DISTINCT ON, the runs-since-success window, and a ten-table UNION ALL of
    watermarks are the kind of SQL that passes review and fails on Postgres.
    """
    from sqlalchemy import text

    from config import Settings, get_settings

    token = "integration-admin-token"
    integration_client.app.dependency_overrides[get_settings] = lambda: Settings(
        admin_api_token=token
    )

    with postgres_engine.begin() as conn:
        conn.execute(text("UPDATE source.scrape_pipeline SET enabled = true WHERE id = 1"))
        run_id = conn.execute(
            text(
                """
                INSERT INTO source.pipeline_runs
                    (triggered_by, status, scrape_action, scrape_exit, dbt_exit, dbt_failed_nodes,
                     started_at, finished_at)
                VALUES ('cron', 'failed', 'daily+reddit', 0, 1,
                        ARRAY['model fct_x', 'test not_null_fct_x_id'],
                        now() - interval '1 hour', now())
                RETURNING run_id
                """
            )
        ).scalar_one()
        previous_run_id = conn.execute(
            text(
                """
                INSERT INTO source.pipeline_runs
                    (triggered_by, status, scrape_action, scrape_exit, started_at, finished_at)
                VALUES ('cron', 'failed', 'daily', 1, now() - interval '1 day',
                        now() - interval '1 day')
                RETURNING run_id
                """
            )
        ).scalar_one()
        # injuries failed yesterday and twice (two attempts) today: two runs,
        # so a streak of 2 — attempts within one run count once. reddit came
        # back empty yesterday and today, which counts like a failure. odds is
        # skipped and has never succeeded, which must not accrue a streak.
        conn.execute(
            text(
                """
                INSERT INTO source.scrape_source_runs
                    (run_id, source_name, status, expectation, rows_written, attempt, started_at)
                VALUES
                    (:previous_run_id, 'injuries', 'failed', 'not_checked', NULL, 1,
                     now() - interval '1 day'),
                    (:previous_run_id, 'reddit', 'success', 'below', 0, 1,
                     now() - interval '1 day'),
                    (:run_id, 'standings', 'success', 'met', 30, 1,
                     now() - interval '90 minutes'),
                    (:run_id, 'injuries', 'failed', 'not_checked', NULL, 1,
                     now() - interval '80 minutes'),
                    (:run_id, 'injuries', 'failed', 'not_checked', NULL, 2,
                     now() - interval '70 minutes'),
                    (:run_id, 'odds', 'skipped', 'not_checked', NULL, 1,
                     now() - interval '60 minutes'),
                    (:run_id, 'reddit', 'success', 'below', 0, 1,
                     now() - interval '50 minutes')
                """
            ),
            {"run_id": run_id, "previous_run_id": previous_run_id},
        )
        conn.execute(text("DELETE FROM source.host_snapshots"))
        conn.execute(
            text(
                """
                INSERT INTO source.host_snapshots (captured_at, payload)
                VALUES
                    (now() - interval '10 minutes', '{"host": {"mem_total_bytes": 1}}'),
                    (now(), CAST(:payload AS jsonb))
                """
            ),
            {
                "payload": (
                    '{"host": {"mem_total_bytes": 24000000000, "mem_available_bytes": 19000000000},'
                    ' "containers": [{"name": "nba-postgres-1", "mem_used_bytes": 304000000}],'
                    ' "connections": [], "errors": []}'
                )
            },
        )

    response = integration_client.get(
        "/api/v1/admin/health", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    body = response.json()["data"]

    assert body["pipeline"]["enabled"] is True
    assert body["pipeline"]["action_today"] in {
        "daily",
        "season",
        "noop",
        "skipped_offseason",
        "skipped_mode_none",
    }

    sources = {row["source_name"]: row for row in body["sources"]}
    assert sources["standings"]["status"] == "success"
    assert sources["standings"]["unhealthy_streak"] == 0
    # Latest attempt wins, and each failed run counts once against the streak.
    assert sources["injuries"]["status"] == "failed"
    assert sources["injuries"]["attempt"] == 2
    assert sources["injuries"]["unhealthy_streak"] == 2
    # Empty every night is a parser that stopped matching, not a success.
    assert sources["reddit"]["status"] == "success"
    assert sources["reddit"]["expectation"] == "below"
    assert sources["reddit"]["unhealthy_streak"] == 2
    # A skipped source is deliberate, not a failure: it must NOT accrue a
    # streak, or every NBA source looks broken all off-season.
    assert sources["odds"]["status"] == "skipped"
    assert sources["odds"]["last_success_at"] is None
    assert sources["odds"]["unhealthy_streak"] == 0

    tables = {row["table_name"] for row in body["freshness"]}
    assert {"games", "play_by_play", "player_injuries", "reddit_posts"} <= tables

    assert body["dbt"]["last_dbt_exit"] == 1
    assert body["dbt"]["last_dbt_failed_nodes"] == ["model fct_x", "test not_null_fct_x_id"]
    assert body["dbt"]["last_dbt_run_id"] == run_id
    # Catalog-driven, so this works whether or not dbt has ever run here.
    assert isinstance(body["dbt"]["gold_tables"], list)
    assert body["dbt"]["gold_table_count"] == len(body["dbt"]["gold_tables"])
    assert isinstance(body["ml"], list)
    latest_run = next(run for run in body["recent_runs"] if run["run_id"] == run_id)
    # Stays null until refresh-daily's ml stage records onto the row.
    assert latest_run["ml_exit"] is None
    assert latest_run["dbt_failed_nodes"] == ["model fct_x", "test not_null_fct_x_id"]
    assert body["recent_runs_total"] >= 2

    # Newest-first paging: page two of size one is the older seeded run.
    paged = integration_client.get(
        "/api/v1/admin/health?run_limit=1&run_offset=1",
        headers={"Authorization": f"Bearer {token}"},
    ).json()["data"]
    assert [run["run_id"] for run in paged["recent_runs"]] == [previous_run_id]
    assert paged["recent_runs_total"] == body["recent_runs_total"]

    snapshot = body["diagnostics"]["snapshot"]
    # Newest row wins, and keys the payload lacks come back null.
    assert snapshot["host"]["mem_available_bytes"] == 19_000_000_000
    assert snapshot["host"]["swap_total_bytes"] is None
    assert snapshot["containers"][0]["name"] == "nba-postgres-1"
    database = body["diagnostics"]["database"]
    assert database["max_connections"] > 0
    assert database["database_size_bytes"] > 0
    # At least this request's own backend, which the grouped list leaves out.
    assert database["total_connections"] >= 1
    # Testcontainers connects over the Docker bridge, which is private.
    assert all(not group["is_external"] for group in database["connections"])


@pytest.mark.integration
def test_admin_health_is_unauthorized_without_the_token(integration_client) -> None:
    from config import Settings, get_settings

    integration_client.app.dependency_overrides[get_settings] = lambda: Settings(
        admin_api_token="integration-admin-token"
    )
    assert integration_client.get("/api/v1/admin/health").status_code == 401


@pytest.mark.integration
def test_admin_jobs_queue_allows_one_pending_job(integration_client, postgres_engine) -> None:
    """The single-pending guard is a database index, not an application check.

    A read-then-write check would let two rapid clicks both pass; the partial
    unique index makes the second insert fail regardless of timing.
    """
    from sqlalchemy import text

    from config import Settings, get_settings

    token = "integration-admin-token"
    integration_client.app.dependency_overrides[get_settings] = lambda: Settings(
        admin_api_token=token
    )
    headers = {"Authorization": f"Bearer {token}"}

    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM source.admin_jobs"))

    first = integration_client.post(
        "/api/v1/admin/jobs",
        json={"job_type": "dbt", "requested_by": "jyablonski"},
        headers=headers,
    )
    assert first.status_code == 202
    job_id = first.json()["data"]["job_id"]

    second = integration_client.post(
        "/api/v1/admin/jobs",
        json={"job_type": "refresh", "requested_by": "jyablonski"},
        headers=headers,
    )
    assert second.status_code == 409

    # Once the first job finishes, the queue reopens.
    with postgres_engine.begin() as conn:
        conn.execute(
            text(
                "UPDATE source.admin_jobs SET status = 'succeeded', exit_code = 0, "
                "finished_at = now() WHERE job_id = :job_id"
            ),
            {"job_id": job_id},
        )

    third = integration_client.post(
        "/api/v1/admin/jobs",
        json={"job_type": "refresh", "requested_by": "jyablonski"},
        headers=headers,
    )
    assert third.status_code == 202

    listed = integration_client.get("/api/v1/admin/jobs", headers=headers)
    assert listed.status_code == 200
    assert [job["job_type"] for job in listed.json()] == ["refresh", "dbt"]

    health = integration_client.get("/api/v1/admin/health", headers=headers)
    assert health.status_code == 200
    assert len(health.json()["data"]["jobs"]) == 2

    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM source.admin_jobs"))


@pytest.mark.integration
def test_admin_pipeline_switches_leave_the_other_alone(integration_client, postgres_engine) -> None:
    from sqlalchemy import text

    from config import Settings, get_settings

    token = "integration-admin-token"
    integration_client.app.dependency_overrides[get_settings] = lambda: Settings(
        admin_api_token=token
    )
    headers = {"Authorization": f"Bearer {token}"}
    with postgres_engine.begin() as conn:
        before = conn.execute(
            text("SELECT enabled, season_active, reason FROM source.scrape_pipeline WHERE id = 1")
        ).one()
        conn.execute(
            text(
                "UPDATE source.scrape_pipeline SET enabled = true, season_active = true "
                "WHERE id = 1"
            )
        )

    try:
        off = integration_client.put(
            "/api/v1/admin/pipeline",
            json={"enabled": False, "updated_by": "jyablonski"},
            headers=headers,
        )
        assert off.status_code == 200
        gate = off.json()["data"]
        assert (gate["enabled"], gate["season_active"]) == (False, True)
        assert gate["action_today"] == "skipped_disabled"
        assert gate["reason"] == "Pipeline turned off from /admin by jyablonski."

        both = integration_client.put(
            "/api/v1/admin/pipeline",
            json={"enabled": True, "season_active": False, "updated_by": "jyablonski"},
            headers=headers,
        ).json()["data"]
        assert (both["enabled"], both["season_active"]) == (True, False)
        assert both["action_today"] == "skipped_offseason"
        assert (
            both["reason"] == "Pipeline turned on and Season turned off from /admin by jyablonski."
        )
    finally:
        with postgres_engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE source.scrape_pipeline SET enabled = :enabled, "
                    "season_active = :season_active, reason = :reason WHERE id = 1"
                ),
                before._asdict(),
            )


@pytest.mark.integration
def test_admin_job_claim_is_atomic(postgres_engine) -> None:
    """FOR UPDATE SKIP LOCKED: two runners must never claim the same row."""
    from sqlalchemy import text

    claim = text(
        """
        UPDATE source.admin_jobs
        SET status = 'running', started_at = now()
        WHERE job_id = (
            SELECT jobs.job_id FROM source.admin_jobs AS jobs
            WHERE jobs.status = 'queued'
            ORDER BY jobs.requested_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING job_id
        """
    )
    with postgres_engine.begin() as conn:
        conn.execute(text("DELETE FROM source.admin_jobs"))
        conn.execute(
            text(
                "INSERT INTO source.admin_jobs (job_type, requested_by) "
                "VALUES ('dbt', 'jyablonski')"
            )
        )

    first_conn = postgres_engine.connect()
    second_conn = postgres_engine.connect()
    try:
        first_tx = first_conn.begin()
        claimed = first_conn.execute(claim).scalar_one_or_none()
        assert claimed is not None

        # Second runner, while the first transaction still holds the row.
        second_tx = second_conn.begin()
        assert second_conn.execute(claim).scalar_one_or_none() is None
        second_tx.rollback()
        first_tx.commit()
    finally:
        first_conn.close()
        second_conn.close()
        with postgres_engine.begin() as conn:
            conn.execute(text("DELETE FROM source.admin_jobs"))
