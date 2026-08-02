"""The chat's question numbers must match the numbers on the learner's screen.

Measured 29/07 walking `…-01-02`: the player's own nav shows three tabs —
שאלה 1 / שאלה 2 / שאלה 3 — one per ITEM, and item `-001` is titled
"בסיסי 1: זיהוי תוצאה חריגה (2 סעיפים)". We numbered every sub-question
consecutively instead, so the companion captioned the second סעיף of שאלה 1 as
"שאלה 2", and item `-002` — the content's שאלה 2 — as "שאלה 3". From the
learner's seat the chat was one question ahead of the screen for the rest of the
component.

Same drift on `…-01-05`: the content says "שאלת השיא… יש בה ארבעה סעיפים" — ONE
question — and we labelled the four parts "שאלה 1" through "שאלה 4".
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog  # noqa: E402


def _component(by_item: dict) -> dict:
    return {"id": "c", "questions_by_item": by_item}


# The real shape of `…-01-02`, captured live.
TWO_PART_FIRST_SCREEN = _component({
    "c-001": [{"questionId": "q1"}, {"questionId": "q2"}],
    "c-002": [{"questionId": "q1"}],
    "c-003": [{"questionId": "q1"}],
})

# The real shape of `…-01-05`, the assessment: one question, four סעיפים.
ONE_SCREEN_FOUR_PARTS = _component({
    "c-001": [{"questionId": f"q{n}"} for n in range(1, 5)],
})


class QuestionNumberingTests(unittest.TestCase):
    def _ordinals(self, component):
        with patch.object(kata_catalog, "get_component", return_value=component):
            return kata_catalog.question_item_ordinals("c")

    def _parts(self, component):
        with patch.object(kata_catalog, "get_component", return_value=component):
            return kata_catalog.question_part_indexes("c")

    def test_a_screen_is_one_question_number(self):
        ordinals = self._ordinals(TWO_PART_FIRST_SCREEN)
        self.assertEqual(ordinals["c-001|q1"], 1)
        self.assertEqual(ordinals["c-001|q2"], 1, "both סעיפים are שאלה 1")

    def test_the_next_screen_is_the_next_number_the_learner_sees(self):
        ordinals = self._ordinals(TWO_PART_FIRST_SCREEN)
        self.assertEqual(ordinals["c-002|q1"], 2)
        self.assertEqual(ordinals["c-003|q1"], 3)

    def test_the_bare_screen_key_agrees_with_its_questions(self):
        ordinals = self._ordinals(TWO_PART_FIRST_SCREEN)
        self.assertEqual(ordinals["c-001"], 1)
        self.assertEqual(ordinals["c-002"], 2)

    def test_the_assessment_is_one_question_not_four(self):
        ordinals = self._ordinals(ONE_SCREEN_FOUR_PARTS)
        self.assertEqual(set(ordinals.values()), {1})

    def test_a_shared_screen_names_its_parts_in_order(self):
        parts = self._parts(TWO_PART_FIRST_SCREEN)
        self.assertEqual(parts["c-001|q1"], 1)
        self.assertEqual(parts["c-001|q2"], 2)

    def test_a_single_question_screen_has_no_part_to_name(self):
        """Captioning a lone question "סעיף א" invents structure on screen."""
        parts = self._parts(TWO_PART_FIRST_SCREEN)
        self.assertNotIn("c-002|q1", parts)
        self.assertNotIn("c-003|q1", parts)

    def test_the_assessment_names_all_four_parts(self):
        parts = self._parts(ONE_SCREEN_FOUR_PARTS)
        self.assertEqual([parts[f"c-001|q{n}"] for n in range(1, 5)], [1, 2, 3, 4])

    def test_a_teaching_screen_never_takes_a_question_number(self):
        component = _component({"c-001": [], "c-002": [{"questionId": "q1"}]})
        ordinals = self._ordinals(component)
        self.assertNotIn("c-001", ordinals)
        self.assertEqual(ordinals["c-002|q1"], 1)

    def test_no_snapshot_numbers_nothing(self):
        with patch.object(kata_catalog, "get_component", return_value=None):
            self.assertEqual(kata_catalog.question_item_ordinals("c"), {})
            self.assertEqual(kata_catalog.question_part_indexes("c"), {})


if __name__ == "__main__":
    unittest.main()
