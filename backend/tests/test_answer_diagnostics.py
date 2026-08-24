"""Regression checks for conservative, deterministic partial-answer evidence."""

from __future__ import annotations

import unittest

from app.services.answer_diagnostics import diagnose_answer


COORDINATE_QUESTION = {
    "questionText": "נקודה E נמצאת 4 יחידות למעלה ו-5 יחידות ימינה מנקודה B. כתבו את שיעורי נקודה E.",
    "correctAnswers": ["(7, 8)"],
}


class AnswerDiagnosticsTests(unittest.TestCase):
    def test_coordinate_pair_preserves_the_correct_component(self):
        diagnostic = diagnose_answer(
            COORDINATE_QUESTION,
            "7,4",
            provider_success=False,
            provider_score_scaled=None,
        )
        self.assertEqual(diagnostic, {
            "outcome": "partial",
            "correctness": 0.5,
            "source": "structured_components",
            "correct_parts": [0],
            "incorrect_parts": [1],
            "total_parts": 2,
        })

    def test_provider_partial_score_is_preserved_without_question_shape(self):
        diagnostic = diagnose_answer(
            {"correctAnswers": []},
            "anything",
            provider_success=False,
            provider_score_scaled=0.6,
        )
        self.assertEqual(diagnostic["outcome"], "partial")
        self.assertEqual(diagnostic["source"], "provider_score")

    def test_ambiguous_free_text_is_not_guessed_as_partial(self):
        diagnostic = diagnose_answer(
            {"questionText": "כתבו מספר עשרוני", "correctAnswers": ["0,5"]},
            "0,4",
            provider_success=False,
            provider_score_scaled=None,
        )
        self.assertEqual(diagnostic["outcome"], "wrong")

    def test_provider_success_stays_authoritative(self):
        diagnostic = diagnose_answer(
            COORDINATE_QUESTION,
            "7,4",
            provider_success=True,
            provider_score_scaled=None,
        )
        self.assertEqual(diagnostic["outcome"], "correct")


if __name__ == "__main__":
    unittest.main()