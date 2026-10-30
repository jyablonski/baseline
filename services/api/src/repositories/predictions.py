from __future__ import annotations

from sqlalchemy.orm import Session

from queries.predictions import (
    CLEAR_CHAMPION,
    COUNT_PREDICTION_GAMES,
    GET_CHAMPION_MODEL_VERSION,
    GET_PROMOTION_CANDIDATE,
    LIST_MODEL_REGISTRY,
    LIST_MODEL_RESULTS,
    LIST_PREDICTION_CALIBRATION,
    LIST_PREDICTION_GAMES,
    LIST_PREDICTION_SCORECARD,
    SET_CHAMPION,
)


class UnknownModelError(LookupError):
    """No registry row for that version."""


class ModelNotScoredError(RuntimeError):
    """Registered, but it has no predictions to put on the schedule.

    Other models having upcoming predictions while this one has none is the
    case that would blank the schedule: logit skips each team's first ten games.
    With no upcoming predictions from anyone, in the offseason, it is not.
    """


class PredictionsRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_scorecard(self, *, season: str | None) -> dict:
        """The live model only: comparing candidates is the admin tab's job."""
        champion = self.db.execute(GET_CHAMPION_MODEL_VERSION).scalar()
        rows = self.db.execute(LIST_PREDICTION_SCORECARD, {"season": season})
        return {
            "champion_model_version": champion,
            "rows": [
                {**dict(row._mapping), "is_champion": True}
                for row in rows
                if row._mapping["model_version"] == champion
            ],
        }

    def get_calibration(self) -> list[dict]:
        return [dict(row._mapping) for row in self.db.execute(LIST_PREDICTION_CALIBRATION)]

    def list_games(self, *, limit: int, offset: int) -> list[dict]:
        rows = self.db.execute(LIST_PREDICTION_GAMES, {"limit": limit, "offset": offset})
        return [dict(row._mapping) for row in rows]

    def count_games(self) -> int:
        return self.db.execute(COUNT_PREDICTION_GAMES).scalar() or 0

    def get_model_review(self) -> dict:
        """Every model on the newest season, for the admin Models tab."""
        serving = self.db.execute(GET_CHAMPION_MODEL_VERSION).scalar()
        registry = [dict(row._mapping) for row in self.db.execute(LIST_MODEL_REGISTRY)]
        live = next((model["model_version"] for model in registry if model["is_champion"]), None)
        scorecard = [
            dict(row._mapping)
            for row in self.db.execute(LIST_PREDICTION_SCORECARD, {"season": None})
        ]
        season = max((row["season"] for row in scorecard), default=None)

        games: dict = {}
        for row in self.db.execute(LIST_MODEL_RESULTS):
            result = row._mapping
            game = games.setdefault(
                result["game_id"],
                {
                    "game_id": result["game_id"],
                    "game_date": result["game_date"],
                    "home_team_abbreviation": result["home_team_abbreviation"],
                    "away_team_abbreviation": result["away_team_abbreviation"],
                    "home_won": result["home_won"],
                    "market_wp": None,
                    "predictions": {},
                },
            )
            game["predictions"][result["model_version"]] = result["model_wp"]
            # Copied onto each model's row; the first one on file will do.
            if game["market_wp"] is None:
                game["market_wp"] = result["market_wp"]

        return {
            "season": season,
            "live_model_version": live,
            # Differs from the live model until dbt rebuilds gold after a promotion.
            "serving_model_version": serving,
            "models": registry,
            "rows": [
                {**row, "is_champion": row["model_version"] == live}
                for row in scorecard
                if row["season"] == season
            ],
            "games": list(games.values()),
        }

    def set_champion(self, model_version: str, *, promoted_by: str) -> tuple[dict, bool]:
        """Make one model live. Returns its row and whether anything changed."""
        candidate = (
            self.db.execute(GET_PROMOTION_CANDIDATE, {"model_version": model_version})
            .mappings()
            .one_or_none()
        )
        if candidate is None:
            raise UnknownModelError(model_version)
        if candidate["is_champion"]:
            return dict(candidate), False
        if not candidate["has_predictions"] or (
            candidate["any_upcoming"] and not candidate["covers_upcoming"]
        ):
            raise ModelNotScoredError(model_version)

        self.db.execute(CLEAR_CHAMPION)
        row = (
            self.db.execute(
                SET_CHAMPION, {"model_version": model_version, "promoted_by": promoted_by}
            )
            .mappings()
            .one()
        )
        self.db.commit()
        return dict(row), True
