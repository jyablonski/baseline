from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from queries.account import (
    COUNT_CHAT_TODAY,
    COUNT_LLM_CHAT_TODAY,
    DELETE_PICK,
    DELETE_USER,
    EXPIRE_STALE_CHAT,
    GET_USER,
    LIST_PICKS,
    PICK_GAME,
    RESERVE_CHAT,
    SET_USER_TIMEZONE,
    SETTLE_CHAT,
    UPSERT_PICK,
    UPSERT_USER,
)
from repositories.games import american_moneyline


class ChatInFlightError(RuntimeError):
    """The user already has an ask running.

    Enforced by a partial unique index, the same way admin_jobs allows one
    pending job: a read-then-write check would let two fast requests through.
    """


class ChatQuotaExceededError(RuntimeError):
    """The user has used every ask for the current ET day."""


class PickError(ValueError):
    """A pick the rules do not allow. The message is safe to show the user."""


def pick_profit_cents(stake: int, moneyline: int) -> int:
    """What a winning stake of whole dollars returns on top of itself, in cents.

    Rounded down to the cent, and kept in integer cents so a season of stakes
    sums exactly.
    """
    if moneyline > 0:
        return stake * moneyline
    return stake * 100 * 100 // abs(moneyline)


def summarise_picks(picks: list[dict]) -> dict:
    # Net against the model over the games both called: +1 where the pick won
    # and the model's favourite lost, -1 the other way round. Agreeing, right
    # or wrong, moves nothing.
    vs_model = model_games = 0
    for pick in picks:
        model_correct = pick.get("model_correct")
        if model_correct is not None and pick["result"] in ("won", "lost"):
            model_games += 1
            vs_model += int(pick["result"] == "won") - int(model_correct)
    return {
        "wins": sum(1 for pick in picks if pick["result"] == "won"),
        "losses": sum(1 for pick in picks if pick["result"] == "lost"),
        "pending": sum(1 for pick in picks if pick["result"] == "pending"),
        # There is no balance: an account starts at nothing, so the only money
        # figure is what its settled stakes have won and lost.
        "net": sum(pick["profit_cents"] or 0 for pick in picks) / 100,
        "staked_open": sum(pick["stake"] or 0 for pick in picks if pick["result"] == "pending"),
        "vs_model": vs_model,
        "model_games": model_games,
    }


class AccountRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def upsert_user(
        self, *, provider: str, provider_subject: str, display_name: str | None
    ) -> dict:
        row = (
            self.db.execute(
                UPSERT_USER,
                {
                    "provider": provider,
                    "provider_subject": provider_subject,
                    "display_name": display_name,
                },
            )
            .mappings()
            .one()
        )
        self.db.commit()
        return dict(row)

    def get_user(self, user_id: UUID) -> dict | None:
        row = self.db.execute(GET_USER, {"user_id": user_id}).mappings().one_or_none()
        return dict(row) if row is not None else None

    def set_timezone(self, user_id: UUID, timezone: str | None) -> dict:
        row = (
            self.db.execute(SET_USER_TIMEZONE, {"user_id": user_id, "timezone": timezone})
            .mappings()
            .one()
        )
        self.db.commit()
        return dict(row)

    def delete_user(self, user_id: UUID) -> None:
        # chat_usage and picks go with it: both reference users ON DELETE CASCADE.
        self.db.execute(DELETE_USER, {"user_id": user_id})
        self.db.commit()

    def count_chat_today(self, user_id: UUID) -> int:
        return int(self.db.execute(COUNT_CHAT_TODAY, {"user_id": user_id}).scalar_one())

    def count_llm_chat_today(self) -> int:
        return int(self.db.execute(COUNT_LLM_CHAT_TODAY).scalar_one())

    def release(self) -> None:
        """End the open read transaction, handing its connection back to the pool."""
        self.db.commit()

    def reserve_chat(self, user_id: UUID, *, daily_limit: int) -> int:
        self.db.execute(EXPIRE_STALE_CHAT, {"user_id": user_id})
        try:
            usage_id = self.db.execute(
                RESERVE_CHAT, {"user_id": user_id, "daily_limit": daily_limit}
            ).scalar()
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ChatInFlightError("Wait for your last question to finish.") from exc
        if usage_id is None:
            raise ChatQuotaExceededError("You have used all of today's questions.")
        return int(usage_id)

    def settle_chat(
        self,
        usage_id: int,
        *,
        outcome: str,
        backend: str | None,
        model: str | None = None,
        input_tokens: int = 0,
        output_tokens: int = 0,
        tool_rounds: int = 0,
        latency_ms: int | None = None,
    ) -> None:
        self.db.execute(
            SETTLE_CHAT,
            {
                "usage_id": usage_id,
                "outcome": outcome,
                "backend": backend,
                "model": model,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "tool_rounds": tool_rounds,
                "latency_ms": latency_ms,
            },
        )
        self.db.commit()

    def list_picks(self, user_id: UUID) -> list[dict]:
        rows = self.db.execute(LIST_PICKS, {"user_id": user_id}).mappings().all()
        picks = []
        for row in rows:
            pick = dict(row)
            stake, result = pick["stake"], pick["result"]
            # Winnings, the stake as a loss, or nothing while open or void.
            if not stake or result in ("pending", "void"):
                cents = None
            elif result == "won":
                cents = pick_profit_cents(stake, pick["moneyline"])
            else:
                cents = -stake * 100
            pick["profit_cents"] = cents
            pick["profit"] = None if cents is None else cents / 100
            picks.append(pick)
        return picks

    def save_pick(
        self, user_id: UUID, *, game_id: UUID, picked_team_id: UUID, stake: int | None = None
    ) -> None:
        try:
            game = self._open_game(game_id)
            if picked_team_id == game["home_team_id"]:
                moneyline = american_moneyline(game["home_implied_wp"])
            elif picked_team_id == game["away_team_id"]:
                moneyline = american_moneyline(game["away_implied_wp"])
            else:
                raise PickError("That team is not playing in this game.")
            if stake is not None and moneyline is None:
                raise PickError("No moneyline is posted for this game yet, so it takes no stake.")
            self.db.execute(
                UPSERT_PICK,
                {
                    "user_id": user_id,
                    "game_id": game_id,
                    "picked_team_id": picked_team_id,
                    "stake": stake,
                    "moneyline": moneyline,
                },
            )
            self.db.commit()
        except PickError:
            self.db.rollback()
            raise

    def delete_pick(self, user_id: UUID, game_id: UUID) -> None:
        try:
            self._open_game(game_id)
            self.db.execute(DELETE_PICK, {"user_id": user_id, "game_id": game_id})
            self.db.commit()
        except PickError:
            self.db.rollback()
            raise

    def _open_game(self, game_id: UUID) -> dict:
        game = self.db.execute(PICK_GAME, {"game_id": game_id}).mappings().one_or_none()
        if game is None:
            raise PickError("That game is not on the schedule.")
        if game["is_locked"]:
            raise PickError("Picks for this game are locked.")
        return dict(game)
