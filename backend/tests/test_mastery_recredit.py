"""Walking backwards through a finished lesson must not inflate mastery.

Measured 29/07 after a full run of `…-01-01`: six answered questions, all
correct, and the brain held

    attempts 6 · successes 20 · level advanced

`attempts` only counts `answered`/`attempted`, but `successes` counted every
scoring verb — and Kata re-emits `completed success=true` for EVERY screen the
learner pages back through (one walk backwards produced seven of them). The ratio
is impossible, and it fed `confidence`, `consecutive_successes`, `achieved` and
`level`: mastery invented by navigation instead of earned by evidence, which the
"numbers are never invented" rule forbids.

A genuine `answered` is always new evidence and is never gated.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


COMP = "methodica-science-mass-measure-01-01"
OBJ = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE"


def _event(verb, *, item=f"{COMP}-001", session="s1", success=True):
    return {
        "learner_id": "L", "verb": verb, "launch": COMP, "unit_id": "u",
        "objective_id": OBJ, "subject": "science", "sub_item_id": item,
        "question_id": "q1" if verb == "answered" else None,
        "session_id": session, "result": {"success": success, "score": {"scaled": 1.0}},
        "occurred_at": "2026-07-29T09:00:00.000Z",
    }


class CreditKeyTests(unittest.TestCase):
    def test_a_completion_is_identified_by_sitting_and_screen(self):
        key = events._completion_credit_key(_event("completed"))
        self.assertEqual(key, f"s1|{COMP}-001")

    def test_an_answer_is_never_gated(self):
        state = {"scored_screens": [f"s1|{COMP}-001"]}
        self.assertFalse(events._already_credited(_event("answered"), state))

    def test_a_repeat_completion_of_the_same_screen_is(self):
        state = {"scored_screens": [f"s1|{COMP}-001"]}
        self.assertTrue(events._already_credited(_event("completed"), state))

    def test_a_different_screen_is_its_own_evidence(self):
        state = {"scored_screens": [f"s1|{COMP}-001"]}
        self.assertFalse(
            events._already_credited(_event("completed", item=f"{COMP}-002"), state)
        )

    def test_a_new_sitting_starts_fresh(self):
        state = {"scored_screens": [f"s1|{COMP}-001"]}
        self.assertFalse(
            events._already_credited(_event("completed", session="s2"), state)
        )


class FoldTests(unittest.IsolatedAsyncioTestCase):
    async def _fold(self, event, prior):
        captured: dict = {}
        incs: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured.update(set_updates or {})
            incs.update(inc_updates or {})

        with (
            mock.patch.object(events, "get_brain",
                              new=AsyncMock(return_value={"current_state": prior, "mastery": {}})),
            mock.patch.object(events, "apply_brain_operators", new=AsyncMock(side_effect=fake_apply)),
            mock.patch.object(events, "get_recent_events", new=AsyncMock(return_value=[])),
            mock.patch.object(events, "is_component_completion", return_value=False),
        ):
            await events._apply_event_to_brain(event)
        return captured, incs

    async def test_the_first_completion_counts(self):
        _, incs = await self._fold(_event("completed"), {"component_id": COMP})
        self.assertTrue(any(k.endswith(".successes") for k in incs))

    async def test_and_is_remembered_so_it_cannot_count_twice(self):
        updates, _ = await self._fold(_event("completed"), {"component_id": COMP})
        self.assertEqual(
            updates.get("current_state.scored_screens"), [f"s1|{COMP}-001"]
        )

    async def test_the_completion_that_follows_an_answer_adds_nothing(self):
        """Kata reports each question twice: `answered …/q1`, then `completed …`.

        Counting both gave the objective two verdicts for one attempt — measured
        live as `attempts 13 · successes 15 · failures 6`.
        """
        updates, _ = await self._fold(_event("answered"), {"component_id": COMP})
        prior = {"component_id": COMP, "scored_screens": updates["current_state.scored_screens"]}
        _, incs = await self._fold(_event("completed"), prior)
        self.assertFalse(any(k.endswith(".successes") for k in incs))

    async def test_a_closed_unit_that_only_reports_its_completion_still_counts(self):
        """720 §3.2 allows a component that routes internally and reports once.

        Its completion is its ONLY evidence, so it must never be gated away.
        """
        _, incs = await self._fold(_event("completed"), {"component_id": COMP})
        self.assertTrue(any(k.endswith(".successes") for k in incs))
        self.assertTrue(any(k.endswith(".attempts") for k in incs))

    async def test_paging_back_through_it_does_not(self):
        prior = {"component_id": COMP, "scored_screens": [f"s1|{COMP}-001"]}
        updates, incs = await self._fold(_event("completed"), prior)
        self.assertFalse(any(k.endswith(".successes") for k in incs))
        self.assertFalse(any(k.startswith("mastery.") for k in updates))

    async def test_but_answering_it_again_still_does(self):
        prior = {"component_id": COMP, "scored_screens": [f"s1|{COMP}-001"]}
        _, incs = await self._fold(_event("answered"), prior)
        self.assertTrue(any(k.endswith(".attempts") for k in incs))
        self.assertTrue(any(k.endswith(".successes") for k in incs))


if __name__ == "__main__":
    unittest.main()
