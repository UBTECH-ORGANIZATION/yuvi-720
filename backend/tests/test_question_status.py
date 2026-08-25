"""Regression coverage for the deterministic active-question status projection."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.question_status import (  # noqa: E402
    STATUS_ALL_CORRECT,
    STATUS_ANSWERED_NOT_ALL_CORRECT,
    STATUS_UNATTEMPTED,
    derive_item_status,
)


def answer(question_id: str, success: bool | None) -> dict:
    return {
        "verb": "answered",
        "question_id": question_id,
        "result": {"success": success},
    }


def sections(*question_ids: str) -> list[dict]:
    return [{"questionId": question_id} for question_id in question_ids]


class QuestionStatusTests(unittest.TestCase):
    def test_unattempted_has_no_answered_events(self) -> None:
        projection = derive_item_status([{"verb": "attempted"}], questions=sections("q1"))
        self.assertEqual(projection["status"], STATUS_UNATTEMPTED)
        self.assertEqual(projection["answer_count"], 0)

    def test_all_catalogued_sections_must_be_correct(self) -> None:
        projection = derive_item_status(
            [answer("q1", True), answer("q2", True)], questions=sections("q1", "q2")
        )
        self.assertEqual(projection["status"], STATUS_ALL_CORRECT)
        self.assertEqual(projection["correct_section_count"], 2)

    def test_one_incorrect_answer_is_not_claimed_to_be_exhausted(self) -> None:
        projection = derive_item_status([answer("q1", False)], questions=sections("q1"))
        self.assertEqual(projection["status"], STATUS_ANSWERED_NOT_ALL_CORRECT)

    def test_correct_answer_for_only_one_section_is_not_item_completion(self) -> None:
        projection = derive_item_status([answer("q1", True)], questions=sections("q1", "q2"))
        self.assertEqual(projection["status"], STATUS_ANSWERED_NOT_ALL_CORRECT)


if __name__ == "__main__":
    unittest.main()
