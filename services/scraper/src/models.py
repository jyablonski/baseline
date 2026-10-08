"""SQLAlchemy models for the provider-independent source schema."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Team(Base):
    __tablename__ = "teams"
    __table_args__ = {"schema": "source"}

    team_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    canonical_slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    abbreviation: Mapped[str] = mapped_column(String(5), nullable=False, unique=True)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str] = mapped_column(String(50), nullable=False)
    nickname: Mapped[str] = mapped_column(String(50), nullable=False)
    conference: Mapped[str] = mapped_column(String(10), nullable=False)
    division: Mapped[str] = mapped_column(String(20), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Player(Base):
    __tablename__ = "players"
    __table_args__ = {"schema": "source"}

    player_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    jersey_number: Mapped[str | None] = mapped_column(String(10))
    position: Mapped[str | None] = mapped_column(String(20))
    height: Mapped[str | None] = mapped_column(String(10))
    weight: Mapped[int | None] = mapped_column(Integer)
    birth_date: Mapped[date | None] = mapped_column(Date)
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id")
    )
    from_year: Mapped[int | None] = mapped_column(Integer)
    to_year: Mapped[int | None] = mapped_column(Integer)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Game(Base):
    __tablename__ = "games"
    __table_args__ = {"schema": "source"}

    game_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    season_type: Mapped[str] = mapped_column(String(20), nullable=False)
    game_date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time_et: Mapped[time | None] = mapped_column(Time)
    home_team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    away_team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    home_score: Mapped[int | None] = mapped_column(Integer)
    away_score: Mapped[int | None] = mapped_column(Integer)
    arena: Mapped[str | None] = mapped_column(String(100))
    city: Mapped[str | None] = mapped_column(String(50))
    state: Mapped[str | None] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="Final")
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayerGameLog(Base):
    __tablename__ = "player_game_logs"
    __table_args__ = (
        UniqueConstraint("player_id", "game_id", name="player_game_logs_player_id_game_id_key"),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id"), nullable=False
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id"), nullable=False
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    game_date: Mapped[date] = mapped_column(Date, nullable=False)
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    matchup: Mapped[str] = mapped_column(String(40), nullable=False)
    wl: Mapped[str | None] = mapped_column(CHAR(1))
    min: Mapped[float | None] = mapped_column(Float)
    pts: Mapped[int | None] = mapped_column(Integer)
    reb: Mapped[int | None] = mapped_column(Integer)
    ast: Mapped[int | None] = mapped_column(Integer)
    stl: Mapped[int | None] = mapped_column(Integer)
    blk: Mapped[int | None] = mapped_column(Integer)
    tov: Mapped[int | None] = mapped_column(Integer)
    fgm: Mapped[int | None] = mapped_column(Integer)
    fga: Mapped[int | None] = mapped_column(Integer)
    fg_pct: Mapped[float | None] = mapped_column(Float)
    fg3m: Mapped[int | None] = mapped_column(Integer)
    fg3a: Mapped[int | None] = mapped_column(Integer)
    fg3_pct: Mapped[float | None] = mapped_column(Float)
    ftm: Mapped[int | None] = mapped_column(Integer)
    fta: Mapped[int | None] = mapped_column(Integer)
    ft_pct: Mapped[float | None] = mapped_column(Float)
    plus_minus: Mapped[int | None] = mapped_column(Integer)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayerContract(Base):
    __tablename__ = "player_contracts"
    __table_args__ = (
        UniqueConstraint(
            "player_id", "team_id", "season", name="player_contracts_player_team_season_key"
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id"), nullable=False
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    player_name: Mapped[str] = mapped_column(String(200), nullable=False)
    player_name_normalized: Mapped[str] = mapped_column(String(200), nullable=False)
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    salary: Mapped[int | None] = mapped_column(BigInteger)
    is_fully_guaranteed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    remaining_guaranteed: Mapped[int | None] = mapped_column(BigInteger)
    player_age: Mapped[int | None] = mapped_column(Integer)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Standing(Base):
    __tablename__ = "standings"
    __table_args__ = (
        UniqueConstraint(
            "season", "season_type", "team_id", name="standings_season_season_type_team_id_key"
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    season_type: Mapped[str] = mapped_column(String(20), nullable=False, default="Regular Season")
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    conference: Mapped[str | None] = mapped_column(String(10))
    division: Mapped[str | None] = mapped_column(String(20))
    conference_rank: Mapped[int | None] = mapped_column(Integer)
    division_rank: Mapped[int | None] = mapped_column(Integer)
    wins: Mapped[int | None] = mapped_column(Integer)
    losses: Mapped[int | None] = mapped_column(Integer)
    win_pct: Mapped[float | None] = mapped_column(Float)
    games_back: Mapped[float | None] = mapped_column(Float)
    conf_games_back: Mapped[float | None] = mapped_column(Float)
    streak: Mapped[str | None] = mapped_column(String(20))
    last_10: Mapped[str | None] = mapped_column(String(10))
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayerInjury(Base):
    __tablename__ = "player_injuries"
    __table_args__ = (
        UniqueConstraint("player_id", "team_id", name="player_injuries_player_id_team_id_key"),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id"), nullable=False
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    player_name: Mapped[str] = mapped_column(String(200), nullable=False)
    player_name_normalized: Mapped[str] = mapped_column(String(200), nullable=False)
    update_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayerInjuryHistory(Base):
    __tablename__ = "player_injuries_history"
    __table_args__ = (
        UniqueConstraint(
            "player_id",
            "team_id",
            "snapshot_date",
            name="player_injuries_history_player_team_snapshot_key",
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id"), nullable=False
    )
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    player_name: Mapped[str] = mapped_column(String(200), nullable=False)
    player_name_normalized: Mapped[str] = mapped_column(String(200), nullable=False)
    update_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class GameOdds(Base):
    __tablename__ = "game_odds"
    __table_args__ = (
        UniqueConstraint(
            "odds_event_id",
            "bookmaker",
            "market",
            name="game_odds_odds_event_id_bookmaker_market_key",
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    odds_event_id: Mapped[str] = mapped_column(String(64), nullable=False)
    commence_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    home_team_name: Mapped[str] = mapped_column(String(100), nullable=False)
    away_team_name: Mapped[str] = mapped_column(String(100), nullable=False)
    game_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id")
    )
    bookmaker: Mapped[str] = mapped_column(String(50), nullable=False)
    market: Mapped[str] = mapped_column(String(20), nullable=False)
    home_price: Mapped[int | None] = mapped_column(Integer)
    away_price: Mapped[int | None] = mapped_column(Integer)
    home_implied_wp: Mapped[float | None] = mapped_column(Float)
    away_implied_wp: Mapped[float | None] = mapped_column(Float)
    home_market_wp: Mapped[float | None] = mapped_column(Float)
    away_market_wp: Mapped[float | None] = mapped_column(Float)
    spread_home: Mapped[float | None] = mapped_column(Float)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class GameBroadcast(Base):
    __tablename__ = "game_broadcasts"
    __table_args__ = {"schema": "source"}

    espn_event_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    commence_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    home_team_name: Mapped[str] = mapped_column(String(100), nullable=False)
    away_team_name: Mapped[str] = mapped_column(String(100), nullable=False)
    game_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id")
    )
    # Comma-separated national networks ("ESPN, ABC"); null for a local-only game.
    national_tv: Mapped[str | None] = mapped_column(String(200))
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class GamePrediction(Base):
    __tablename__ = "game_predictions"
    __table_args__ = (
        UniqueConstraint(
            "game_id",
            "model_version",
            name="game_predictions_game_id_model_version_key",
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id"), nullable=False
    )
    as_of: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)
    home_team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    away_team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    model_wp: Mapped[float] = mapped_column(Float, nullable=False)
    market_wp: Mapped[float | None] = mapped_column(Float)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayByPlay(Base):
    __tablename__ = "play_by_play"
    __table_args__ = (
        UniqueConstraint(
            "game_id",
            "action_number",
            "action_id",
            name="play_by_play_game_id_action_number_action_id_key",
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id"), nullable=False
    )
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    action_number: Mapped[int] = mapped_column(Integer, nullable=False)
    action_id: Mapped[int | None] = mapped_column(Integer)
    period: Mapped[int | None] = mapped_column(Integer)
    clock: Mapped[str | None] = mapped_column(String(32))
    score_home: Mapped[int | None] = mapped_column(Integer)
    score_away: Mapped[int | None] = mapped_column(Integer)
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id")
    )
    player_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id")
    )
    secondary_player_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id")
    )
    action_type: Mapped[str | None] = mapped_column(String(50))
    sub_type: Mapped[str | None] = mapped_column(String(80))
    description: Mapped[str | None] = mapped_column(Text)
    extras: Mapped[dict | None] = mapped_column(JSONB)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class PlayerExternalId(Base):
    __tablename__ = "player_external_ids"
    __table_args__ = (
        PrimaryKeyConstraint("provider", "external_id", name="player_external_ids_pkey"),
        Index("idx_player_external_ids_player", "player_id"),
        {"schema": "source"},
    )

    player_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("source.players.player_id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500))
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONB)


class TeamExternalId(Base):
    __tablename__ = "team_external_ids"
    __table_args__ = (
        PrimaryKeyConstraint("provider", "external_id", name="team_external_ids_pkey"),
        Index("idx_team_external_ids_team", "team_id"),
        {"schema": "source"},
    )

    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_url: Mapped[str | None] = mapped_column(String(500))
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONB)


class GameExternalId(Base):
    __tablename__ = "game_external_ids"
    __table_args__ = (
        PrimaryKeyConstraint("provider", "external_id", name="game_external_ids_pkey"),
        Index("idx_game_external_ids_game", "game_id"),
        {"schema": "source"},
    )

    game_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.games.game_id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    source_url: Mapped[str | None] = mapped_column(String(500))
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONB)


class TeamAlias(Base):
    __tablename__ = "team_aliases"
    __table_args__ = (
        UniqueConstraint("provider", "alias", name="team_aliases_provider_alias_key"),
        Index("idx_team_aliases_team", "team_id"),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id", ondelete="CASCADE"), nullable=False
    )
    provider: Mapped[str | None] = mapped_column(String(50))
    alias: Mapped[str] = mapped_column(String(200), nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)


class IdentityReviewQueue(Base):
    __tablename__ = "identity_review_queue"
    __table_args__ = (
        UniqueConstraint(
            "entity_type",
            "provider",
            "external_id",
            name="identity_review_queue_entity_provider_external_key",
        ),
        Index("idx_identity_review_queue_status", "status"),
        {"schema": "source"},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    external_id: Mapped[str] = mapped_column(String(200), nullable=False)
    candidate_name: Mapped[str | None] = mapped_column(String(200))
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    metadata_json: Mapped[dict | None] = mapped_column("metadata", JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class RedditPost(Base):
    __tablename__ = "reddit_posts"
    __table_args__ = {"schema": "source"}

    reddit_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    subreddit: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[str | None] = mapped_column(String(50))
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    num_comments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_utc: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    permalink: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    selftext: Mapped[str | None] = mapped_column(Text)
    flair: Mapped[str | None] = mapped_column(String(200))
    author_flair: Mapped[str | None] = mapped_column(String(200))
    is_self: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class RedditComment(Base):
    __tablename__ = "reddit_comments"
    __table_args__ = {"schema": "source"}

    reddit_id: Mapped[str] = mapped_column(String(16), primary_key=True)
    post_reddit_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("source.reddit_posts.reddit_id"), nullable=False
    )
    parent_id: Mapped[str | None] = mapped_column(String(20))
    author: Mapped[str | None] = mapped_column(String(50))
    body: Mapped[str | None] = mapped_column(Text)
    author_flair: Mapped[str | None] = mapped_column(String(200))
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_utc: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    permalink: Mapped[str] = mapped_column(String(500), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class TeamPayroll(Base):
    __tablename__ = "team_payroll"
    __table_args__ = (
        UniqueConstraint("team_id", "season", name="team_payroll_team_season_key"),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    team_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id"), nullable=False
    )
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    total_salary: Mapped[int | None] = mapped_column(BigInteger)
    remaining_guaranteed: Mapped[int | None] = mapped_column(BigInteger)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class Transaction(Base):
    """One Basketball-Reference transactions-log entry.

    ``transaction_key`` is sha256(date|description) rather than a unique index
    on the pair itself: ``description`` is free prose, and a btree entry over
    ~2704 bytes errors at insert time. Fixed-width hash sidesteps that.
    """

    __tablename__ = "transactions"
    __table_args__ = {"schema": "source"}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_key: Mapped[str] = mapped_column(CHAR(64), nullable=False, unique=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    season: Mapped[str] = mapped_column(String(10), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class TransactionParticipant(Base):
    """A team or player named by a transaction, resolved from its href slug.

    Only hyperlinked entities land here. Draft picks ("a 2031 2nd round draft
    pick") are plain text with no slug and are deliberately not participants.

    ``direction`` comes from the team link's data-attr-from / data-attr-to. It
    is NOT NULL with a 'none' sentinel for players because Postgres treats
    NULLs as distinct in a UNIQUE constraint, so a nullable column would defeat
    the uniqueness it participates in. A team can legitimately appear twice in
    one trade, once in each direction.
    """

    __tablename__ = "transaction_participants"
    __table_args__ = (
        UniqueConstraint(
            "transaction_key",
            "participant_type",
            "bref_slug",
            "direction",
            name="transaction_participants_key_type_slug_key",
        ),
        {"schema": "source"},
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    transaction_key: Mapped[str] = mapped_column(
        CHAR(64), ForeignKey("source.transactions.transaction_key"), nullable=False
    )
    participant_type: Mapped[str] = mapped_column(String(10), nullable=False)
    direction: Mapped[str] = mapped_column(String(4), nullable=False, default="none")
    bref_slug: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    player_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.players.player_id")
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("source.teams.team_id")
    )
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


__all__ = [name for name in globals() if not name.startswith("_")]
