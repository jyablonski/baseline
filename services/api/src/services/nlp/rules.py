"""In-house, fully codified NLP backend (default for public /ask)."""

from __future__ import annotations

from baseline_analytics.operations import CubeAnalytics
from services.nl_query import NaturalLanguageQueryService

from schemas.game import QueryResponse


class RulesNlpProvider:
    """Wraps the regex/alias engine. No LLM, no third-party keys."""

    def __init__(self, cube: CubeAnalytics) -> None:
        self._engine = NaturalLanguageQueryService(cube)

    def classify(self, question: str) -> str:
        return self._engine.classify(question)

    def answer(self, question: str, season: str | None = None) -> QueryResponse:
        return self._engine.answer(question, season=season)
