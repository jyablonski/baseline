"""Signed-in chat: quota, backend choice, and the usage ledger around one ask."""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from cube.analytics import CubeAnalytics
from services.nlp.llm_client import LlmClient
from services.nlp.llm_provider import LlmNlpProvider
from services.nlp.rules import RulesNlpProvider

from config import Settings
from repositories.account import AccountRepository
from schemas.account import ChatMessage, ChatQuota, ChatResponse

EASTERN = ZoneInfo("America/New_York")

# Written here, not by the model: an answer with no rows behind it is replaced
# rather than trusted.
NO_DATA_ANSWER = (
    "I don't have that. I can only answer from Baseline's NBA data, "
    "and nothing in it matched that question."
)


class ChatRequestError(ValueError):
    """The conversation as sent cannot be answered. The message is for the user.

    Its own type on purpose: a bare ValueError also covers a provider reply
    that will not parse, which is not the caller's mistake.
    """


class ConversationFullError(ChatRequestError):
    """The conversation has reached its turn cap."""


def next_reset(now: datetime | None = None) -> datetime:
    local = (now or datetime.now(EASTERN)).astimezone(EASTERN)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight + timedelta(days=1)


def chat_quota(repo: AccountRepository, user_id: UUID, settings: Settings) -> ChatQuota:
    used = repo.count_chat_today(user_id)
    return ChatQuota(
        daily_limit=settings.chat_daily_limit,
        remaining=max(0, settings.chat_daily_limit - used),
        resets_at=next_reset(),
        max_turns=settings.chat_max_turns,
    )


def run_chat(
    *,
    user_id: UUID,
    messages: list[ChatMessage],
    season: str | None,
    repo: AccountRepository,
    cube: CubeAnalytics,
    settings: Settings,
    llm_client: LlmClient | None = None,
) -> ChatResponse:
    if messages[-1].role != "user":
        raise ChatRequestError("The conversation must end on a question.")
    questions = sum(1 for message in messages if message.role == "user")
    if questions > settings.chat_max_turns:
        raise ConversationFullError(
            f"A conversation holds {settings.chat_max_turns} questions. Start a new one to keep going."
        )

    # Raises before any model call when the day is spent or an ask is running.
    usage_id = repo.reserve_chat(user_id, daily_limit=settings.chat_daily_limit)

    started = time.monotonic()
    use_llm = False
    input_tokens = output_tokens = tool_rounds = 0
    # Everything after the reservation is inside the try: whatever fails, the
    # pending row is settled, or it would hold the user's one slot for minutes.
    try:
        # With no key, or with the shared daily budget spent, chat still
        # answers, from the free rules backend.
        use_llm = bool(llm_client or settings.nlp_llm_api_key) and (
            repo.count_llm_chat_today() < settings.chat_global_daily_limit
        )
        # The count above opened a transaction. Close it before the model call,
        # which can run for minutes and would otherwise hold a pooled
        # connection the public pages need.
        repo.release()
        if use_llm:
            provider = LlmNlpProvider(cube, settings=settings, client=llm_client, chat=True)
            conversation = provider.converse(
                [{"role": message.role, "content": message.content} for message in messages],
                season=season,
            )
            response = conversation.response
            input_tokens = conversation.input_tokens
            output_tokens = conversation.output_tokens
            tool_rounds = conversation.tool_rounds
        else:
            response = RulesNlpProvider(cube).answer(messages[-1].content, season=season)
    except Exception:
        repo.settle_chat(
            usage_id,
            outcome="errored",
            backend="llm" if use_llm else "rules",
            latency_ms=int((time.monotonic() - started) * 1000),
        )
        raise

    backend = "llm" if use_llm else "rules"
    answered = bool(response.data)
    repo.settle_chat(
        usage_id,
        outcome="answered" if answered else "refused",
        backend=backend,
        model=settings.nlp_llm_model if use_llm else None,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        tool_rounds=tool_rounds,
        latency_ms=int((time.monotonic() - started) * 1000),
    )
    return ChatResponse(
        # The rules backend words its own "can't answer that"; only the model's
        # prose is replaced when nothing backs it.
        answer=response.answer if answered or not use_llm else NO_DATA_ANSWER,
        data=response.data,
        source=response.sql,
        backend=backend,
        quota=chat_quota(repo, user_id, settings),
    )
