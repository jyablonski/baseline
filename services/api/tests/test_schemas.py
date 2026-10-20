from datetime import date
from uuid import UUID

import pytest
from pydantic import ValidationError

from schemas import PaginationMeta, SeasonListResponse
from schemas.game import GameFlow, GameResult, PlayByPlayEvent, QueryRequest, ScheduledGame
from schemas.player import PlayerSeasonStats, PlayerSummary
from schemas.standing import StandingRow
from schemas.status import WarehouseStatus
from schemas.team import TeamDetail, TeamRecord

PLAYER_LEBRON = UUID("00000000-0000-4000-8000-000000000001")
TEAM_GSW = UUID("7bf8726a-a852-452d-b81f-14839127c5fb")
TEAM_LAL = UUID("8cbd46d2-8092-4b1e-8b24-f31c7692cadd")
GAME_ONE = UUID("00000000-0000-4000-8000-000000000101")
GAME_TWO = UUID("00000000-0000-4000-8000-000000000102")


@pytest.mark.unit
def test_player_summary_from_attributes() -> None:
    player = PlayerSummary.model_validate(
        {
            "player_id": PLAYER_LEBRON,
            "full_name": "LeBron James",
            "position": "F",
            "team_abbreviation": "LAL",
            "is_active": True,
        }
    )
    assert player.player_id == PLAYER_LEBRON
    assert player.is_active is True


@pytest.mark.unit
def test_query_request_requires_question() -> None:
    with pytest.raises(ValidationError):
        QueryRequest(question="")


@pytest.mark.unit
def test_game_result_and_season_list() -> None:
    game = GameResult(
        game_id=GAME_ONE,
        season="2024-25",
        game_date=date(2024, 10, 22),
        home_team_id=TEAM_LAL,
        away_team_id=TEAM_GSW,
    )
    assert game.home_team_id == TEAM_LAL
    scheduled = ScheduledGame(
        game_id=GAME_TWO,
        season="2026-27",
        game_date=date(2026, 10, 22),
        status="Scheduled",
        home_team_id=TEAM_GSW,
        away_team_id=TEAM_LAL,
    )
    assert scheduled.status == "Scheduled"
    payload = SeasonListResponse(data=["2024-25"])
    assert payload.meta.total == 0


@pytest.mark.unit
def test_game_flow_and_play_by_play_event() -> None:
    event = PlayByPlayEvent(
        game_id=GAME_ONE,
        action_number=12,
        elapsed_seconds=28,
        score_home=2,
        score_away=0,
        score_differential=2,
    )
    assert event.scoring_side is None
    flow = GameFlow(
        game_id=GAME_ONE,
        season="2025-26",
        game_date=date(2026, 6, 13),
        home_team_id=TEAM_GSW,
        away_team_id=TEAM_LAL,
        has_play_by_play=False,
    )
    assert flow.biggest_run_label is None
    assert flow.max_lead is None
    assert flow.home_primary_color is None
    assert flow.away_alternate_color is None


@pytest.mark.unit
def test_team_record_defaults() -> None:
    record = TeamRecord(
        team_id=TEAM_GSW,
        team_name="Warriors",
        wins=10,
        losses=5,
        win_pct=0.667,
        games=15,
    )
    assert record.filters_applied == {}
    assert PaginationMeta(total=1, limit=1, offset=0).offset == 0


@pytest.mark.unit
def test_team_detail_arena_coords() -> None:
    team = TeamDetail(
        team_id=TEAM_GSW,
        abbreviation="GSW",
        team_name="Golden State Warriors",
        conference="West",
        division="Pacific",
        arena_name="Chase Center",
        arena_latitude=37.76806,
        arena_longitude=-122.38750,
    )
    assert team.arena_name == "Chase Center"
    assert team.arena_latitude == 37.76806
    assert team.arena_longitude == -122.3875
    assert (
        TeamDetail(
            team_id=UUID("00000000-0000-4000-8000-000000000201"),
            abbreviation="XXX",
            team_name="Unknown",
            conference="East",
            division="Atlantic",
        ).arena_latitude
        is None
    )
    assert team.standing is None
    assert team.current_season_payroll is None


@pytest.mark.unit
def test_standing_row() -> None:
    row = StandingRow(
        team_id=TEAM_GSW,
        abbreviation="GSW",
        team_name="Golden State Warriors",
        season="2024-25",
        season_type="Regular Season",
        as_of_date=date(2025, 4, 13),
        conference="West",
        division="Pacific",
        conference_rank=1,
        division_rank=1,
        wins=50,
        losses=32,
        win_pct=0.61,
        games_back=0,
        streak="W5",
        last_10="8-2",
    )
    assert row.conference_rank == 1
    assert row.games_back == 0
    overlay = StandingRow(
        team_id=UUID("7927412c-868d-4650-b329-bdc07b20358c"),
        abbreviation="BOS",
        team_name="Boston Celtics",
        season="2025-26",
        season_type="Regular Season",
        conference="East",
        division="Atlantic",
        wins=56,
        losses=26,
        win_pct=0.683,
        record_source="games",
    )
    assert overlay.conference_rank is None
    assert overlay.games_back is None
    assert overlay.as_of_date is None


@pytest.mark.unit
def test_warehouse_status_defaults() -> None:
    from datetime import UTC, datetime

    status = WarehouseStatus()
    assert status.last_scraped_at is None
    assert status.player_count == 0
    assert status.first_season is None
    stamped = WarehouseStatus(last_scraped_at=datetime(2026, 9, 4, 4, 12, tzinfo=UTC))
    serialized = stamped.model_dump(mode="json")
    assert "2026-09-04" in str(serialized["last_scraped_at"])
    assert "04:12:00" in str(serialized["last_scraped_at"])


@pytest.mark.unit
def test_player_season_stats() -> None:
    row = PlayerSeasonStats(
        player_id=UUID("00000000-0000-4000-8000-000000000003"),
        season="2024-25",
        games_played=3,
        ppg=27.3,
    )
    assert row.rpg is None
    assert row.games_played == 3
