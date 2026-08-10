"""The daily brief: windowed, capped, grounded, and honest with no model.

Four properties, all of which a teacher would notice being wrong:

1. **The window is since the last brief.** If it drifts, the brief either repeats
   what the teacher already read or silently skips days they were away for.
2. **It regenerates at most once a day.** Without the gate this is an LLM call
   per page refresh, and a subtly different story every time.
3. **A line with no cited signal never ships.** Same `because` gate as the digest
   this replaces — unfalsifiable narration is the failure mode of any summary.
4. **The model does not choose the children.** Every action's `learner_ids`
   comes from mastery evidence, not from generated text. This is the one that
   would be a real incident, so it is asserted directly.
"""

from __future__ import annotations

import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import daily_brief

NOW = datetime(2026, 8, 9, 8, 0, tzinfo=timezone.utc)

FACTS_SNAPSHOT = {
    "trends": {"students_total": 12, "active_last_7d": 10,
               "needing_attention": 3, "not_started": 2,
               "objectives_mastered_total": 5},
    "attention": [
        {"learner_id": "kid-a", "kind": "inactive"},
        {"learner_id": "kid-b", "kind": "wellbeing"},
    ],
}
GAPS = [{
    "objective_id": "obj-1", "subject": "math", "label": "מערכת צירים",
    "struggling_count": 4, "mastered_count": 1, "with_evidence": 9,
    "kind": "gap", "learner_ids": ["kid-c", "kid-d", "kid-e", "kid-f"],
}]


def _analytics(llm_response=None):
    """Stub every source the brief reads, plus the provider."""
    return (
        patch("app.services.insights.group_insights",
              AsyncMock(return_value=FACTS_SNAPSHOT)),
        patch("app.services.group_analytics.engagement",
              AsyncMock(return_value={"active_students": 10, "active_pct": 83,
                                      "avg_active_minutes": 12.0, "timing_available": True})),
        patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=GAPS)),
        patch("app.services.moments.moments_for_group", AsyncMock(return_value=[])),
        patch("app.services.llm.call_llm", AsyncMock(return_value=llm_response)),
    )


class WindowTests(unittest.TestCase):
    def test_no_prior_brief_looks_back_a_week(self):
        self.assertEqual(daily_brief.window_days(None), daily_brief.DEFAULT_WINDOW_DAYS)

    def test_a_partial_day_still_counts_as_a_day(self):
        """A teacher back after eight hours must not get a zero-day window."""
        self.assertEqual(daily_brief.window_days(NOW - timedelta(hours=8), NOW), 1)

    def test_the_window_rounds_up_to_cover_the_whole_gap(self):
        self.assertEqual(daily_brief.window_days(NOW - timedelta(days=2, hours=12), NOW), 3)

    def test_a_long_absence_is_clamped_to_what_analytics_can_answer(self):
        """A month away gets an honest fortnight, not a number that pretends."""
        self.assertEqual(
            daily_brief.window_days(NOW - timedelta(days=90), NOW), daily_brief.MAX_WINDOW_DAYS
        )


class FreshnessTests(unittest.TestCase):
    def test_a_brief_from_this_morning_is_still_fresh(self):
        cached = {"generated_at": (NOW - timedelta(hours=3)).isoformat()}
        self.assertTrue(daily_brief.is_fresh(cached, NOW))

    def test_a_brief_from_yesterday_is_stale(self):
        cached = {"generated_at": (NOW - timedelta(hours=25)).isoformat()}
        self.assertFalse(daily_brief.is_fresh(cached, NOW))

    def test_no_cache_is_never_fresh(self):
        self.assertFalse(daily_brief.is_fresh(None, NOW))
        self.assertFalse(daily_brief.is_fresh({}, NOW))


class GenerationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        daily_brief._tasks.clear()
        self._store = patch.object(daily_brief, "_store", AsyncMock())
        self._store.start()

    def tearDown(self):
        self._store.stop()
        daily_brief._tasks.clear()

    async def _brief(self, *, cached=None, llm=None, force=False):
        a, b, c, d, e = _analytics(llm)
        with a, b, c, d, e, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=cached)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            return await daily_brief.get_brief("teacher-a", "group-1", language="he")

    async def test_a_fresh_cache_is_served_without_calling_the_model(self):
        cached = {"_id": "x", "generated_at": (daily_brief._now()).isoformat(),
                  "headline": {"text": "cached"}, "bullets": [], "stats": [], "actions": []}
        a, b, c, d, llm = _analytics("{}")
        with a, b, c, d, llm, \
             patch.object(daily_brief, "_load", AsyncMock(return_value=cached)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        self.assertTrue(result["cached"])
        self.assertEqual(result["headline"]["text"], "cached")
        llm.new.assert_not_awaited()
        # The cache document key never leaks into the response body.
        self.assertNotIn("_id", result)

    async def test_a_stale_cache_regenerates_and_the_window_starts_there(self):
        stamp = (daily_brief._now() - timedelta(days=2)).isoformat()
        result = await self._brief(
            cached={"generated_at": stamp, "bullets": []},
            llm=json.dumps({"headline": {"text": "כותרת", "because": {"signal": "active_in_window", "value": 10}},
                            "bullets": []}),
        )
        self.assertFalse(result["cached"])
        # The property under test: the window starts where the last brief ended,
        # so nothing is repeated and nothing is skipped. The window rounds UP —
        # over-covering by a few hours beats missing them — and the exact
        # arithmetic is pinned against a fixed clock in `WindowTests`.
        self.assertEqual(result["since"], stamp)
        self.assertGreaterEqual(result["window_days"], 2)

    async def test_a_line_with_no_cited_signal_is_dropped(self):
        """Unfalsifiable narration is exactly what this panel must not print."""
        result = await self._brief(llm=json.dumps({
            "headline": {"text": "הכיתה בתנופה יפה"},                       # no because
            "bullets": [
                {"text": "יש מומנטום טוב"},                                  # no because
                {"text": "3 דורשים תשומת לב",
                 "because": {"signal": "needing_attention", "value": 3}},
            ],
        }))
        self.assertIsNone(result["headline"])
        self.assertEqual(len(result["bullets"]), 1)
        self.assertEqual(result["bullets"][0]["because"]["signal"], "needing_attention")

    async def test_no_model_still_produces_a_real_brief(self):
        result = await self._brief(llm=None)
        self.assertEqual(result["source"], "fallback")
        self.assertIsNotNone(result["headline"])
        self.assertTrue(result["bullets"])
        # Fallback lines are locale keys, never pre-rendered Hebrew from Python.
        self.assertTrue(all(line.get("text_key") for line in result["bullets"]))
        self.assertTrue(all(line["because"]["signal"] for line in result["bullets"]))

    async def test_the_model_never_chooses_which_children_an_action_is_about(self):
        """The incident this guards: a hallucinated id landing in an assignment."""
        result = await self._brief(llm=json.dumps({
            "headline": {"text": "כותרת", "because": {"signal": "needing_attention", "value": 3}},
            "bullets": [],
            # The model tries to hand back its own action list. It is ignored.
            "actions": [{"kind": "assign_subgroup", "learner_ids": ["kid-invented"]}],
        }))
        assigned = [a for a in result["actions"] if a["kind"] == "assign_subgroup"]
        self.assertTrue(assigned)
        self.assertEqual(assigned[0]["learner_ids"], GAPS[0]["learner_ids"])
        every_id = {i for action in result["actions"] for i in action["learner_ids"]}
        self.assertNotIn("kid-invented", every_id)

    async def test_actions_carry_the_evidence_they_were_built_from(self):
        result = await self._brief(llm=None)
        for action in result["actions"]:
            self.assertTrue(action["because"]["signal"])

    async def test_the_model_is_never_given_a_learner_id(self):
        """The prompt is built from counts; ids stay on this side of the wall."""
        captured: list[str] = []

        async def capture(messages, **kwargs):
            captured.append(messages[0]["content"])
            return None

        a, b, c, d, _ = _analytics()
        with a, b, c, d, patch("app.services.llm.call_llm", capture), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await daily_brief.get_brief("teacher-a", "group-1", language="he")

        prompt = captured[0]
        for learner_id in GAPS[0]["learner_ids"] + ["kid-a", "kid-b"]:
            self.assertNotIn(learner_id, prompt)

    async def test_an_empty_group_says_so_rather_than_inventing_a_brief(self):
        with patch("app.services.insights.group_insights",
                   AsyncMock(return_value={"trends": {"students_total": 0}, "attention": []})), \
             patch("app.services.group_analytics.engagement", AsyncMock(return_value={})), \
             patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=[])), \
             patch("app.services.moments.moments_for_group", AsyncMock(return_value=[])), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            result = await daily_brief.get_brief("teacher-a", "group-1", language="he")

        self.assertEqual(result["source"], "empty")
        self.assertEqual(result["reason"], "group_has_no_students")
        self.assertEqual(result["bullets"], [])

    async def test_two_tabs_share_one_generation(self):
        """A teacher's second tab must not double the bill."""
        import asyncio

        calls = 0

        async def counted(messages, **kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.02)
            return None

        a, b, c, d, _ = _analytics()
        with a, b, c, d, patch("app.services.llm.call_llm", counted), \
             patch.object(daily_brief, "_load", AsyncMock(return_value=None)), \
             patch.object(daily_brief, "_previous_login", AsyncMock(return_value=None)):
            await asyncio.gather(*(
                daily_brief.get_brief("teacher-a", "group-1", language="he")
                for _ in range(3)
            ))

        self.assertEqual(calls, 1)


if __name__ == "__main__":
    unittest.main()
