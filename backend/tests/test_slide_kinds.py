"""Not every screen in a component is a question.

Measured across the five components of מדידה מעשית של מסה בשלושה מצבי צבירה:

    01  10 screens, 11 questions   (choice / matching / sequencing)
    02   3 screens,  4 questions
    03   1 screen,   1 question    (type "other")
    04   5 screens,  6 questions   + `…-01-04-006`: teaching notes, NO question
    05   1 screen,   4 questions   (q1–q4 on ONE screen)

Two of those break "one screen = one question", which the chat's captions relied
on: a teaching screen would have been captioned "question N" for a question the
learner never saw, and the four questions of `…-01-05` would all have been
captioned "question 1".
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog  # noqa: E402


MULTI = "methodica-science-mass-measure-01-05"
MULTI_SNAPSHOT = {
    "id": MULTI,
    "questions_by_item": {
        f"{MULTI}-001": [
            {"questionId": "q1"}, {"questionId": "q2"},
            {"questionId": "q3"}, {"questionId": "q4"},
        ],
    },
    "information_by_item": {f"{MULTI}-001": "…", "q1": "…", "q2": "…"},
}

TEACHING = "methodica-science-mass-measure-01-04"
TEACHING_SNAPSHOT = {
    "id": TEACHING,
    "questions_by_item": {
        f"{TEACHING}-001": [{"questionId": "q1"}],
        f"{TEACHING}-002": [{"questionId": "q1"}],
    },
    "information_by_item": {
        f"{TEACHING}-001": "…",
        f"{TEACHING}-002": "…",
        f"{TEACHING}-006": "teaching screen, no question",
        "q1": "…", "q2": "…",
    },
}


class MultiQuestionScreenTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(kata_catalog, "get_component", return_value=MULTI_SNAPSHOT)
        p.start()
        self.addCleanup(p.stop)

    def test_four_questions_on_one_screen_are_one_question_in_four_parts(self):
        """The content says so itself: "שאלת השיא… יש בה ארבעה סעיפים"."""
        ordinals = kata_catalog.question_item_ordinals(MULTI)
        self.assertEqual({ordinals[f"{MULTI}-001|q{n}"] for n in range(1, 5)}, {1})

    def test_each_part_of_that_screen_is_named_in_order(self):
        parts = kata_catalog.question_part_indexes(MULTI)
        self.assertEqual([parts[f"{MULTI}-001|q{n}"] for n in range(1, 5)], [1, 2, 3, 4])

    def test_the_bare_screen_key_points_at_its_first_question(self):
        """A message stored before the question resolved still captions right."""
        self.assertEqual(kata_catalog.question_item_ordinals(MULTI)[f"{MULTI}-001"], 1)

    def test_the_screen_holds_no_teaching_only_items(self):
        self.assertEqual(kata_catalog.non_question_items(MULTI), [])


class TeachingScreenTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(kata_catalog, "get_component", return_value=TEACHING_SNAPSHOT)
        p.start()
        self.addCleanup(p.stop)

    def test_a_screen_with_notes_and_no_question_is_found(self):
        self.assertEqual(
            kata_catalog.non_question_items(TEACHING), [f"{TEACHING}-006"]
        )

    def test_bare_sub_question_keys_are_not_mistaken_for_screens(self):
        """`information_by_item` also carries plain "q1"/"q2" keys."""
        found = kata_catalog.non_question_items(TEACHING)
        self.assertNotIn("q1", found)
        self.assertNotIn("q2", found)

    def test_a_teaching_screen_gets_no_question_number(self):
        self.assertNotIn(f"{TEACHING}-006", kata_catalog.question_item_ordinals(TEACHING))

    def test_question_screens_still_number_in_order(self):
        ordinals = kata_catalog.question_item_ordinals(TEACHING)
        self.assertEqual(ordinals[f"{TEACHING}-001|q1"], 1)
        self.assertEqual(ordinals[f"{TEACHING}-002|q1"], 2)


class UnknownComponentTests(unittest.TestCase):
    def test_no_snapshot_degrades_to_empty(self):
        with mock.patch.object(kata_catalog, "get_component", return_value=None):
            self.assertEqual(kata_catalog.question_item_ordinals("nope"), {})
            self.assertEqual(kata_catalog.non_question_items("nope"), [])


if __name__ == "__main__":
    unittest.main()
