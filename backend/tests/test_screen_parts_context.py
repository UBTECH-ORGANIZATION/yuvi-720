"""A later part of a shared screen must still be introduced concretely.

A multi-part screen states its data ONCE, in the first part: `…-02-001` סעיף א
lists the three measurements, and סעיף ב is only "should they measure again?".
The bundle handed the coach the CURRENT part alone, so on סעיף ב it could not see
the numbers the learner was looking at — and its arrival intro collapsed into
filler that fit any question at all: *"now we need to look at a new question and
work out what it asks… let's start from the central piece of data"*, naming no
data because it had none.

The parts of the screen now ride along, text only.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _screen_parts  # noqa: E402
from app.brain import context_engine  # noqa: E402

PARTS = [
    {"questionId": "q1", "questionText": "סעיף א: שחר 12.1 גרם, פלג 12.0 גרם, עדן 18.7 גרם.",
     "answers": ["כן", "לא"], "correctAnswers": ["כן"]},
    {"questionId": "q2", "questionText": "סעיף ב: האם עליהם לבצע מדידה נוספת?",
     "answers": ["כן", "לא"], "correctAnswers": ["לא"]},
]

POINTER = {
    "current_state": {"component_id": "c", "unit_id": "u", "item_id": "c-001",
                      "question_id": "q2"},
    "goals": [], "identity": {"locale": "he"},
}


class ScreenPartsRendering(unittest.TestCase):
    def test_every_part_is_listed_with_the_current_one_marked(self):
        current = {"question": {"screen_parts": [
            {"part": 1, "text": "סעיף א", "current": False},
            {"part": 2, "text": "סעיף ב", "current": True},
        ]}}
        self.assertEqual(_screen_parts(current), "[1] סעיף א | [2*] סעיף ב")

    def test_a_single_question_screen_renders_nothing(self):
        """There are no siblings to show, and a one-item list would only add noise."""
        self.assertEqual(_screen_parts({"question": {"screen_parts": []}}), "—")
        self.assertEqual(_screen_parts({"question": {}}), "—")


class ScreenPartsInTheBundle(unittest.IsolatedAsyncioTestCase):
    async def _question(self, questions, question_id="q2"):
        pointer = {**POINTER, "current_state": {**POINTER["current_state"],
                                                "question_id": question_id}}
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=pointer)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": "c"}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=questions), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "lesson"}
            )
        return (bundle.get("current") or {}).get("question") or {}

    async def test_the_first_part_travels_with_the_second(self):
        """The measurements are only in סעיף א — without them the coach is blind."""
        parts = (await self._question(PARTS)).get("screen_parts") or []
        self.assertEqual([p["part"] for p in parts], [1, 2])
        self.assertIn("12.1", parts[0]["text"])
        self.assertTrue(parts[1]["current"])
        self.assertFalse(parts[0]["current"])

    async def test_other_parts_never_carry_their_answers(self):
        """Widening what the coach can SEE must not widen what it could give away."""
        parts = (await self._question(PARTS)).get("screen_parts") or []
        for part in parts:
            self.assertEqual(set(part), {"part", "text", "current"})

    async def test_a_single_question_screen_gets_no_parts(self):
        question = await self._question([PARTS[0]], question_id="q1")
        self.assertNotIn("screen_parts", question)

    async def test_an_unlocatable_question_gets_no_parts(self):
        """Same rule as the position: no claim about the screen we could not place."""
        question = await self._question(PARTS, question_id="not-on-this-screen")
        self.assertNotIn("screen_parts", question)


if __name__ == "__main__":
    unittest.main()
