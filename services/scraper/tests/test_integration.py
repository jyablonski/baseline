"""Scraper DB helper integration tests against Testcontainers Postgres."""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

import pytest
from notify import StepOutcome
from pipeline import finish_run, record_source_runs, start_run
from sqlalchemy import select, text

from db import get_session, upsert_rows
from models import (
    Game,
    GameExternalId,
    GameOdds,
    PlayByPlay,
    Player,
    PlayerContract,
    PlayerExternalId,
    PlayerGameLog,
    Team,
    TeamExternalId,
    TeamPayroll,
    Transaction,
    TransactionParticipant,
)
from queries import SELECT_SOURCE_RUNS_FOR_RUN

TEAM_HOME = UUID("00000000-0000-4000-8000-000000000201")
TEAM_AWAY = UUID("00000000-0000-4000-8000-000000000202")
PLAYER_ONE = UUID("00000000-0000-4000-8000-000000000301")
GAME_ONE = UUID("00000000-0000-4000-8000-000000000401")


def _teams(now: datetime) -> list[dict]:
    return [
        {
            "team_id": TEAM_HOME,
            "canonical_slug": "test-home",
            "abbreviation": "TST",
            "full_name": "Test Home",
            "city": "Home",
            "nickname": "Home",
            "conference": "West",
            "division": "Pacific",
            "scraped_at": now,
        },
        {
            "team_id": TEAM_AWAY,
            "canonical_slug": "test-away",
            "abbreviation": "AWY",
            "full_name": "Test Away",
            "city": "Away",
            "nickname": "Away",
            "conference": "East",
            "division": "Atlantic",
            "scraped_at": now,
        },
    ]


@pytest.mark.integration
def test_get_session_commits_real_rows(db_session_factory) -> None:
    now = datetime.now(UTC)
    with get_session() as session:
        upsert_rows(session, Team, _teams(now), ["team_id"])

    with db_session_factory() as session:
        count = session.execute(
            text("SELECT count(*) FROM source.teams WHERE team_id = :team_id"),
            {"team_id": TEAM_HOME},
        ).scalar_one()
        assert count == 1


@pytest.mark.integration
def test_get_session_rolls_back_on_error(db_session_factory) -> None:
    with pytest.raises(RuntimeError), get_session() as session:
        session.execute(
            text(
                "INSERT INTO source.teams "
                "(team_id, canonical_slug, abbreviation, full_name, city, nickname, conference, division) "
                "VALUES (:team_id, 'rollback', 'RBK', 'Rollback', 'X', 'X', 'West', 'Pacific')"
            ),
            {"team_id": UUID("00000000-0000-4000-8000-000000000299")},
        )
        raise RuntimeError("boom")

    with db_session_factory() as session:
        count = session.execute(
            text("SELECT count(*) FROM source.teams WHERE abbreviation = 'RBK'")
        ).scalar_one()
        assert count == 0


@pytest.mark.integration
def test_upsert_canonical_entities_and_external_ids(db_session_factory) -> None:
    now = datetime.now(UTC)
    with get_session() as session:
        assert upsert_rows(session, Team, _teams(now), ["team_id"]) == 2
        upsert_rows(
            session,
            Player,
            [
                {
                    "player_id": PLAYER_ONE,
                    "first_name": "Test",
                    "last_name": "Player",
                    "full_name": "Test Player",
                    "is_active": True,
                    "team_id": TEAM_HOME,
                    "scraped_at": now,
                }
            ],
            ["player_id"],
        )
        upsert_rows(
            session,
            Game,
            [
                {
                    "game_id": GAME_ONE,
                    "season": "2024-25",
                    "season_type": "Regular Season",
                    "game_date": date(2024, 11, 1),
                    "home_team_id": TEAM_HOME,
                    "away_team_id": TEAM_AWAY,
                    "home_score": 100,
                    "away_score": 98,
                    "status": "Final",
                    "scraped_at": now,
                }
            ],
            ["game_id"],
        )
        upsert_rows(
            session,
            PlayerExternalId,
            [
                {
                    "player_id": PLAYER_ONE,
                    "provider": "basketball-reference",
                    "external_id": "testpl01",
                }
            ],
            ["provider", "external_id"],
        )
        upsert_rows(
            session,
            TeamExternalId,
            [{"team_id": TEAM_HOME, "provider": "basketball-reference", "external_id": "TST"}],
            ["provider", "external_id"],
        )
        upsert_rows(
            session,
            GameExternalId,
            [{"game_id": GAME_ONE, "provider": "basketball-reference", "external_id": "test-game"}],
            ["provider", "external_id"],
        )
        upsert_rows(
            session,
            PlayerGameLog,
            [
                {
                    "player_id": PLAYER_ONE,
                    "game_id": GAME_ONE,
                    "team_id": TEAM_HOME,
                    "game_date": date(2024, 11, 1),
                    "season": "2024-25",
                    "matchup": "TST vs. AWY",
                    "wl": "W",
                    "min": 32.0,
                    "pts": 25,
                    "reb": 5,
                    "ast": 4,
                    "scraped_at": now,
                }
            ],
            ["player_id", "game_id"],
        )
        upsert_rows(
            session,
            PlayerGameLog,
            [
                {
                    "player_id": PLAYER_ONE,
                    "game_id": GAME_ONE,
                    "team_id": TEAM_HOME,
                    "game_date": date(2024, 11, 1),
                    "season": "2024-25",
                    "matchup": "TST vs. AWY",
                    "wl": "W",
                    "min": 34.0,
                    "pts": 28,
                    "reb": 5,
                    "ast": 4,
                    "scraped_at": now,
                }
            ],
            ["player_id", "game_id"],
        )

    with db_session_factory() as session:
        log = session.execute(
            select(PlayerGameLog).where(
                PlayerGameLog.player_id == PLAYER_ONE,
                PlayerGameLog.game_id == GAME_ONE,
            )
        ).scalar_one()
        assert log.pts == 28
        assert log.min == 34.0


@pytest.mark.integration
def test_upsert_contracts_payroll_and_play_by_play(db_session_factory) -> None:
    now = datetime.now(UTC)
    with get_session() as session:
        upsert_rows(session, Team, _teams(now), ["team_id"])
        upsert_rows(
            session,
            Player,
            [
                {
                    "player_id": PLAYER_ONE,
                    "first_name": "Test",
                    "last_name": "Player",
                    "full_name": "Test Player",
                    "is_active": True,
                    "team_id": TEAM_HOME,
                    "scraped_at": now,
                }
            ],
            ["player_id"],
        )
        upsert_rows(
            session,
            Game,
            [
                {
                    "game_id": GAME_ONE,
                    "season": "2024-25",
                    "season_type": "Regular Season",
                    "game_date": date(2024, 11, 1),
                    "home_team_id": TEAM_HOME,
                    "away_team_id": TEAM_AWAY,
                    "home_score": 100,
                    "away_score": 98,
                    "status": "Final",
                    "scraped_at": now,
                }
            ],
            ["game_id"],
        )
        upsert_rows(
            session,
            PlayerContract,
            [
                {
                    "player_id": PLAYER_ONE,
                    "team_id": TEAM_HOME,
                    "player_name": "Test Player",
                    "player_name_normalized": "test player",
                    "season": "2024-25",
                    "salary": 50000000,
                    "is_fully_guaranteed": True,
                    "remaining_guaranteed": 50000000,
                    "player_age": 25,
                    "source_url": "https://www.basketball-reference.com/contracts/TST.html",
                    "scraped_at": now,
                }
            ],
            ["player_id", "team_id", "season"],
        )
        upsert_rows(
            session,
            TeamPayroll,
            [
                {
                    "team_id": TEAM_HOME,
                    "season": "2024-25",
                    "total_salary": 50000000,
                    "remaining_guaranteed": 50000000,
                    "source_url": "https://www.basketball-reference.com/contracts/TST.html",
                    "scraped_at": now,
                }
            ],
            ["team_id", "season"],
        )
        upsert_rows(
            session,
            PlayByPlay,
            [
                {
                    "game_id": GAME_ONE,
                    "season": "2024-25",
                    "action_number": 4,
                    "action_id": 400,
                    "period": 1,
                    "clock": "PT11M32.00S",
                    "score_home": 2,
                    "score_away": 0,
                    "team_id": TEAM_HOME,
                    "player_id": PLAYER_ONE,
                    "action_type": "2pt",
                    "sub_type": "Jump Shot",
                    "description": "Test Player 18' Jump Shot (2 PTS)",
                    "extras": {"shotResult": "Made"},
                    "scraped_at": now,
                }
            ],
            ["game_id", "action_number", "action_id"],
        )

    with db_session_factory() as session:
        row = session.execute(
            text(
                "SELECT description, extras->>'shotResult' "
                "FROM source.play_by_play WHERE game_id = :game_id AND action_number = 4"
            ),
            {"game_id": GAME_ONE},
        ).one()
        assert row[0] == "Test Player 18' Jump Shot (2 PTS)"
        assert row[1] == "Made"


@pytest.mark.integration
def test_record_source_runs_persists_a_row_per_source(db_session_factory) -> None:
    """Per-source history against a real schema, not a mocked session.

    Covers the FK to pipeline_runs, the expectation default, and the
    latest-attempt-per-source read that retry selection depends on.
    """
    started = datetime(2026, 9, 9, 8, 15, 0)
    finished = datetime(2026, 9, 9, 8, 15, 30)

    with get_session() as session:
        run_id = start_run(session, triggered_by="cron", scrape_action="daily+reddit")

    steps = [
        StepOutcome(
            step="standings",
            status="success",
            started_at=started,
            finished_at=finished,
            rows=30,
            season="2025-26",
        ),
        StepOutcome(
            step="odds",
            status="failed",
            started_at=started,
            finished_at=finished,
            error_type="HTTPError",
            error_detail="429 Too Many Requests",
        ),
        StepOutcome(
            step="reddit",
            status="skipped",
            started_at=started,
            finished_at=finished,
            error_detail="REDDIT_* unset; no HTTP attempted",
        ),
    ]
    with get_session() as session:
        record_source_runs(session, run_id, steps)

    with db_session_factory() as session:
        rows = {
            row.source_name: row
            for row in session.execute(SELECT_SOURCE_RUNS_FOR_RUN, {"run_id": run_id})
        }

    assert set(rows) == {"standings", "odds", "reddit"}
    assert rows["standings"].status == "success"
    assert rows["standings"].rows_written == 30
    assert rows["standings"].error_type is None
    assert rows["standings"].expectation == "met"
    assert rows["odds"].expectation == "not_checked"
    assert rows["odds"].status == "failed"
    assert rows["odds"].error_type == "HTTPError"
    assert rows["odds"].rows_written is None
    # Skipped must stay distinct from success-with-zero-rows.
    assert rows["reddit"].status == "skipped"
    assert rows["reddit"].rows_written is None


@pytest.mark.integration
def test_record_source_runs_keeps_latest_attempt_and_cascades(db_session_factory) -> None:
    started = datetime(2026, 9, 9, 8, 15, 0)
    finished = datetime(2026, 9, 9, 8, 15, 30)

    with get_session() as session:
        run_id = start_run(session, triggered_by="cron", scrape_action="daily")

    failed = StepOutcome(
        step="injuries",
        status="failed",
        started_at=started,
        finished_at=finished,
        error_type="HTTPError",
        error_detail="503",
    )
    recovered = StepOutcome(
        step="injuries",
        status="success",
        started_at=started,
        finished_at=finished,
        rows=42,
    )
    with get_session() as session:
        record_source_runs(session, run_id, [failed])
        record_source_runs(session, run_id, [recovered], attempt=2)
        finish_run(session, run_id, status="success", scrape_exit=0, detail="retried")

    with db_session_factory() as session:
        rows = list(session.execute(SELECT_SOURCE_RUNS_FOR_RUN, {"run_id": run_id}))
        # One row per source: the newest attempt wins, the history stays behind it.
        assert len(rows) == 1
        assert rows[0].source_name == "injuries"
        assert rows[0].status == "success"
        assert rows[0].attempt == 2
        assert rows[0].rows_written == 42

        total = session.execute(
            text("SELECT count(*) FROM source.scrape_source_runs WHERE run_id = :run_id"),
            {"run_id": run_id},
        ).scalar_one()
        assert total == 2, "the failed first attempt must survive as history"

    # Deleting the parent run must not strand per-source rows.
    with get_session() as session:
        session.execute(
            text("DELETE FROM source.pipeline_runs WHERE run_id = :run_id"), {"run_id": run_id}
        )
        session.commit()

    with db_session_factory() as session:
        remaining = session.execute(
            text("SELECT count(*) FROM source.scrape_source_runs WHERE run_id = :run_id"),
            {"run_id": run_id},
        ).scalar_one()
        assert remaining == 0


@pytest.mark.integration
def test_transactions_upsert_is_idempotent(db_session_factory) -> None:
    """Re-running the same scrape must not duplicate rows.

    The whole point of hashing (date, description) is that a second run
    collides on the unique constraint instead of inserting again, so this
    asserts the count rather than trusting the ON CONFLICT clause.
    """
    now = datetime.now(UTC)
    key_a = "a" * 64
    key_b = "b" * 64
    transactions = [
        {
            "transaction_key": key_a,
            "transaction_date": date(2025, 7, 1),
            "season": "2025-26",
            "description": "The Toronto Raptors signed Garrett Temple.",
            "source_url": "https://example.test/transactions.html",
            "scraped_at": now,
        },
        {
            "transaction_key": key_b,
            "transaction_date": date(2026, 2, 5),
            "season": "2025-26",
            "description": "In a 7-team trade, the Atlanta Hawks traded Clint Capela.",
            "source_url": "https://example.test/transactions.html",
            "scraped_at": now,
        },
    ]
    # ATL both sends and receives in the same trade: two rows, one constraint.
    participants = [
        {
            "transaction_key": key_b,
            "participant_type": "team",
            "direction": "from",
            "bref_slug": "ATL",
            "display_name": "Atlanta Hawks",
            "team_id": TEAM_HOME,
            "player_id": None,
            "scraped_at": now,
        },
        {
            "transaction_key": key_b,
            "participant_type": "team",
            "direction": "to",
            "bref_slug": "ATL",
            "display_name": "Atlanta Hawks",
            "team_id": TEAM_HOME,
            "player_id": None,
            "scraped_at": now,
        },
        {
            "transaction_key": key_b,
            "participant_type": "player",
            "direction": "none",
            "bref_slug": "capelca01",
            "display_name": "Clint Capela",
            "team_id": None,
            "player_id": PLAYER_ONE,
            "scraped_at": now,
        },
    ]

    with get_session() as session:
        upsert_rows(session, Team, _teams(now), ["team_id"])
        upsert_rows(
            session,
            Player,
            [
                {
                    "player_id": PLAYER_ONE,
                    "first_name": "Clint",
                    "last_name": "Capela",
                    "full_name": "Clint Capela",
                    "is_active": True,
                    "team_id": TEAM_HOME,
                    "scraped_at": now,
                }
            ],
            ["player_id"],
        )

    participant_conflict = ["transaction_key", "participant_type", "bref_slug", "direction"]
    for _ in range(2):
        with get_session() as session:
            upsert_rows(session, Transaction, transactions, ["transaction_key"])
            upsert_rows(session, TransactionParticipant, participants, participant_conflict)

    with db_session_factory() as session:
        assert len(session.execute(select(Transaction)).scalars().all()) == 2
        rows = session.execute(select(TransactionParticipant)).scalars().all()
        assert len(rows) == 3
        atlanta = sorted(row.direction for row in rows if row.bref_slug == "ATL")
        assert atlanta == ["from", "to"]
        player_row = next(row for row in rows if row.participant_type == "player")
        assert player_row.player_id == PLAYER_ONE
        assert player_row.direction == "none"


@pytest.mark.integration
def test_odds_prune_keeps_started_games_as_history(db_session_factory) -> None:
    from queries import DELETE_STALE_GAME_ODDS

    earlier = datetime(2026, 10, 21, 8, 0)
    scrape = datetime(2026, 10, 22, 8, 0)

    def odds_row(event_id: str, commence: datetime) -> dict:
        return {
            "odds_event_id": event_id,
            "commence_time": commence,
            "home_team_name": "Test Home",
            "away_team_name": "Test Away",
            "game_id": None,
            "bookmaker": "draftkings",
            "market": "h2h",
            "home_price": -150,
            "away_price": 130,
            "scraped_at": earlier,
        }

    with db_session_factory() as session:
        session.execute(text("DELETE FROM source.game_odds"))
        session.commit()
        upsert_rows(
            session,
            GameOdds,
            [
                # tipped last night: its last pregame line is history
                odds_row("evt-played", datetime(2026, 10, 21, 23, 30)),
                # still upcoming but gone from today's feed: postponed or pulled
                odds_row("evt-pulled", datetime(2026, 10, 23, 23, 30)),
            ],
            ["odds_event_id", "bookmaker", "market"],
        )
        session.execute(DELETE_STALE_GAME_ODDS, {"scraped_at": scrape, "now_utc": scrape})
        session.commit()
        remaining = session.execute(
            text("SELECT odds_event_id FROM source.game_odds ORDER BY odds_event_id")
        ).scalars()
        assert list(remaining) == ["evt-played"]


@pytest.mark.integration
def test_unhealthy_streaks_ignore_skips_and_stop_at_a_healthy_run(db_session_factory) -> None:
    """The streak SQL against a real schema: what alerts and what stays quiet."""
    from pipeline import find_unhealthy_streaks

    def step(name: str, status: str, day: int, rows: int | None = None) -> StepOutcome:
        at = datetime(2026, 10, day, 8, 15, 0)
        return StepOutcome(step=name, status=status, started_at=at, finished_at=at, rows=rows)

    nights = [
        # injuries: healthy, then empty three nights running with an off-day
        # skip in the middle. Skips neither extend nor break the streak.
        [
            step("injuries", "success", 20, 40),
            step("standings", "failed", 20),
            step("teams", "failed", 20),
        ],
        [step("injuries", "success", 21, 0), step("standings", "success", 21, 30)],
        [step("injuries", "skipped", 22), step("standings", "failed", 22)],
        [step("injuries", "success", 23, 0), step("standings", "failed", 23)],
        [step("injuries", "success", 24, 0), step("standings", "success", 24, 30)],
    ]
    run_ids = []
    for steps in nights:
        with get_session() as session:
            run_id = start_run(session, triggered_by="cron", scrape_action="daily")
            record_source_runs(session, run_id, steps)
        run_ids.append(run_id)

    with db_session_factory() as session:
        streaks = find_unhealthy_streaks(session, run_ids[-1], threshold=3)
        # standings recovered on the latest night; teams failed but was not
        # attempted in this run, so stale history does not re-alert.
        assert [item.source_name for item in streaks] == ["injuries"]
        assert streaks[0].streak == 3
        assert streaks[0].below_runs == 3
        assert streaks[0].failed_runs == 0

        assert find_unhealthy_streaks(session, run_ids[-1], threshold=4) == []


@pytest.mark.integration
def test_ml_exit_is_recorded_and_fails_the_run(db_session_factory) -> None:
    from pipeline import update_run_ml_exit

    with get_session() as session:
        run_id = start_run(session, triggered_by="cron", scrape_action="daily")
        finish_run(session, run_id, status="success", scrape_exit=0, detail="scraped")
    update_run_ml_exit(run_id, 1, detail="ml score finished with exit 1")

    with db_session_factory() as session:
        row = session.execute(
            text("SELECT status, ml_exit, detail FROM source.pipeline_runs WHERE run_id = :run_id"),
            {"run_id": run_id},
        ).one()
    assert row.status == "failed"
    assert row.ml_exit == 1
    assert row.detail == "scraped | ml score finished with exit 1"
