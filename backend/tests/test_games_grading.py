"""Grading: the item-scoped id rule, text and index answers, and the record."""

from __future__ import annotations

import unittest

from app.services.games import grading, store
from tests.games_support import COMP, GamesHarness, LEARNER, OBJECTIVE, UNIT


class GradingTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.harness = GamesHarness().__enter__()
        self.game = await store.create_game(
            learner_id=LEARNER, objective_id=OBJECTIVE, unit_id=UNIT, component_id=COMP,
            title="t", genre="puzzle",
        )

    async def asyncTearDown(self):
        self.harness.__exit__(None, None, None)

    def test_split_rule_matches_the_worker(self):
        self.assertEqual(grading.split_question_id("item-2#q1"), ("item-2", "q1"))
        self.assertEqual(grading.split_question_id("bare"), ("bare", ""))

    async def test_text_answer_is_whitespace_and_case_insensitive(self):
        result = await grading.grade(self.game, "item-2#q1", "  balance   scale ")
        self.assertEqual(result, {"correct": True, "correct_answer": None})

    async def test_index_answer_resolves_the_option(self):
        self.assertTrue((await grading.grade(self.game, "item-1#q1", 0))["correct"])
        wrong = await grading.grade(self.game, "item-1#q1", 1)
        self.assertFalse(wrong["correct"])
        self.assertEqual(wrong["correct_answer"], "קילוגרם")

    async def test_a_boolean_is_not_an_index(self):
        result = await grading.grade(self.game, "item-1#q1", True)
        self.assertFalse(result["correct"])

    async def test_the_same_question_id_on_another_item_grades_that_item(self):
        """`q1` exists on both screens; the item prefix decides."""
        self.assertTrue((await grading.grade(self.game, "item-1#q1", "קילוגרם"))["correct"])
        self.assertFalse((await grading.grade(self.game, "item-2#q1", "קילוגרם"))["correct"])

    async def test_unknown_question_and_component_raise(self):
        with self.assertRaises(grading.GradingError) as ctx:
            await grading.grade(self.game, "item-9#q1", "x")
        self.assertEqual(str(ctx.exception), "unknown_question")
        with self.assertRaises(grading.GradingError) as ctx:
            await grading.grade({**self.game, "component_id": "nope"}, "item-1#q1", "x")
        self.assertEqual(str(ctx.exception), "unknown_component")

    async def test_every_grade_records_one_answer_row(self):
        await grading.grade(self.game, "item-1#q1", 0, latency_ms=1200)
        await grading.grade(self.game, "item-2#q1", "Ruler")
        rows = await store.list_answers(self.game["_id"], LEARNER)
        self.assertEqual([(row["item_id"], row["correct"]) for row in rows],
                         [("item-1", True), ("item-2", False)])
        self.assertEqual(rows[0]["latency_ms"], 1200)
        self.assertEqual(rows[0]["component_id"], COMP)


if __name__ == "__main__":
    unittest.main()
