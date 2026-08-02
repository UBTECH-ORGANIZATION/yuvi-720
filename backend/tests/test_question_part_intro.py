"""A later סעיף of a shared screen must not be greeted as a brand-new question.

Reported 29/07 on the four-targets screen: standing on the THIRD part, the
arrival intro opened with "השאלה עוסקת בדיוק ומהימנות דרך 4 מטרות קליעה… רוצה
שנתחיל יחד?" — the whole screen described again, as if the learner had just
walked in, when they had already worked through two parts of it.

The screen and the question are not the same unit. `part`/`part_total` carry the
learner's position inside a shared screen so the intro can continue rather than
restart, and are ABSENT on single-question screens: announcing "part 1 of 1"
would invent a structure that is not on screen.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _question_part  # noqa: E402
from app.brain import context_engine  # noqa: E402


POINTER = {
    "current_state": {
        "component_id": "c-05",
        "unit_id": "u-1",
        "item_id": "c-05-001",
        "question_id": "q3",
    },
    "goals": [],
    "identity": {"locale": "he"},
}

# The real shape of the four-targets screen: one item, four סעיפים.
FOUR_PARTS = [
    {"questionId": f"q{n}", "questionText": f"סעיף {n}"} for n in range(1, 5)
]
ONE_PART = [{"questionId": "q1", "questionText": "שאלה יחידה"}]


class QuestionPartRenderTests(unittest.TestCase):
    def test_a_later_part_is_reported_as_its_position(self):
        self.assertEqual(_question_part({"question": {"part": 3, "part_total": 4}}), "3/4")

    def test_the_first_part_is_still_reported(self):
        """The intro needs to know it IS the first one to open the screen."""
        self.assertEqual(_question_part({"question": {"part": 1, "part_total": 4}}), "1/4")

    def test_a_single_question_screen_reports_nothing(self):
        self.assertEqual(_question_part({"question": {"text": "x"}}), "—")

    def test_a_screen_claiming_one_of_one_reports_nothing(self):
        self.assertEqual(_question_part({"question": {"part": 1, "part_total": 1}}), "—")

    def test_no_question_reports_nothing(self):
        self.assertEqual(_question_part({}), "—")


class QuestionPartBundleTests(unittest.IsolatedAsyncioTestCase):
    async def _question(self, questions, question_id="q3"):
        pointer = {**POINTER, "current_state": {**POINTER["current_state"], "question_id": question_id}}
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=pointer)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": "c-05"}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=questions), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "lesson"},
            )
        return (bundle.get("current") or {}).get("question") or {}

    async def test_the_third_of_four_parts_knows_where_it_is(self):
        question = await self._question(FOUR_PARTS)
        self.assertEqual((question.get("part"), question.get("part_total")), (3, 4))

    async def test_the_first_part_is_position_one(self):
        question = await self._question(FOUR_PARTS, question_id="q1")
        self.assertEqual((question.get("part"), question.get("part_total")), (1, 4))

    async def test_a_single_question_screen_carries_no_part(self):
        question = await self._question(ONE_PART, question_id="q1")
        self.assertNotIn("part", question)
        self.assertNotIn("part_total", question)

    async def test_the_question_text_still_matches_the_part(self):
        """The position must not come at the cost of pointing at the wrong part."""
        question = await self._question(FOUR_PARTS)
        self.assertEqual(question.get("text"), "סעיף 3")

    async def test_a_question_id_this_screen_does_not_list_claims_no_position(self):
        """Falling back to "part 1" would tell a learner on part 3 that they had
        just arrived. The text may default; the POSITION is a claim, so it is
        withheld unless we actually located them."""
        question = await self._question(FOUR_PARTS, question_id="not-on-this-screen")
        self.assertNotIn("part", question)
        self.assertTrue(question.get("text"))

    async def test_no_question_id_at_all_claims_no_position(self):
        question = await self._question(FOUR_PARTS, question_id=None)
        self.assertNotIn("part", question)

    async def test_the_position_comes_from_order_not_from_the_id(self):
        """Ids are provider-defined: `a/b/c` and `Q_07` are as valid as `q1`."""
        lettered = [{"questionId": i, "questionText": f"סעיף {i}"} for i in ("a", "b", "c")]
        question = await self._question(lettered, question_id="b")
        self.assertEqual((question.get("part"), question.get("part_total")), (2, 3))


if __name__ == "__main__":
    unittest.main()
