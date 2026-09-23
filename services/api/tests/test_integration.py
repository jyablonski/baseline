"""API integration tests against Testcontainers Postgres + seeded gold."""

from __future__ import annotations

import pytest
from ids import (
    GAME_ONE,
    GAME_SCHEDULE,
    GAME_SCHEDULE_TWO,
    GAME_THREE,
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

    bare = by_id[GAME_SCHEDULE_TWO]
    for key in (
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
                    (triggered_by, status, scrape_action, scrape_exit, dbt_exit, started_at,
                     finished_at)
                VALUES ('cron', 'success', 'daily+reddit', 0, 0, now() - interval '1 hour', now())
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

    assert body["dbt"]["last_dbt_exit"] == 0
    assert body["dbt"]["last_dbt_run_id"] == run_id
    # Catalog-driven, so this works whether or not dbt has ever run here.
    assert isinstance(body["dbt"]["gold_tables"], list)
    assert body["dbt"]["gold_table_count"] == len(body["dbt"]["gold_tables"])
    assert isinstance(body["ml"], list)
    latest_run = next(run for run in body["recent_runs"] if run["run_id"] == run_id)
    # Stays null until refresh-daily's ml stage records onto the row.
    assert latest_run["ml_exit"] is None


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
