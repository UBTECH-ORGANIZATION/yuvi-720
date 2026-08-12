"""Scoring: partial credit, and never generous by accident.

A wrong grade is the failure a parent hears about, so every type is pinned here
including the awkward middles — three of five in order, two of four pairs
matched, one blank of two filled.

Two properties get their own tests because getting them wrong is invisible in
the aggregate:

* **Guessing must not pay.** If ticking every box on a `multiple_correct`
  scored full marks, the rational strategy would be to tick everything and the
  score would stop measuring anything at all.
* **Skipped is not wrong.** They are counted separately: "never reached it" and
  "tried and failed" call for different responses from the teacher.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import evaluate


def _q(kind: str, answer: dict, **extra) -> dict:
    return {"id": "q1", "type": kind, "answer": answer, "weight": 1, **extra}


class ChoiceTests(unittest.TestCase):
    def test_mcq(self):
        question = _q("mcq", {"index": 2})
        self.assertEqual(evaluate.score_question(question, 2)["correctness"], 1.0)
        self.assertEqual(evaluate.score_question(question, 0)["correctness"], 0.0)

    def test_an_index_that_arrives_as_a_string_still_scores(self):
        # JSON from a form control; the child chose correctly either way.
        self.assertEqual(evaluate.score_question(_q("mcq", {"index": 2}), "2")["correctness"], 1.0)

    def test_true_false_accepts_a_boolean_or_its_word(self):
        question = _q("true_false", {"value": True})
        for given in (True, "true", "נכון"):
            self.assertEqual(evaluate.score_question(question, given)["correctness"], 1.0, given)
        self.assertEqual(evaluate.score_question(question, False)["correctness"], 0.0)


class MultipleCorrectTests(unittest.TestCase):
    QUESTION = _q("multiple_correct", {"indices": [0, 2]})

    def test_exactly_right_is_full_marks(self):
        self.assertEqual(evaluate.score_question(self.QUESTION, [0, 2])["correctness"], 1.0)

    def test_half_right_is_half_marks(self):
        self.assertEqual(evaluate.score_question(self.QUESTION, [0])["correctness"], 0.5)

    def test_selecting_everything_scores_zero(self):
        """The property that makes the score mean anything."""
        verdict = evaluate.score_question(self.QUESTION, [0, 1, 2, 3])
        self.assertEqual(verdict["correctness"], 0.0)

    def test_a_wrong_pick_cancels_a_right_one(self):
        self.assertEqual(evaluate.score_question(self.QUESTION, [0, 1])["correctness"], 0.0)

    def test_the_teacher_can_see_which_ones(self):
        detail = evaluate.score_question(self.QUESTION, [0, 1])["detail"]
        self.assertEqual(detail, {"selected": [0, 1], "missed": [2], "wrong": [1]})


class OrderingTests(unittest.TestCase):
    QUESTION = _q("ordering", {"order": [0, 1, 2, 3]})

    def test_the_right_order_is_full_marks(self):
        self.assertEqual(evaluate.score_question(self.QUESTION, [0, 1, 2, 3])["correctness"], 1.0)

    def test_positional_agreement_is_partial_credit(self):
        # First two in place, last two swapped.
        verdict = evaluate.score_question(self.QUESTION, [0, 1, 3, 2])
        self.assertEqual(verdict["correctness"], 0.5)
        self.assertEqual(verdict["detail"], {"in_place": 2, "total": 4})

    def test_a_completely_reversed_order_is_not_negative(self):
        self.assertEqual(evaluate.score_question(self.QUESTION, [3, 2, 1, 0])["correctness"], 0.0)


class MatchingTests(unittest.TestCase):
    QUESTION = _q("matching", {"pairs": [[0, 1], [1, 0], [2, 2]]})

    def test_set_intersection_gives_partial_credit(self):
        verdict = evaluate.score_question(self.QUESTION, [[0, 1], [1, 0], [2, 0]])
        self.assertAlmostEqual(verdict["correctness"], 0.667, places=3)
        self.assertEqual(verdict["detail"]["matched"], 2)

    def test_order_of_the_pairs_does_not_matter(self):
        verdict = evaluate.score_question(self.QUESTION, [[2, 2], [0, 1], [1, 0]])
        self.assertEqual(verdict["correctness"], 1.0)


class FillBlankTests(unittest.TestCase):
    def test_each_blank_counts_for_its_share(self):
        question = _q("fill_blank", {"blanks": [{"accept": ["3"]}, {"accept": ["4"]}]})
        self.assertEqual(evaluate.score_question(question, ["3", "9"])["correctness"], 0.5)

    def test_any_accepted_spelling_is_right(self):
        question = _q("fill_blank", {"blanks": [{"accept": ["12", "שתים עשרה"]}]})
        for given in ("12", "שתים עשרה", " 12 "):
            self.assertEqual(evaluate.score_question(question, [given])["correctness"], 1.0, given)

    def test_a_fraction_and_its_decimal_are_the_same_answer(self):
        """Which notation a child types depends on their keyboard and their
        teacher, not on whether they understood."""
        question = _q("fill_blank", {"blanks": [{"accept": ["1/2"]}]})
        for given in ("1/2", "0.5", "0,5"):
            self.assertEqual(evaluate.score_question(question, [given])["correctness"], 1.0, given)

    def test_a_mixed_number_matches_however_it_is_written(self):
        question = _q("fill_blank", {"blanks": [{"accept": ["2 1/4"]}]})
        for given in ("2 1/4", "2.25", "9/4"):
            self.assertEqual(evaluate.score_question(question, [given])["correctness"], 1.0, given)

    def test_a_minus_sign_typed_from_a_hebrew_keyboard_still_matches(self):
        # U+2212 MINUS SIGN, which is not the ASCII hyphen the key produces.
        question = _q("fill_blank", {"blanks": [{"accept": ["-4"]}]})
        self.assertEqual(evaluate.score_question(question, ["−4"])["correctness"], 1.0)

    def test_being_approximately_right_is_not_right(self):
        question = _q("fill_blank", {"blanks": [{"accept": ["0.5"]}]})
        self.assertEqual(evaluate.score_question(question, ["0.51"])["correctness"], 0.0)


class SkipAndPendingTests(unittest.TestCase):
    def test_an_unanswered_question_is_skipped_not_wrong(self):
        verdict = evaluate.score_question(_q("mcq", {"index": 1}), None)
        self.assertTrue(verdict["skipped"])
        self.assertEqual(verdict["correctness"], 0.0)

    def test_an_open_question_waits_for_the_rubric_grader(self):
        """The reference implementation read a score nothing ever wrote, so
        every open question silently scored zero."""
        verdict = evaluate.score_question(_q("open_ended", {"rubric": [{"criterion": "x"}]}), "תשובה")
        self.assertIsNone(verdict["correctness"])
        self.assertEqual(verdict["detail"], {"awaiting": "rubric"})


class TotalTests(unittest.TestCase):
    QUESTIONS = [
        {"id": "q1", "type": "mcq", "answer": {"index": 0}, "weight": 1},
        {"id": "q2", "type": "mcq", "answer": {"index": 1}, "weight": 3},
    ]

    def test_weights_are_respected(self):
        # Right on the heavy one only: 3 of 4.
        result = evaluate.score_questions(self.QUESTIONS, {"q1": 1, "q2": 1})
        self.assertEqual(result["score"], 75)

    def test_the_totals_describe_what_happened(self):
        result = evaluate.score_questions(self.QUESTIONS, {"q1": 0})
        self.assertEqual(result["answered"], 1)
        self.assertEqual(result["skipped"], 1)

    def test_a_question_awaiting_grading_is_excluded_not_zeroed(self):
        """A score that silently drops while grading is still running would be
        shown to a teacher as though it were final."""
        questions = self.QUESTIONS + [
            {"id": "q3", "type": "open_ended", "answer": {"rubric": [{"criterion": "x"}]},
             "weight": 10},
        ]
        result = evaluate.score_questions(questions, {"q1": 0, "q2": 1, "q3": "תשובה"})
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["awaiting_grading"], 1)

    def test_no_questions_yields_no_score_rather_than_zero(self):
        self.assertIsNone(evaluate.score_questions([], {})["score"])


if __name__ == "__main__":
    unittest.main()
