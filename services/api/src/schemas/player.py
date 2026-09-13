from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlayerSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    full_name: str
    position: str | None = None
    team_abbreviation: str | None = None
    is_active: bool
    career_games_played: int = 0
    career_ppg: float | None = None
    career_rpg: float | None = None
    career_apg: float | None = None
    # Regular Season MVP ladder for mvp_season (the requested season, else the latest).
    mvp_season: str | None = None
    mvp_score: float | None = None
    mvp_rank: int | None = None


class PlayerDetail(PlayerSummary):
    first_name: str
    last_name: str
    jersey_number: str | None = None
    height: str | None = None
    weight: int | None = None
    birth_date: date | None = None
    seasons_played: int = 0
    first_season: str | None = None
    last_season: str | None = None
    current_season_salary: int | None = None
    current_remaining_guaranteed: int | None = None
    current_contract_season: str | None = None


class GameLogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    game_id: UUID | None = None
    game_date: date
    season: str | None = None
    opponent_abbreviation: str
    location: str
    result: str
    minutes: float | None = None
    points: int | None = None
    rebounds: int | None = None
    assists: int | None = None
    steals: int | None = None
    blocks: int | None = None
    turnovers: int | None = None
    plus_minus: int | None = None
    season_type: str | None = None
    mvp_game_score: float | None = None
    is_back_to_back: bool


class BackToBackStats(BaseModel):
    player_id: UUID
    player_name: str
    season: str | None = None
    total_back_to_backs: int
    games_played_in_b2b: int
    games_sat_in_b2b: int = 0
    avg_pts_b2b: float | None = None
    avg_pts_non_b2b: float | None = None


class PlayerComparison(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    full_name: str
    team_abbreviation: str | None = None
    position: str | None = None
    career_games_played: int
    seasons_played: int = 0
    first_season: str | None = None
    last_season: str | None = None
    career_ppg: float | None = None
    career_rpg: float | None = None
    career_apg: float | None = None
    career_avg_plus_minus: float | None = None
    mvp_season: str | None = None
    mvp_score: float | None = None
    mvp_rank: int | None = None
    playoff_mvp_score: float | None = None
    playoff_mvp_rank: int | None = None


class PlayerSeasonStats(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    season: str
    games_played: int
    ppg: float | None = None
    rpg: float | None = None
    apg: float | None = None


class HeadToHeadPlayerAverages(BaseModel):
    player_id: UUID
    full_name: str
    games: int
    mpg: float | None = None
    ppg: float | None = None
    rpg: float | None = None
    apg: float | None = None
    plus_minus: float | None = None


class HeadToHeadGameLine(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    player_id: UUID
    full_name: str
    team_abbreviation: str
    opponent_abbreviation: str
    location: str
    result: str
    minutes: float | None = None
    points: int | None = None
    rebounds: int | None = None
    assists: int | None = None
    steals: int | None = None
    blocks: int | None = None
    turnovers: int | None = None
    plus_minus: int | None = None


class HeadToHeadGame(BaseModel):
    game_id: UUID
    game_date: date
    season: str
    matchup: str
    lines: list[HeadToHeadGameLine]


class HeadToHeadComparison(BaseModel):
    games_played: int
    players: list[HeadToHeadPlayerAverages]
    games: list[HeadToHeadGame]
