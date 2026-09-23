from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ScheduledGame(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    season: str
    season_type: str | None = None
    game_date: date
    status: str
    arena: str | None = None
    arena_city: str | None = None
    arena_state: str | None = None
    home_team_id: UUID
    home_team_abbreviation: str | None = None
    home_team_name: str | None = None
    away_team_id: UUID
    away_team_abbreviation: str | None = None
    away_team_name: str | None = None
    # Champion pregame model estimate; null until the ML job has scored the game.
    prediction_model_version: str | None = None
    home_win_probability: float | None = None
    away_win_probability: float | None = None
    prediction_as_of: datetime | None = None
    # Market consensus across bookmakers from The Odds API snapshot; null when
    # unkeyed or the event did not match. market_home_wp is vig-free.
    market_home_wp: float | None = None
    home_moneyline: int | None = None
    away_moneyline: int | None = None
    home_spread: float | None = None
    odds_bookmaker_count: int | None = None
    odds_updated_at: datetime | None = None


class GameResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    season: str
    season_type: str | None = None
    game_date: date
    arena: str | None = None
    arena_city: str | None = None
    arena_state: str | None = None
    home_team_id: UUID
    home_team_abbreviation: str | None = None
    home_team_name: str | None = None
    home_score: int | None = None
    away_team_id: UUID
    away_team_abbreviation: str | None = None
    away_team_name: str | None = None
    away_score: int | None = None
    winning_team_id: UUID | None = None
    winner_location: str | None = None
    score_margin: int | None = None


class PlayByPlayEvent(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    action_number: int
    period: int | None = None
    clock: str | None = None
    clock_remaining_seconds: float | None = None
    elapsed_seconds: float
    score_home: int
    score_away: int
    score_differential: int
    home_points: int | None = None
    away_points: int | None = None
    points_scored: int | None = None
    scoring_side: str | None = None
    team_id: UUID | None = None
    player_id: UUID | None = None
    action_type: str | None = None
    sub_type: str | None = None
    description: str | None = None


class GameFlow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID
    season: str
    game_date: date
    home_team_id: UUID
    home_team_abbreviation: str | None = None
    home_team_name: str | None = None
    home_primary_color: str | None = None
    home_alternate_color: str | None = None
    home_score: int | None = None
    away_team_id: UUID
    away_team_abbreviation: str | None = None
    away_team_name: str | None = None
    away_primary_color: str | None = None
    away_alternate_color: str | None = None
    away_score: int | None = None
    winning_team_id: UUID | None = None
    winning_team_abbreviation: str | None = None
    winner_location: str | None = None
    has_play_by_play: bool = False
    scoring_play_count: int | None = None
    max_home_lead: int | None = None
    max_away_lead: int | None = None
    max_lead: int | None = None
    lead_changes: int | None = None
    ties: int | None = None
    home_lead_seconds: float | None = None
    away_lead_seconds: float | None = None
    tied_seconds: float | None = None
    home_lead_pct: float | None = None
    away_lead_pct: float | None = None
    tied_pct: float | None = None
    game_elapsed_seconds: float | None = None
    biggest_run_team_abbreviation: str | None = None
    biggest_run_winner_points: int | None = None
    biggest_run_opponent_points: int | None = None
    biggest_run_start_seconds: float | None = None
    biggest_run_end_seconds: float | None = None
    biggest_run_label: str | None = None
    final_period: int | None = None
    overtime_periods: int | None = None
    went_to_overtime: bool | None = None
    largest_lead_blown: int | None = None
    blown_lead_team_abbreviation: str | None = None
    comeback_team_abbreviation: str | None = None
    blown_lead_period: int | None = None
    blown_lead_elapsed_seconds: float | None = None
    is_wire_to_wire: bool | None = None
    winner_halftime_margin: int | None = None
    winner_margin_entering_fourth: int | None = None


class GameCollapse(BaseModel):
    """A game the leading team lost, ranked by how big that lead was."""

    game_id: UUID
    season: str | None = None
    game_date: date | None = None
    home_team_abbreviation: str | None = None
    home_score: int | None = None
    away_team_abbreviation: str | None = None
    away_score: int | None = None
    largest_lead_blown: int
    blown_lead_team_abbreviation: str | None = None
    comeback_team_abbreviation: str | None = None
    blown_lead_period: int | None = None
    winner_margin_entering_fourth: int | None = None
    lead_changes: int | None = None
    overtime_periods: int | None = None


class TeamGameResult(GameResult):
    location: str
    opponent_team_id: UUID
    opponent_abbreviation: str | None = None
    opponent_name: str | None = None
    team_score: int | None = None
    opponent_score: int | None = None
    is_win: bool | None = None


class BoxScoreRow(BaseModel):
    """One player's line in a single game.

    Percentages are fractions, not 0-100. true_shooting_pct is derived here
    rather than stored, and is null when the player attempted no shots.
    """

    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    player_name: str | None = None
    team_id: UUID
    team_abbreviation: str | None = None
    team_name: str | None = None
    location: str | None = None
    minutes: float | None = None
    points: int | None = None
    rebounds: int | None = None
    assists: int | None = None
    field_goals_made: int | None = None
    field_goals_attempted: int | None = None
    field_goal_pct: float | None = None
    three_pointers_made: int | None = None
    three_pointers_attempted: int | None = None
    three_point_pct: float | None = None
    free_throws_made: int | None = None
    free_throws_attempted: int | None = None
    free_throw_pct: float | None = None
    true_shooting_pct: float | None = None
    plus_minus: int | None = None
    mvp_game_score: float | None = None


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    season: str | None = None


class QueryResponse(BaseModel):
    answer: str
    data: list = Field(default_factory=list)
    sql: str | None = None
