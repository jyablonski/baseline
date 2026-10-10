"""Select the NLP backend from settings. Default is the in-house rules engine."""

from __future__ import annotations

from baseline_analytics.operations import CubeAnalytics
from services.nlp.llm_client import LlmClient
from services.nlp.llm_provider import LlmNlpProvider
from services.nlp.protocol import NlpProvider
from services.nlp.rules import RulesNlpProvider

from config import Settings, get_settings

VALID_BACKENDS = frozenset({"rules", "llm"})


def build_nlp_provider(
    *,
    cube: CubeAnalytics,
    settings: Settings | None = None,
    llm_client: LlmClient | None = None,
) -> NlpProvider:
    resolved = settings or get_settings()
    backend = (resolved.nlp_backend or "rules").strip().lower()
    if backend not in VALID_BACKENDS:
        raise ValueError(f"Unknown NLP_BACKEND={resolved.nlp_backend!r}. Use 'rules' or 'llm'.")
    if backend == "llm":
        return LlmNlpProvider(cube, settings=resolved, client=llm_client)
    return RulesNlpProvider(cube)
