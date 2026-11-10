from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from schemas.standing import StandingSummary


class TeamSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    team_id: UUID
    abbreviation: str
    team_name: str
    conference: str
    division: str
    city: str | None = None
    nickname: str | None = None
    wins: int | None = None
    losses: int | None = None
    win_pct: float | None = None
    record_source: str | None = None
    pts_scored_avg: float | None = None
    pts_allowed_avg: float | None = None


class TeamRecord(BaseModel):
    team_id: UUID
    team_name: str
    wins: int
    losses: int
    win_pct: float
    games: int
    filters_applied: dict = Field(default_factory=dict)


class TeamDetail(TeamSummary):
    arena_name: str | None = None
    arena_latitude: float | None = None
    arena_longitude: float | None = None
    primary_color: str | None = None
    alternate_color: str | None = None
    current_season_payroll: int | None = None
    current_remaining_guaranteed: int | None = None
    current_contract_season: str | None = None
    salary_cap: int | None = None
    luxury_tax: int | None = None
    first_apron: int | None = None
    second_apron: int | None = None
    over_luxury_tax: bool | None = None
    over_first_apron: bool | None = None
    over_second_apron: bool | None = None
    record_season: str | None = None
    season_record: TeamRecord | None = None
    play_in_record: TeamRecord | None = None
    playoff_record: TeamRecord | None = None
    standing: StandingSummary | None = None


class TeamStatSplit(BaseModel):
    """One split of a team's current Regular Season with league ranks (1 = best).

    Possession-based stats (ratings, pace, rebound and turnover rates) count only
    the games_with_possessions whose box scores carry the rebound split, and are
    null, with a null rank, when there are none.
    """

    season: str
    split: str
    games: int
    wins: int
    losses: int
    games_with_possessions: int
    team_count: int
    offensive_rating: float | None = None
    offensive_rating_rank: int | None = None
    defensive_rating: float | None = None
    defensive_rating_rank: int | None = None
    net_rating: float | None = None
    net_rating_rank: int | None = None
    pace: float | None = None
    pace_rank: int | None = None
    points_per_game: float | None = None
    points_per_game_rank: int | None = None
    opponent_points_per_game: float | None = None
    opponent_points_per_game_rank: int | None = None
    effective_fg_pct: float | None = None
    effective_fg_pct_rank: int | None = None
    opponent_effective_fg_pct: float | None = None
    opponent_effective_fg_pct_rank: int | None = None
    three_pointers_made_per_game: float | None = None
    three_pointers_made_per_game_rank: int | None = None
    three_point_pct: float | None = None
    three_point_pct_rank: int | None = None
    three_point_attempt_rate: float | None = None
    three_point_attempt_rate_rank: int | None = None
    free_throw_rate: float | None = None
    free_throw_rate_rank: int | None = None
    offensive_rebound_pct: float | None = None
    offensive_rebound_pct_rank: int | None = None
    defensive_rebound_pct: float | None = None
    defensive_rebound_pct_rank: int | None = None
    turnover_pct: float | None = None
    turnover_pct_rank: int | None = None
    opponent_turnover_pct: float | None = None
    opponent_turnover_pct_rank: int | None = None
    assist_rate: float | None = None
    assist_rate_rank: int | None = None


class RosterPlayer(BaseModel):
    """A current player with per-game averages from this team's games this season.

    Averages are null, and games_played 0, for a player yet to play for the team.
    """

    player_id: UUID
    full_name: str
    position: str | None = None
    jersey_number: str | None = None
    season: str | None = None
    games_played: int
    minutes: float | None = None
    points: float | None = None
    rebounds: float | None = None
    assists: float | None = None
    steals: float | None = None
    blocks: float | None = None
    turnovers: float | None = None
    three_pointers_made: float | None = None
    true_shooting_pct: float | None = None
    plus_minus: float | None = None
    game_score: float | None = None
    # League-wide Regular Season MVP ladder, across every team this season. Null
    # when the player has no Regular Season ladder row.
    mvp_score: float | None = None
    mvp_rank: int | None = None
