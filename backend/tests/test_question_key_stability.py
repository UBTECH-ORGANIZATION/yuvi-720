"""One question must produce exactly ONE question_key, for its whole life.

Anchored on observed data: a single lesson screen produced two keys —
`…-01-01|…-001|` (13 messages) and `…-01-01|…-001|q1` (13 more) — because Kata's
`initialized` names the screen but no question, so `question_id` only appeared
once the learner answered. The chat groups by this key, so one question rendered
as two threads and the "שאלה N" numbering drifted from the content.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import tutor_decision  # noqa: E402
from app.services import kata_catalog  # noqa: E402


COMPONENT = "methodica-science-mass-measure-01-01"
SNAPSHOT = {
    "questions_by_item": {
        f"{COMPONENT}-001": [{"questionId": "q1", "questionText": "בלונים"}],
        f"{COMPONENT}-002": [{"questionId": "q1", "questionText": "מאזניים"}],
        f"{COMPONENT}-003": [{"questionId": "q1", "questionText": "יחידות"}],
        # Two sub-questions on one screen (סעיף א / ב) — genuinely ambiguous.
        f"{COMPONENT}-004": [{"questionId": "q1"}, {"questionId": "q2"}],
    }
}


class DefaultQuestionTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(kata_catalog, "get_component", return_value=SNAPSHOT)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_resolves_the_only_question_on_a_screen(self):
        self.assertEqual(
            kata_catalog.default_question_id(COMPONENT, f"{COMPONENT}-002"), "q1"
        )

    def test_stays_silent_when_a_screen_holds_two_sub_questions(self):
        """Guessing q1 vs q2 would be worse than waiting for the event."""
        self.assertIsNone(
            kata_catalog.default_question_id(COMPONENT, f"{COMPONENT}-004")
        )

    def test_unknown_screen_or_component_resolves_to_none(self):
        self.assertIsNone(kata_catalog.default_question_id(COMPONENT, "nope"))
        self.assertIsNone(kata_catalog.default_question_id(None, None))

    def test_ordinals_number_questions_the_way_the_learner_sees_them(self):
        ordinals = kata_catalog.question_item_ordinals(COMPONENT)
        self.assertEqual(ordinals[f"{COMPONENT}-001"], 1)
        self.assertEqual(ordinals[f"{COMPONENT}-003"], 3)
        # -004 carries TWO sub-questions, but the player numbers by SCREEN: both
        # are שאלה 4, told apart as סעיף א / סעיף ב. Numbering them 4 and 5 put
        # the chat a question ahead of the screen for the rest of the component.
        self.assertEqual(ordinals[f"{COMPONENT}-004|q1"], 4)
        self.assertEqual(ordinals[f"{COMPONENT}-004|q2"], 4)
        self.assertEqual(kata_catalog.question_part_indexes(COMPONENT)[f"{COMPONENT}-004|q2"], 2)
        self.assertEqual(len(set(ordinals.values())), 4)


class KeyStabilityTests(unittest.TestCase):
    """The key on arrival must equal the key after the learner answers."""

    def setUp(self):
        patcher = mock.patch.object(kata_catalog, "get_component", return_value=SNAPSHOT)
        patcher.start()
        self.addCleanup(patcher.stop)

    def _state(self, item: str, question):
        return {"component_id": COMPONENT, "item_id": item, "question_id": question}

    def test_arrival_and_answer_share_one_key(self):
        item = f"{COMPONENT}-002"
        # What the fold now stores on `initialized` (question resolved from catalog)
        on_arrival = tutor_decision.support_question_key(
            self._state(item, kata_catalog.default_question_id(COMPONENT, item)), COMPONENT
        )
        # What the fold stores on `answered` (question carried by the event)
        on_answer = tutor_decision.support_question_key(self._state(item, "q1"), COMPONENT)
        self.assertEqual(on_arrival, on_answer)
        self.assertTrue(on_arrival.endswith("|q1"))

    def test_the_old_behaviour_would_have_split_the_thread(self):
        """Regression guard: None-on-arrival is exactly what broke grouping."""
        item = f"{COMPONENT}-002"
        self.assertNotEqual(
            tutor_decision.support_question_key(self._state(item, None), COMPONENT),
            tutor_decision.support_question_key(self._state(item, "q1"), COMPONENT),
        )

    def test_two_sub_questions_still_key_apart(self):
        item = f"{COMPONENT}-004"
        self.assertNotEqual(
            tutor_decision.support_question_key(self._state(item, "q1"), COMPONENT),
            tutor_decision.support_question_key(self._state(item, "q2"), COMPONENT),
        )


if __name__ == "__main__":
    unittest.main()
