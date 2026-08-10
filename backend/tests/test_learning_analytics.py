"""Group learning analytics: catalogue spine, aggregation honesty, C5 no-names."""

from __future__ import annotations

import json
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _row(component_id: str, question_id: str, *, attempts: int, correct: int,
         seconds: float = 0, hints: int = 0, last_at: str = "2026-08-01T10:00:00Z"):
    return {
        "question_key": f"{component_id}|item-1|{question_id}",
        "component_id": component_id,
        "item_id": "item-1",
        "question_id": question_id,
        "objective_id": "obj-1",
        "subject": "math",
        "attempts": attempts,
        "correct": correct,
        "time_seconds": seconds,
        "hints_used": hints,
        "content_hints_used": 0,
        "explanations_used": 0,
        "different_way_used": 0,
        "chat_turns": 0,
        "helped_reported": [],
        "first_at": "2026-08-01T09:00:00Z",
        "last_at": last_at,
    }


# Two published learnings; the fixtures below only ever touch cmp-1.
CATALOG = [
    {"id": "cmp-1", "title": "הקנייה א", "unit_id": "unit-1", "objective_id": "obj-1",
     "subject": "math", "estimated_minutes": 20, "order": 1,
     "questions_by_item": {"item-1": [{"questionId": "q1"}, {"questionId": "q2"}]}},
    {"id": "cmp-2", "title": "תרגול ב", "unit_id": "unit-1", "objective_id": "obj-1",
     "subject": "math", "estimated_minutes": 15, "order": 2,
     "questions_by_item": {"item-9": [{"questionId": "q1"}]}},
]

UNITS = {"unit-1": {"id": "unit-1", "title": "יחידה", "titles": {}, "subject": "math"}}


def _catalog_patches(stack: ExitStack):
    p = "app.services.kata_catalog."
    stack.enter_context(patch(p + "ensure_loaded", AsyncMock()))
    stack.enter_context(patch(p + "all_components", return_value=CATALOG))
    stack.enter_context(patch(p + "get_unit", side_effect=lambda uid: UNITS.get(uid)))
    stack.enter_context(patch(
        p + "item_profiles",
        side_effect=lambda cid: [{"id": "item-1", "title": "מסך ראשון", "question_count": 2}]))
    stack.enter_context(patch(
        p + "item_profile",
        side_effect=lambda cid, iid: {"id": iid, "title": "מסך ראשון", "kind": "question"}))
    stack.enter_context(patch(p + "kind_for_row", return_value="question"))
    stack.enter_context(patch(
        p + "question_item_ordinals", return_value={"item-1|q-hard": 3, "item-1": 3}))
    stack.enter_context(patch(p + "question_part_indexes", return_value={}))
    stack.enter_context(patch(
        p + "localized_objective_title", side_effect=lambda oid, lang: f"title:{oid}"))


class GroupLearnings(unittest.IsolatedAsyncioTestCase):
    async def _run(self, per_learner: dict[str, list[dict]], **kwargs):
        from app.services import learning_analytics

        async def _summary(learner_id, subject=None, component_id=None):
            return per_learner.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(per_learner))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            return await learning_analytics.group_learnings("g1", language="he", **kwargs)

    async def test_untouched_learnings_are_listed_as_not_started(self):
        view = await self._run({"kid-a": [_row("cmp-1", "q1", attempts=2, correct=2)]})
        by_id = {row["component_id"]: row for row in view["learnings"]}
        self.assertEqual(set(by_id), {"cmp-1", "cmp-2"})
        self.assertTrue(by_id["cmp-1"]["started"])
        # The lesson nobody opened is present and honest about it.
        self.assertFalse(by_id["cmp-2"]["started"])
        self.assertEqual(by_id["cmp-2"]["attempts"], 0)
        self.assertIsNone(by_id["cmp-2"]["success_rate"])
        self.assertEqual(by_id["cmp-2"]["title"], "תרגול ב")
        # Totals count real work only; the catalogue size is reported separately.
        self.assertEqual(view["totals"]["learnings"], 1)
        self.assertEqual(view["totals"]["catalog_total"], 2)

    async def test_aggregates_across_learners_without_naming_them(self):
        view = await self._run({
            "kid-a": [_row("cmp-1", "q1", attempts=3, correct=3, seconds=120)],
            "kid-b": [_row("cmp-1", "q1", attempts=4, correct=0, seconds=300, hints=2)],
        })
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        self.assertEqual(learning["learners_engaged"], 2)
        self.assertEqual(learning["attempts"], 7)
        self.assertEqual(learning["correct"], 3)
        self.assertEqual(learning["hints_used"], 2)
        # kid-b worked hard (4 attempts) and failed everything → one struggler.
        self.assertEqual(learning["struggling_count"], 1)
        # MoE C5: the payload never carries a learner id anywhere.
        self.assertNotIn("kid-a", json.dumps(view))
        self.assertNotIn("kid-b", json.dumps(view))

    async def test_no_timing_evidence_reports_none_not_zero(self):
        view = await self._run({"kid-a": [_row("cmp-1", "q1", attempts=2, correct=1, seconds=0)]})
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        self.assertFalse(learning["timing_available"])
        self.assertIsNone(learning["total_minutes"])
        self.assertIsNone(learning["avg_minutes_per_learner"])
        self.assertIsNone(view["totals"]["total_minutes"])

    async def test_hard_questions_are_labelled_and_evidenced(self):
        view = await self._run({
            # q-hard: 5 class attempts, 1 correct → hard. q-fine: high success.
            # q-thin: only 2 attempts — never flagged on thin evidence.
            "kid-a": [
                _row("cmp-1", "q-hard", attempts=3, correct=1),
                _row("cmp-1", "q-fine", attempts=4, correct=4),
                _row("cmp-1", "q-thin", attempts=2, correct=0),
            ],
            "kid-b": [_row("cmp-1", "q-hard", attempts=2, correct=0)],
        })
        learning = next(r for r in view["learnings"] if r["component_id"] == "cmp-1")
        hard = learning["hard_questions"]
        self.assertEqual([row["question_id"] for row in hard], ["q-hard"])
        self.assertEqual(hard[0]["attempts"], 5)
        self.assertEqual(hard[0]["learners"], 2)
        # A teacher must be able to tell WHICH question this is.
        self.assertEqual(hard[0]["ordinal"], 3)
        self.assertEqual(hard[0]["screen_title"], "מסך ראשון")

    async def test_subject_filter_narrows_the_catalogue(self):
        view = await self._run({"kid-a": []}, subject="science")
        self.assertEqual(view["learnings"], [])
        view_math = await self._run({"kid-a": []}, subject="math")
        self.assertEqual(len(view_math["learnings"]), 2)


class LearningDetail(unittest.IsolatedAsyncioTestCase):
    async def test_detail_returns_questions_and_screen_spine(self):
        from app.services import learning_analytics

        rows = {
            "kid-a": [_row("cmp-1", "q1", attempts=4, correct=1, seconds=200)],
            "kid-b": [_row("cmp-1", "q1", attempts=2, correct=2, seconds=60)],
        }

        async def _summary(learner_id, subject=None, component_id=None):
            return rows.get(learner_id, [])

        with ExitStack() as stack:
            stack.enter_context(patch("app.brain.org.learners_in_group",
                                      AsyncMock(return_value=list(rows))))
            stack.enter_context(patch("app.services.learner_activity.question_summary",
                                      side_effect=_summary))
            _catalog_patches(stack)
            view = await learning_analytics.learning_detail("g1", "cmp-1", language="he")

        self.assertEqual(view["learning"]["title"], "הקנייה א")
        self.assertEqual(view["learning"]["attempts"], 6)
        self.assertEqual(len(view["questions"]), 1)
        self.assertEqual(view["questions"][0]["attempts"], 6)
        self.assertEqual(view["questions"][0]["learners"], 2)
        # The spine is the lesson's own shape, not only what was answered.
        self.assertEqual([screen["item_id"] for screen in view["screens"]], ["item-1"])
        self.assertEqual(view["screens"][0]["attempts"], 6)
        self.assertNotIn("kid-a", json.dumps(view))


class GroupLearningsRoute(unittest.IsolatedAsyncioTestCase):
    async def test_out_of_scope_teacher_is_refused_with_no_reads(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.learning_analytics.group_learnings",
                   AsyncMock()) as engine:
            response = await routes.group_learnings(
                "g1", subject=None, language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_detail_route_is_scoped_too(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)), \
             patch("app.services.learning_analytics.learning_detail",
                   AsyncMock()) as engine:
            response = await routes.group_learning_detail(
                "g1", "cmp-1", language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_reports_dashboard_viewed_only_after_guard(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=True)), \
             patch("app.services.learning_analytics.group_learnings",
                   AsyncMock(return_value={"learnings": [], "totals": {}})), \
             patch("app.services.group_analytics.learning_gaps",
                   AsyncMock(return_value=[])), \
             patch("app.services.group_analytics.group_recommendations",
                   return_value=[]), \
             patch.object(routes, "_report", AsyncMock()) as report:
            response = await routes.group_learnings(
                "g1", subject=None, language="he", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        report.assert_awaited_once()
        body = json.loads(response.body)
        self.assertIn("recommendations", body)


if __name__ == "__main__":
    unittest.main()
