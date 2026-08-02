"""Praise is earned once per screen — walking back through it is not an event.

Reported 29/07: the learner went back to question 1, which they had already
answered correctly, pressed "המשך", and Yuvi congratulated them for it a second
time. Kata re-emits `completed` (success=true) every time a learner passes back
through a screen they finished, and the only guard was a 120s cooldown — long
gone by the time they wandered back.

A NEW `answered` is different: a second, genuine attempt at the same question is
exactly the moment worth celebrating, so it must still fire.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import triggers  # noqa: E402


COMP = "methodica-science-mass-measure-01-01"
ITEM = f"{COMP}-001"
OBJ = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE"


def _event(verb: str, *, success=True, item=ITEM, question="q1", session="s1"):
    return {
        "learner_id": "L", "verb": verb, "launch": COMP, "objective_id": OBJ,
        "sub_item_id": item, "question_id": question, "session_id": session,
        "result": {"success": success}, "effortful": True, "timing": {},
    }


class SuccessRepeatTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Module-level dedupe state is per-process; start every test clean.
        triggers._last_published.clear()
        triggers._success_acknowledged.clear()
        triggers._last_streak_session.clear()
        # The acknowledgement is ALSO persisted (a reload or a second worker must
        # not forget). Back it with a dict here so the test neither touches the
        # real brain nor leaks state into the next test.
        self.brain: dict[str, object] = {"current_state": {}}

        async def _get_brain(_learner_id=None):
            return self.brain

        async def _apply(_learner_id, set_fields, inc_fields=None):
            for path, value in set_fields.items():
                if path == "current_state.praised_screens":
                    self.brain["current_state"]["praised_screens"] = value

        patches = [
            # `evaluate` imports these lazily from app.services.events.
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])),
            patch("app.services.events.get_session_events", new=AsyncMock(return_value=[])),
            patch("app.services.events.is_component_completion", return_value=False),
            patch("app.brain.repository.get_brain", new=_get_brain),
            patch("app.brain.repository.apply_brain_operators", new=_apply),
            patch.object(triggers, "_publish", lambda *a, **k: None),
            patch.object(triggers, "_arm_idle", lambda *a, **k: None),
            patch.object(triggers, "_cancel_idle", lambda *a, **k: None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    async def _fire(self, event):
        return await triggers.evaluate("L", event)

    async def test_the_first_completion_is_congratulated(self):
        fired = await self._fire(_event("completed"))
        self.assertEqual((fired or {}).get("type"), "success")

    async def test_the_completion_that_follows_the_answer_is_not_a_second_praise(self):
        """The shape that actually shipped broken.

        Kata sends `answered …-001/q1` and then, when the learner leaves the
        screen, `completed …-001` with NO question. The dedupe key used to
        include `question_id`, so those two never matched and the learner was
        congratulated twice for one question — the 120s cooldown was the only
        thing hiding it, and it expires.
        """
        first = await self._fire(_event("answered"))
        self.assertEqual((first or {}).get("type"), "success")
        triggers._last_published.clear()          # …minutes later, cooldown gone
        self.assertIsNone(await self._fire(_event("completed", question=None)))

    async def test_the_guard_survives_a_process_restart(self):
        """Only the brain is durable, so only the brain can hold this."""
        await self._fire(_event("answered"))
        triggers._last_published.clear()
        triggers._success_acknowledged.clear()    # a reload / another worker
        self.assertIsNone(await self._fire(_event("completed", question=None)))

    async def test_walking_back_through_it_later_is_not(self):
        await self._fire(_event("completed"))
        triggers._last_published.clear()          # …minutes later, cooldown long gone
        again = await self._fire(_event("completed"))
        self.assertIsNone(again)

    async def test_a_genuine_second_attempt_is_still_celebrated(self):
        """They answered it again — that is new evidence, not a re-emit."""
        await self._fire(_event("completed"))
        triggers._last_published.clear()
        again = await self._fire(_event("answered"))
        self.assertEqual((again or {}).get("type"), "success")

    async def test_the_second_sub_question_on_one_screen_is_its_own_success(self):
        """סעיף א then סעיף ב — same screen, two questions, two achievements.

        The dedupe key is screen-level, so this is the case that proves it does
        not swallow a real second answer.
        """
        await self._fire(_event("answered", question="q1"))
        triggers._last_published.clear()
        second = await self._fire(_event("answered", question="q2"))
        self.assertEqual((second or {}).get("type"), "success")

    async def test_a_different_screen_is_its_own_success(self):
        await self._fire(_event("completed"))
        triggers._last_published.clear()
        other = await self._fire(_event("completed", item=f"{COMP}-002"))
        self.assertEqual((other or {}).get("type"), "success")

    async def test_a_new_sitting_starts_fresh(self):
        """A later session on the same screen is a new run, not a re-emit."""
        await self._fire(_event("completed"))
        triggers._last_published.clear()
        later = await self._fire(_event("completed", session="s2"))
        self.assertEqual((later or {}).get("type"), "success")

    async def test_a_failed_completion_never_congratulates(self):
        self.assertIsNone(await self._fire(_event("completed", success=False)))


if __name__ == "__main__":
    unittest.main()
