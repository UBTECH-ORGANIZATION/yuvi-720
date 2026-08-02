"""A nudge must describe the question it fired for, not the next one.

Measured 29/07 walking `…-01-02`: the learner answered סעיף ב of שאלה 1 ("האם על
שחר, עדן ופלג לבצע מדידה נוספת?") and Yuvi praised them for "להבחין בין דיוק
למהימנות לפי… 50.00 גרם" — the content of שאלה 2, a screen they had not opened.

Kata advances the screen the instant an answer lands, and a nudge is composed
asynchronously afterwards, so reading the live pointer at composition time
grounds the message on wherever the learner has since moved. Every AI claim must
be traceable to what the learner actually did, so the trigger carries its own
question and that wins.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain import context_engine  # noqa: E402


LIVE_POINTER = {
    "current_state": {
        "component_id": "c-02",
        "unit_id": "u-1",
        "item_id": "c-02-002",      # Kata already moved them on
        "question_id": "q1",
    },
    "goals": [],
    "identity": {"locale": "he"},
}

# What the learner actually just answered: סעיף ב of the PREVIOUS screen.
ANSWERED = "c-02|c-02-001|q2"

QUESTIONS = {
    "c-02-001": [
        {"questionId": "q1", "questionText": "האם ישנה תוצאה חריגה?"},
        {"questionId": "q2", "questionText": "האם עליהם לבצע מדידה נוספת?"},
    ],
    "c-02-002": [
        {"questionId": "q1", "questionText": "גררו כל תיאור אל המדידה המתאימה"},
    ],
}
MOVED_ON = "גררו כל תיאור אל המדידה המתאימה"


class PinnedQuestionTests(unittest.IsolatedAsyncioTestCase):
    async def _grounded_on(self, pinned=None):
        """The question text this bundle would put in front of the model."""
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=LIVE_POINTER)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": "c-02"}), \
             patch("app.services.kata_catalog.questions_for_item",
                   side_effect=lambda component, item: QUESTIONS.get(item, [])), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "lesson"}, pinned_question_key=pinned,
            )
        return ((bundle.get("current") or {}).get("question") or {}).get("text")

    async def test_without_a_pin_the_live_pointer_is_used(self):
        self.assertEqual(await self._grounded_on(), MOVED_ON)

    async def test_the_pin_wins_over_where_they_have_since_moved(self):
        self.assertEqual(await self._grounded_on(ANSWERED), "האם עליהם לבצע מדידה נוספת?")

    async def test_the_pin_picks_the_right_part_of_a_shared_screen(self):
        """Both סעיפים live on `-001`; the key names which one."""
        self.assertEqual(await self._grounded_on("c-02|c-02-001|q1"), "האם ישנה תוצאה חריגה?")

    async def test_a_partial_pin_falls_back_instead_of_blanking_the_screen(self):
        self.assertEqual(await self._grounded_on("c-02||"), MOVED_ON)

    async def test_an_empty_pin_is_ignored(self):
        self.assertEqual(await self._grounded_on(""), MOVED_ON)


if __name__ == "__main__":
    unittest.main()
