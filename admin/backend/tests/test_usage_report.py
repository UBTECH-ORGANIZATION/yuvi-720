"""Privacy and exact-meter aggregation tests for the admin report."""

from datetime import datetime, timezone
import unittest

from backend.usage_report import build_usage_summary


class UsageReportTests(unittest.TestCase):
    def test_exact_usage_and_null_pricing_are_preserved(self) -> None:
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        summary = build_usage_summary(
            events=[{
                "event_id": "event-1",
                "started_at": now,
                "actor_id": "learner-opaque-1",
                "actor_type": "learner",
                "endpoint": "/api/agent/coach/stream",
                "feature": "F3",
                "operation": "coach.reply",
                "provider": "azure_openai",
                "deployment": "gpt-5-mini",
                "streaming": True,
                "meter": "tokens",
                "status": "completed",
                "usage_status": "exact",
                "input_tokens": 10,
                "output_tokens": 4,
                "total_tokens": 14,
                "quantity": None,
                "cost_usd": None,
                "latency_ms": 250,
            }],
            days=30,
            start=now,
            end=now,
            actor_id=None,
            endpoint=None,
        )
        self.assertEqual(summary.totals.total_tokens, 14)
        self.assertEqual(summary.totals.exact_usage_events, 1)
        self.assertEqual(summary.totals.unpriced_requests, 1)
        self.assertIsNone(summary.totals.cost_usd)
        self.assertFalse(hasattr(summary.recent[0], "prompt"))
        self.assertFalse(hasattr(summary.recent[0], "email"))
        self.assertEqual(summary.by_deployment[0].key, "gpt-5-mini")
        self.assertEqual(summary.by_feature[0].key, "F3")

    def test_speech_uses_character_quantity_not_tokens(self) -> None:
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        summary = build_usage_summary(
            events=[{
                "event_id": "event-2",
                "started_at": now,
                "actor_id": "learner-opaque-2",
                "meter": "characters",
                "quantity": 37,
                "status": "completed",
                "usage_status": "exact",
                "cost_usd": 0.01,
            }],
            days=7,
            start=now,
            end=now,
            actor_id=None,
            endpoint=None,
        )
        self.assertEqual(summary.totals.characters, 37)
        self.assertEqual(summary.totals.total_tokens, 0)
        self.assertEqual(summary.totals.cost_usd, 0.01)

    def test_pricing_catalog_is_exposed_without_secret_fields(self) -> None:
        now = datetime(2026, 7, 1, tzinfo=timezone.utc)
        summary = build_usage_summary(
            events=[],
            pricing=[{
                "pricing_id": "pricing-1",
                "provider": "azure_openai",
                "deployment": "gpt-5.4-mini",
                "display_name": "GPT-5.4 mini",
                "meter": "tokens",
                "unit_size": 1_000_000,
                "input_usd_per_unit": 0.75,
                "cached_input_usd_per_unit": 0.08,
                "output_usd_per_unit": 4.50,
                "currency": "USD",
                "price_scope": "Global Standard",
                "source_url": "https://azure.microsoft.com/pricing",
                "source_checked_at": now,
                "effective_from": now,
                "api_key": "must-not-leak",
            }],
            days=7,
            start=now,
            end=now,
            actor_id=None,
            endpoint=None,
        )

        self.assertEqual(summary.pricing[0].input_usd_per_unit, 0.75)
        self.assertFalse(hasattr(summary.pricing[0], "api_key"))


if __name__ == "__main__":
    unittest.main()
