"""Regression: two sub-questions on ONE Kata screen (e.g. סעיף א = …/q1 and
סעיף ב = …/q2) must be distinct to the companion.

The live bug: after two wrong tries Kata reveals the answer; the learner
continues to the next sub-question on the SAME screen and answers it — but the
chat neither reacted nor transformed. Cause: the screen/support key was
`component|item` (question_id dropped to avoid a `…|q1 ↔ …|` oscillation on bare
screen re-emits), so q1 and q2 collapsed to one key — no `screen_change`, and the
reaction was swallowed by the cross-question cooldown.

Fix: the key is now `component|item|question`, and `question_id` is kept STICKY
in `current_state` across bare re-emits, so it distinguishes q1/q2 without
reviving the oscillation. A real screen change also clears the reaction cooldowns
so the new question gets its first nudge.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import tutor_decision  # noqa: E402
from app.services import events, triggers  # noqa: E402


class SupportQuestionKeyTests(unittest.TestCase):
    def test_key_includes_question_so_q1_q2_differ(self) -> None:
        base = {"component_id": "comp-01", "item_id": "comp-01-001"}
        k1 = tutor_decision.support_question_key({**base, "question_id": "q1"}, "comp-01")
        k2 = tutor_decision.support_question_key({**base, "question_id": "q2"}, "comp-01")
        self.assertEqual(k1, "comp-01|comp-01-001|q1")
        self.assertEqual(k2, "comp-01|comp-01-001|q2")
        self.assertNotEqual(k1, k2)

    def test_missing_question_yields_trailing_empty(self) -> None:
        key = tutor_decision.support_question_key(
            {"component_id": "comp-01", "item_id": "comp-01-001", "question_id": None}, "comp-01"
        )
        self.assertEqual(key, "comp-01|comp-01-001|")


class StickyQuestionFoldTests(unittest.IsolatedAsyncioTestCase):
    """`_apply_event_to_brain` keeps question_id sticky and returns the effective
    identity used to build the screen_change key."""

    async def _fold(self, event: dict, prior_state: dict) -> tuple[dict, dict]:
        captured: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured["set"] = set_updates

        with (
            patch.object(events, "get_brain",
                         new=AsyncMock(return_value={"current_state": prior_state, "mastery": {}})),
            patch.object(events, "apply_brain_operators", new=AsyncMock(side_effect=fake_apply)),
            patch.object(events, "is_component_completion", return_value=False),
        ):
            effective = await events._apply_event_to_brain(event)
        return effective, captured.get("set", {})

    def _event(self, sub_item, question_id):
        # No objective_id → the mastery/scoring block is skipped; we exercise only
        # the current_state (sticky question) logic.
        return {
            "learner_id": "L", "verb": "answered", "launch": "comp-01",
            "unit_id": "unit-1", "sub_item_id": sub_item, "question_id": question_id,
        }

    async def test_new_screen_adopts_incoming_question(self) -> None:
        eff, sets = await self._fold(
            self._event("comp-01-002", None), {"item_id": "comp-01-001", "question_id": "q1"}
        )
        self.assertEqual(sets["current_state.item_id"], "comp-01-002")
        self.assertIsNone(sets["current_state.question_id"])
        self.assertIsNone(eff["question_id"])

    async def test_same_screen_advances_to_specific_question(self) -> None:
        # q1 → q2 on ONE screen: the exact bug scenario.
        eff, sets = await self._fold(
            self._event("comp-01-001", "q2"), {"item_id": "comp-01-001", "question_id": "q1"}
        )
        self.assertEqual(sets["current_state.question_id"], "q2")
        self.assertEqual(eff["question_id"], "q2")

    async def test_bare_reemit_keeps_sticky_question(self) -> None:
        # A screen re-emit (sub_item present, question None) must NOT clear q1 —
        # this is what used to oscillate the key.
        eff, sets = await self._fold(
            self._event("comp-01-001", None), {"item_id": "comp-01-001", "question_id": "q1"}
        )
        self.assertNotIn("current_state.question_id", sets)
        self.assertEqual(eff["question_id"], "q1")


class ScreenChangeCooldownResetTests(unittest.TestCase):
    def setUp(self) -> None:
        triggers._last_screen_key.clear()
        triggers._last_published.clear()
        triggers._last_mistake_key.clear()

    def test_screen_change_clears_reaction_cooldowns(self) -> None:
        import time
        triggers._last_published[("L", "mistake")] = time.monotonic()
        triggers._last_published[("L", "success")] = time.monotonic()
        triggers._last_mistake_key["L"] = "comp-01|comp-01-001|q1"
        with patch("app.services.triggers._publish"):
            triggers.publish_screen_change("L", "comp-01|comp-01-001|q2")
        # The new question is a fresh reaction context.
        self.assertNotIn(("L", "mistake"), triggers._last_published)
        self.assertNotIn(("L", "success"), triggers._last_published)
        self.assertNotIn("L", triggers._last_mistake_key)

    def test_same_key_is_a_noop(self) -> None:
        import time
        triggers._last_screen_key["L"] = "comp-01|comp-01-001|q1"
        triggers._last_published[("L", "mistake")] = time.monotonic()
        with patch("app.services.triggers._publish") as publish:
            triggers.publish_screen_change("L", "comp-01|comp-01-001|q1")
        publish.assert_not_called()
        # A same-screen no-op must NOT wipe the cooldown (would re-enable spam).
        self.assertIn(("L", "mistake"), triggers._last_published)


if __name__ == "__main__":
    unittest.main()
