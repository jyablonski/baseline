from __future__ import annotations

from sqlalchemy.orm import Session

from queries.predictions import GET_CHAMPION_MODEL_VERSION, LIST_PREDICTION_SCORECARD


class PredictionsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_scorecard(self, *, season: str | None) -> dict:
        champion = self.db.execute(GET_CHAMPION_MODEL_VERSION).scalar()
        rows = self.db.execute(LIST_PREDICTION_SCORECARD, {"season": season})
        return {
            "champion_model_version": champion,
            "rows": [
                {**dict(row._mapping), "is_champion": row._mapping["model_version"] == champion}
                for row in rows
            ],
        }
