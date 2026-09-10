"""Effective-dated AI rates approved for Spark usage metering.

Two providers. Azure OpenAI carries every model the app itself calls through
the APIM gateway; GitHub Copilot carries the models the game-generation worker
(``workers/game_gen``) reaches through the Copilot SDK, which bills Claude at
the provider's list price under usage-based billing. Pricing is matched on
(provider, deployment), so the same deployment name under two providers is
two rows — `gpt-5.4-mini` appears twice on purpose.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


AZURE_OPENAI_PRICING_SOURCE = (
    "https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/"
)
PRICING_EFFECTIVE_FROM = datetime(2026, 7, 11, tzinfo=timezone.utc)
PRICING_SOURCE_CHECKED_AT = datetime(2026, 7, 11, tzinfo=timezone.utc)

GITHUB_COPILOT_PRICING_SOURCE = "https://docs.github.com/en/copilot/concepts/billing"
GITHUB_COPILOT_PRICE_SCOPE = "GitHub Copilot usage-based (AI credits at provider list price)"
GITHUB_COPILOT_EFFECTIVE_FROM = datetime(2026, 9, 8, tzinfo=timezone.utc)
GITHUB_COPILOT_SOURCE_CHECKED_AT = datetime(2026, 9, 8, tzinfo=timezone.utc)


def _azure_openai_documents() -> list[dict[str, Any]]:
    """Global Standard pay-as-you-go rates per 1M tokens."""
    shared = {
        "provider": "azure_openai",
        "meter": "tokens",
        "unit_size": 1_000_000,
        "currency": "USD",
        "price_scope": "Global Standard",
        "source_url": AZURE_OPENAI_PRICING_SOURCE,
        "source_checked_at": PRICING_SOURCE_CHECKED_AT,
        "effective_from": PRICING_EFFECTIVE_FROM,
        "effective_to": None,
    }
    return [
        {
            **shared,
            "pricing_id": "azure-openai-gpt-5.4-global-standard-2026-07-11",
            "deployment": "gpt-5.4",
            "display_name": "GPT-5.4",
            "pricing_note": "Context shorter than 272K tokens",
            "input_usd_per_unit": 2.50,
            "cached_input_usd_per_unit": 0.25,
            "output_usd_per_unit": 15.00,
        },
        {
            **shared,
            "pricing_id": "azure-openai-gpt-5.4-mini-global-standard-2026-07-11",
            "deployment": "gpt-5.4-mini",
            "display_name": "GPT-5.4 mini",
            "pricing_note": None,
            "input_usd_per_unit": 0.75,
            "cached_input_usd_per_unit": 0.08,
            "output_usd_per_unit": 4.50,
        },
        {
            **shared,
            "pricing_id": "azure-openai-gpt-5-mini-global-standard-2026-07-11",
            "deployment": "gpt-5-mini",
            "display_name": "GPT-5 mini",
            "pricing_note": "Legacy fallback deployment",
            "input_usd_per_unit": 0.25,
            "cached_input_usd_per_unit": 0.03,
            "output_usd_per_unit": 2.00,
        },
    ]


def _github_copilot_documents() -> list[dict[str, Any]]:
    """Usage-based Copilot rates per 1M tokens — the game-generation worker."""
    shared = {
        "provider": "github_copilot",
        "meter": "tokens",
        "unit_size": 1_000_000,
        "currency": "USD",
        "price_scope": GITHUB_COPILOT_PRICE_SCOPE,
        "source_url": GITHUB_COPILOT_PRICING_SOURCE,
        "source_checked_at": GITHUB_COPILOT_SOURCE_CHECKED_AT,
        "effective_from": GITHUB_COPILOT_EFFECTIVE_FROM,
        "effective_to": None,
    }
    return [
        {
            **shared,
            "pricing_id": "github-copilot-claude-opus-5-usage-based-2026-09-08",
            "deployment": "claude-opus-5",
            "display_name": "Claude Opus 5 (Copilot)",
            "pricing_note": "Game builder (feature_7_learning_games); Anthropic list price",
            "input_usd_per_unit": 5.00,
            "cached_input_usd_per_unit": 0.50,
            "output_usd_per_unit": 25.00,
        },
        {
            **shared,
            "pricing_id": "github-copilot-gpt-5.4-mini-usage-based-2026-09-08",
            "deployment": "gpt-5.4-mini",
            "display_name": "GPT-5.4 mini (Copilot)",
            "pricing_note": "Game plan prepass and learning judge",
            "input_usd_per_unit": 0.75,
            "cached_input_usd_per_unit": 0.075,
            "output_usd_per_unit": 4.50,
        },
    ]


def pricing_documents() -> list[dict[str, Any]]:
    """Return every approved effective-dated rate, across providers."""
    return [*_azure_openai_documents(), *_github_copilot_documents()]
