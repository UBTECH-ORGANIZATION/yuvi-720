"""Teacher-analytics backbone: support usage is recorded durably and merges
with performance/time into a per-question summary, filterable by task/subject."""

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import learner_activity  # noqa: E402


def _answer(component, item, question, success, seconds, subject="science", objective="obj-1"):
    return {
        "verb": "answered", "launch": component, "sub_item_id": item, "question_id": question,
        "objective_id": objective, "subject": subject,
        "result": {"success": success},
        "timing": {"elapsed_since_previous_seconds": seconds},
        "occurred_at": f"2026-07-26T10:0{question[-1]}:00+00:00",
    }


class LearnerActivitySummaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_merges_performance_time_and_help(self) -> None:
        events = [
            _answer("comp-A", "comp-A-01", "q1", False, 12),
            _answer("comp-A", "comp-A-01", "q1", True, 30),   # 2 attempts, 1 correct, 42s
            _answer("comp-B", "comp-B-01", "q1", True, 8, subject="math"),
        ]
        activity = [
            {"learner_id": "L", "kind": "hint", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1", "subject": "science"},
            {"learner_id": "L", "kind": "different_way", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1", "subject": "science"},
        ]
        with (
            patch("app.services.events.get_learner_events", new=AsyncMock(return_value=events)),
            patch.object(learner_activity, "_activity_rows", new=AsyncMock(return_value=activity)),
        ):
            rows = await learner_activity.question_summary("L")

        by_key = {r["question_key"]: r for r in rows}
        a = by_key["comp-A|comp-A-01|q1"]
        self.assertEqual((a["attempts"], a["correct"]), (2, 1))
        self.assertEqual(a["time_seconds"], 42.0)
        self.assertEqual(a["hints_used"], 1)
        self.assertEqual(a["explanations_used"], 0)
        self.assertEqual(a["different_way_used"], 1)
        self.assertEqual(a["subject"], "science")

    async def test_summary_filters_by_task_and_subject(self) -> None:
        events = [
            _answer("comp-A", "comp-A-01", "q1", True, 10, subject="science"),
            _answer("comp-B", "comp-B-01", "q1", True, 10, subject="math"),
        ]
        with (
            patch("app.services.events.get_learner_events", new=AsyncMock(return_value=events)),
            patch.object(learner_activity, "_activity_rows", new=AsyncMock(return_value=[])),
        ):
            only_a = await learner_activity.question_summary("L", component_id="comp-A")
            only_math = await learner_activity.question_summary("L", subject="math")

        self.assertEqual([r["component_id"] for r in only_a], ["comp-A"])
        self.assertEqual([r["subject"] for r in only_math], ["math"])

    async def test_record_ignores_unknown_kind(self) -> None:
        with patch("app.brain.repository._get_collection_named", return_value=None):
            with patch.object(learner_activity, "_write_fallback") as write:
                await learner_activity.record("L", "bogus", component_id="comp-A")
                write.assert_not_called()

    async def test_helped_attribution_cleans_dedups_and_validates(self) -> None:
        # Store dedups, preserves order, and drops methods outside HELP_METHODS.
        with patch("app.services.learner_activity._get_collection_named", return_value=None):
            with patch.object(learner_activity, "_read_fallback", return_value=[]):
                with patch.object(learner_activity, "_write_fallback"):
                    stored = await learner_activity.record_helped_attribution(
                        "L", ["yuvi_chat", "hint", "hint", "bogus"],
                        component_id="comp-A", item_id="comp-A-01", question_id="q1",
                    )
        self.assertEqual(stored, ["yuvi_chat", "hint"])

    async def test_helped_attribution_latest_wins_in_fallback(self) -> None:
        store: list = []
        with patch("app.services.learner_activity._get_collection_named", return_value=None):
            with patch.object(learner_activity, "_read_fallback", side_effect=lambda: list(store)):
                with patch.object(learner_activity, "_write_fallback", side_effect=lambda rows: store.clear() or store.extend(rows)):
                    await learner_activity.record_helped_attribution(
                        "L", ["hint"], component_id="comp-A", item_id="comp-A-01", question_id="q1")
                    await learner_activity.record_helped_attribution(
                        "L", ["explanation"], component_id="comp-A", item_id="comp-A-01", question_id="q1")
        attributions = [r for r in store if r.get("kind") == "helped_attribution"]
        self.assertEqual(len(attributions), 1)                 # one record per question
        self.assertEqual(attributions[0]["methods"], ["explanation"])   # latest wins

    async def test_summary_counts_chat_turns_repeatably(self) -> None:
        # Unlike one-shot hint/explanation/different_way, each yuvi_chat row is a
        # turn — three messages on a question count as chat_turns == 3.
        events = [_answer("comp-A", "comp-A-01", "q1", True, 10)]
        activity = [
            {"learner_id": "L", "kind": "yuvi_chat", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1"},
            {"learner_id": "L", "kind": "yuvi_chat", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1"},
            {"learner_id": "L", "kind": "yuvi_chat", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1"},
            {"learner_id": "L", "kind": "hint", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1"},
        ]
        with (
            patch("app.services.events.get_learner_events", new=AsyncMock(return_value=events)),
            patch.object(learner_activity, "_activity_rows", new=AsyncMock(return_value=activity)),
        ):
            rows = await learner_activity.question_summary("L")
        row = {r["question_key"]: r for r in rows}["comp-A|comp-A-01|q1"]
        self.assertEqual(row["chat_turns"], 3)
        self.assertEqual(row["hints_used"], 1)

    async def test_summary_surfaces_helped_reported(self) -> None:
        events = [_answer("comp-A", "comp-A-01", "q1", True, 10)]
        activity = [
            {"learner_id": "L", "kind": "hint", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1", "subject": "science"},
            {"learner_id": "L", "kind": "helped_attribution", "component_id": "comp-A",
             "item_id": "comp-A-01", "question_id": "q1", "methods": ["hint", "yuvi_chat"]},
        ]
        with (
            patch("app.services.events.get_learner_events", new=AsyncMock(return_value=events)),
            patch.object(learner_activity, "_activity_rows", new=AsyncMock(return_value=activity)),
        ):
            rows = await learner_activity.question_summary("L")
        row = {r["question_key"]: r for r in rows}["comp-A|comp-A-01|q1"]
        self.assertEqual(row["helped_reported"], ["hint", "yuvi_chat"])
        self.assertEqual(row["hints_used"], 1)                 # attribution is NOT a usage count


if __name__ == "__main__":
    unittest.main()
