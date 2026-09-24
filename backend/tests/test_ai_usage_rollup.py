"""The token/cost roll-ups behind scripts/ai_usage_report.py, and the llm
gateway's two measurement seams (the observer list, the `extra` allow-list)."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import ai_usage_rollup as rollup  # noqa: E402
from app.services import llm  # noqa: E402


def _event(**overrides):
    base = {"operation": "coach.reply", "deployment": "gpt-5.4-mini",
            "meter": "tokens", "input_tokens": 4000, "cached_input_tokens": 2000,
            "output_tokens": 40, "reasoning_tokens": 0, "latency_ms": 900,
            "exchange_id": "x1"}
    return {**base, **overrides}


class CostIsExactOrMarkedEstimated(unittest.TestCase):
    def test_recorded_cost_wins(self):
        self.assertEqual(rollup.event_cost(_event(cost_usd=0.5)), (0.5, False))

    def test_missing_cost_is_priced_with_the_cached_discount(self):
        cost, estimated = rollup.event_cost(_event())
        # 2000 uncached × 0.75 + 2000 cached × 0.08 + 40 out × 4.5, per 1M
        self.assertAlmostEqual(cost, (2000 * 0.75 + 2000 * 0.08 + 40 * 4.5) / 1e6)
        self.assertTrue(estimated)

    def test_an_unknown_deployment_is_not_invented(self):
        self.assertEqual(rollup.event_cost(_event(deployment="mystery")), (0.0, False))

    def test_cached_can_never_exceed_input(self):
        cost, _ = rollup.event_cost(_event(input_tokens=100, cached_input_tokens=900,
                                           output_tokens=0))
        self.assertAlmostEqual(cost, 100 * 0.08 / 1e6)


class RollupsGroupAndRank(unittest.TestCase):
    def test_groups_rank_by_cost_with_shares_and_cache_rate(self):
        rows = rollup.rollup([
            _event(operation="lesson_coach.tool_plan.0"),
            _event(operation="lesson_coach.tool_plan.0"),
            _event(operation="coach.title", input_tokens=100, cached_input_tokens=0,
                   output_tokens=10),
        ])
        self.assertEqual(rows[0]["key"], "lesson_coach.tool_plan.0")
        self.assertEqual(rows[0]["calls"], 2)
        self.assertEqual(rows[0]["cached_share"], 0.5)
        self.assertAlmostEqual(sum(r["share"] for r in rows), 1.0, places=3)

    def test_compare_normalizes_windows_per_day(self):
        before = rollup.rollup([_event()] * 14)
        after = rollup.rollup([_event(input_tokens=2000, cached_input_tokens=1000)] * 7)
        row = rollup.compare(before, after, before_days=14, after_days=7)[0]
        self.assertEqual(row["calls_per_day"], (1.0, 1.0))
        self.assertLess(row["delta_cost_per_day"], 0)

    def test_per_exchange_counts_planning_rounds(self):
        turns = rollup.per_exchange([
            _event(operation="lesson_coach.tool_plan.0"),
            _event(operation="coach.reply"),
            _event(operation="coach.reply", exchange_id=""),
        ])
        self.assertEqual(turns["x1"]["calls"], 2)
        self.assertEqual(turns["x1"]["planning_calls"], 1)


class TheGatewaySeams(unittest.TestCase):
    def test_production_registers_no_observer(self):
        """An observer sees prompts; only the eval (outside app/) may add one."""
        from pathlib import Path

        app_dir = Path(llm.__file__).resolve().parents[1]
        callers = [
            str(path.relative_to(app_dir)) for path in app_dir.rglob("*.py")
            if "register_observer(" in path.read_text(encoding="utf-8")
            and path.name != "llm.py"
        ]
        self.assertEqual(callers, [])

    def test_extra_passes_only_the_allow_list(self):
        body = {}
        llm._apply_extra(body, {"prompt_cache_key": "k", "temperature": 2,
                                "reasoning_effort": None, "messages": []})
        self.assertEqual(body, {"prompt_cache_key": "k"})

    def test_an_observer_sees_a_call_and_can_be_removed(self):
        seen = []
        remove = llm.register_observer(seen.append)
        try:
            with mock.patch.object(llm, "_resolve_llm_config",
                                   return_value=("", "", "gpt-5.4-mini", "v")), \
                    mock.patch.object(llm, "record_usage", mock.AsyncMock()):
                asyncio.run(llm.call_llm(
                    [{"role": "user", "content": "hi"}],
                    usage_context=mock.Mock(operation="op", exchange_id="e")))
        finally:
            remove()
        self.assertEqual(llm._OBSERVERS, [])
        # no endpoint configured → the call returns before any provider round
        # trip, and nothing is reported for a request that never happened
        self.assertEqual(seen, [])


if __name__ == "__main__":
    unittest.main()
