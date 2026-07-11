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


if __name__ == "__main__":
    unittest.main()
