"""Effective-dated Azure OpenAI rates approved for Spark usage metering."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


AZURE_OPENAI_PRICING_SOURCE = (
    "https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/"
)
PRICING_EFFECTIVE_FROM = datetime(2026, 7, 11, tzinfo=timezone.utc)
PRICING_SOURCE_CHECKED_AT = datetime(2026, 7, 11, tzinfo=timezone.utc)


def pricing_documents() -> list[dict[str, Any]]:
    """Return current Global Standard pay-as-you-go rates per 1M tokens."""
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