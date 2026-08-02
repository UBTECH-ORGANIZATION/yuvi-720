"""Where the learner IS must follow the order things happened — not the order
Kata's relay delivered them.

From a real relayed batch, every statement received in the same second, its own
timestamps out of order and duplicated:

    12:24:23  initialized -003
    12:24:38  initialized -005
    12:24:26  initialized -004     ← older, arrived later
    12:24:23  initialized -003     ← duplicate

Folded by arrival, `current_state.item_id` ended up wherever the last-delivered
statement pointed. The learner was on -005; the coach thought they were on -004,
so an idle nudge opened a thread on a question they were not looking at.

Paging BACK must still work: Kata reports it (`initialized -003` right after
-004 at 12:10:57), and a genuinely newer event naming an earlier screen has to
move the pointer back.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


COMP = "methodica-science-mass-measure-01-01"


class PositionOrderingTests(unittest.IsolatedAsyncioTestCase):
    async def _fold(self, event: dict, prior_state: dict) -> dict:
        captured: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured["set"] = set_updates

        with (
            patch.object(events, "get_brain",
                         new=AsyncMock(return_value={"current_state": prior_state, "mastery": {}})),
            patch.object(events, "apply_brain_operators", new=AsyncMock(side_effect=fake_apply)),
            patch.object(events, "is_component_completion", return_value=False),
        ):
            await events._apply_event_to_brain(event)
        return captured.get("set", {})

    def _event(self, item_suffix: str, at: str, question_id=None, verb="enter"):
        return {
            "learner_id": "L", "verb": verb, "launch": COMP, "unit_id": "unit-1",
            "sub_item_id": f"{COMP}-{item_suffix}", "question_id": question_id,
            "occurred_at": f"2026-07-28T{at}+00:00",
        }

    def _state(self, item_suffix: str, at: str, question_id="q1"):
        return {
            "component_id": COMP, "item_id": f"{COMP}-{item_suffix}",
            "question_id": question_id, "at": f"2026-07-28T{at}+00:00",
        }

    # ── the batch problem ────────────────────────────────────────────────────

    async def test_a_late_arriving_older_event_does_not_move_the_learner(self):
        """The exact failure: -004 (12:24:26) arriving after -005 (12:24:38)."""
        sets = await self._fold(
            self._event("004", "12:24:26"), self._state("005", "12:24:38")
        )
        self.assertNotIn("current_state.item_id", sets)

    async def test_a_duplicate_replay_does_not_move_the_learner(self):
        sets = await self._fold(
            self._event("003", "12:24:23"), self._state("005", "12:24:38")
        )
        self.assertNotIn("current_state.item_id", sets)

    async def test_the_whole_out_of_order_batch_lands_on_the_true_last_screen(self):
        """Replay the real batch in its real (wrong) arrival order."""
        state = self._state("002", "12:24:18")
        arrival = [
            ("003", "12:24:23"), ("005", "12:24:38"), ("004", "12:24:26"),
            ("003", "12:24:23"),   # duplicate
        ]
        for suffix, at in arrival:
            sets = await self._fold(self._event(suffix, at), state)
            if "current_state.item_id" in sets:
                state = {
                    **state,
                    "item_id": sets["current_state.item_id"],
                    "at": sets.get("current_state.at", state["at"]),
                }
        self.assertEqual(state["item_id"], f"{COMP}-005")

    # ── paging back must keep working ────────────────────────────────────────

    async def test_paging_back_moves_the_pointer_back(self):
        """A NEWER event naming an EARLIER screen is the learner going back."""
        sets = await self._fold(
            self._event("003", "12:10:57"), self._state("004", "12:10:55")
        )
        self.assertEqual(sets["current_state.item_id"], f"{COMP}-003")

    async def test_paging_back_twice_in_a_row(self):
        state = self._state("004", "12:10:55")
        for suffix, at in (("003", "12:10:57"), ("002", "12:11:00")):
            sets = await self._fold(self._event(suffix, at), state)
            state = {**state, "item_id": sets["current_state.item_id"],
                     "at": sets["current_state.at"]}
        self.assertEqual(state["item_id"], f"{COMP}-002")

    async def test_answering_on_a_screen_the_learner_returned_to(self):
        """Back to -002, then answer it: the question pointer follows, not jumps."""
        sets = await self._fold(
            self._event("002", "12:11:30", question_id="q1", verb="answered"),
            self._state("002", "12:11:00"),
        )
        self.assertEqual(sets["current_state.question_id"], "q1")

    # ── degrade safely ───────────────────────────────────────────────────────

    async def test_events_without_a_timestamp_still_move_the_pointer(self):
        """No clock to compare — never freeze the learner's position."""
        event = self._event("003", "12:10:57")
        event.pop("occurred_at")
        sets = await self._fold(event, self._state("004", "12:10:55"))
        self.assertEqual(sets["current_state.item_id"], f"{COMP}-003")

    async def test_a_first_event_with_no_prior_position_is_adopted(self):
        sets = await self._fold(self._event("001", "12:00:00"), {})
        self.assertEqual(sets["current_state.item_id"], f"{COMP}-001")
        self.assertIn("current_state.at", sets)

    async def test_a_relaunch_clears_the_clock_and_unfreezes_the_learner(self):
        """The content restarts its own timeline; the pointer must not outlive it."""
        state = {**self._state("005", "12:24:38"), "at": None}   # what a new session leaves
        sets = await self._fold(self._event("001", "09:00:00"), state)
        self.assertEqual(sets["current_state.item_id"], f"{COMP}-001")

    async def test_a_different_lesson_is_never_blocked_by_the_previous_one(self):
        other = "methodica-science-mass-measure-01-02"
        event = self._event("001", "09:00:00")
        event["launch"] = other
        event["sub_item_id"] = f"{other}-001"
        sets = await self._fold(event, self._state("005", "12:24:38"))
        self.assertEqual(sets["current_state.item_id"], f"{other}-001")

    async def test_a_stale_answer_cannot_rewrite_the_question_pointer(self):
        event = {
            "learner_id": "L", "verb": "answered", "launch": COMP, "unit_id": "unit-1",
            "sub_item_id": None, "question_id": "q1",
            "occurred_at": "2026-07-28T12:24:26+00:00",
        }
        sets = await self._fold(event, self._state("005", "12:24:38", question_id="q2"))
        self.assertNotIn("current_state.question_id", sets)


if __name__ == "__main__":
    unittest.main()
