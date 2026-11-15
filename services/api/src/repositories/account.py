from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from queries.account import (
    ADD_FOLLOW,
    COUNT_CHAT_TODAY,
    COUNT_LLM_CHAT_TODAY,
    DELETE_FOLLOW,
    DELETE_PICK,
    DELETE_USER,
    EXPIRE_STALE_CHAT,
    GET_USER,
    IS_FOLLOWING,
    LIST_FOLLOWS,
    LIST_PICKS,
    PICK_GAME,
    REORDER_FOLLOWS,
    RESERVE_CHAT,
    SET_USER_TIMEZONE,
    SETTLE_CHAT,
    TEAM_EXISTS,
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


class FollowNotFoundError(LookupError):
    """The team to follow is not in the league. The message is safe to show."""


class FollowLimitError(RuntimeError):
    """The account already follows as many as it may. The message is safe to show."""


class FollowOrderError(ValueError):
    """A new order that is not exactly the followed set. The message is safe to show."""


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
    # Wins against the market's expectation over the settled picks that had a
    # line: the sum of each picked side's no-vig probability is how many of
    # them the odds expected to win. Picks with no line count on neither side.
    market_games = market_wins = 0
    expected_wins = 0.0
    for pick in picks:
        market_wp = pick.get("market_wp")
        if market_wp is not None and pick["result"] in ("won", "lost"):
            market_games += 1
            market_wins += int(pick["result"] == "won")
            expected_wins += market_wp
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
        "market_games": market_games,
        "expected_wins": round(expected_wins, 2),
        "vs_market": round(market_wins - expected_wins, 2),
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

    def list_follows(self, user_id: UUID) -> list[dict]:
        rows = self.db.execute(LIST_FOLLOWS, {"user_id": user_id}).mappings().all()
        return [dict(row) for row in rows]

    def follow(self, user_id: UUID, *, entity_type: str, entity_id: UUID, max_follows: int) -> None:
        """Follow a team. Following one already followed changes nothing."""
        params = {"user_id": user_id, "entity_type": entity_type, "entity_id": entity_id}
        if not self.db.execute(TEAM_EXISTS, {"entity_id": entity_id}).scalar_one():
            self.db.rollback()
            raise FollowNotFoundError("That team is not in the league.")
        added = self.db.execute(ADD_FOLLOW, {**params, "max_follows": max_follows}).first()
        if added is None and not self.db.execute(IS_FOLLOWING, params).scalar_one():
            self.db.rollback()
            raise FollowLimitError(
                f"You can follow up to {max_follows} teams. Unfollow one to add another."
            )
        self.db.commit()

    def reorder_follows(self, user_id: UUID, *, entity_type: str, entity_ids: list[UUID]) -> None:
        """Set the order to `entity_ids`, which must be exactly what is followed."""
        current = {
            follow["entity_id"]
            for follow in self.list_follows(user_id)
            if follow["entity_type"] == entity_type
        }
        if len(entity_ids) != len(current) or set(entity_ids) != current:
            self.db.rollback()
            raise FollowOrderError("The list of teams has changed. Reload and try again.")
        self.db.execute(
            REORDER_FOLLOWS,
            {"user_id": user_id, "entity_type": entity_type, "entity_ids": entity_ids},
        )
        self.db.commit()

    def unfollow(self, user_id: UUID, *, entity_type: str, entity_id: UUID) -> None:
        params = {"user_id": user_id, "entity_type": entity_type, "entity_id": entity_id}
        self.db.execute(DELETE_FOLLOW, params)
        self.db.commit()

    def delete_user(self, user_id: UUID) -> None:
        # chat_usage, picks and follows go with it: all reference users ON DELETE CASCADE.
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
