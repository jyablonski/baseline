from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, DateTime, Float, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


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
    game_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    model_version: Mapped[str] = mapped_column(String(50), nullable=False)
    home_team_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    away_team_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    model_wp: Mapped[float] = mapped_column(Float, nullable=False)
    market_wp: Mapped[float | None] = mapped_column(Float)
    scraped_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class ModelArtifact(Base):
    __tablename__ = "model_artifacts"
    __table_args__ = {"schema": "source"}

    model_version: Mapped[str] = mapped_column(String(50), primary_key=True)
    model_name: Mapped[str] = mapped_column(String(50), nullable=False)
    artifact: Mapped[dict] = mapped_column(JSONB, nullable=False)
    trained_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    is_champion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
