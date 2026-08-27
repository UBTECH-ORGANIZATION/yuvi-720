"""The pin dialog's smart search — grounding over helpfulness.

The one property that matters: a teacher is never shown a learning that does
not exist in their group's catalog, no matter what the model says. The
adjacent-topic hint exists to navigate, so it only ever appears when there
are no real answers to stand next to.
"""

import json
import unittest
from unittest.mock import AsyncMock, patch

_CATALOG = [
    {"component_id": "CET.MATH.FRAC-01", "title": "חיבור שברים",
     "unit_title": "שברים", "objective_title": "פעולות בשברים", "subject": "math"},
    {"component_id": "CET.MATH.FRAC-02", "title": "חיסור שברים",
     "unit_title": "שברים", "objective_title": "פעולות בשברים", "subject": "math"},
    {"component_id": "CET.SCI.MASS-01", "title": "מסה ונפח",
     "unit_title": "חומרים", "objective_title": "תכונות החומר", "subject": "science"},
]


def _view(rows):
    return {"learnings": rows}


class FinderGroundingTest(unittest.IsolatedAsyncioTestCase):
    async def _find(self, llm_payload, *, rows=None, query="שברים"):
        from app.services import learning_finder

        raw = json.dumps(llm_payload) if llm_payload is not None else None
        llm = AsyncMock(return_value=raw)
        with patch.object(learning_finder.learning_analytics, "group_learnings",
                          AsyncMock(return_value=_view(_CATALOG if rows is None else rows))), \
             patch("app.services.llm.call_llm", llm):
            result = await learning_finder.find_learnings(
                "grp-1", query=query, teacher_id="teacher-1")
        return result, llm

    async def test_a_hallucinated_id_never_reaches_the_teacher(self):
        result, _ = await self._find({"options": [
            {"component_id": "CET.MATH.FRAC-01", "reason": "בדיוק הנושא"},
            {"component_id": "CET.MADE.UP-99", "reason": "נשמע קרוב"},
            {"component_id": "CET.MATH.FRAC-01", "reason": "שוב"},
            {"component_id": "CET.MATH.FRAC-02", "reason": "אותו יעד"},
        ], "similar_topic": None})
        ids = [option["component_id"] for option in result["options"]]
        self.assertEqual(ids, ["CET.MATH.FRAC-01", "CET.MATH.FRAC-02"])
        # The title is read off the catalog, never off the model.
        self.assertEqual(result["options"][0]["title"], "חיבור שברים")

    async def test_the_hint_only_appears_when_there_are_no_answers(self):
        withHits, _ = await self._find({
            "options": [{"component_id": "CET.MATH.FRAC-01", "reason": "מתאים"}],
            "similar_topic": "שברים",
        })
        self.assertIsNone(withHits["similar_topic"])

        empty, _ = await self._find({"options": [], "similar_topic": "מסה ונפח"})
        self.assertEqual(empty["options"], [])
        self.assertEqual(empty["similar_topic"], "מסה ונפח")

    async def test_an_unrelated_request_returns_nothing_at_all(self):
        result, _ = await self._find({"options": [], "similar_topic": None})
        self.assertEqual(result, {"options": [], "similar_topic": None})

    async def test_a_dead_model_degrades_to_an_empty_answer(self):
        result, _ = await self._find(None)
        self.assertEqual(result, {"options": [], "similar_topic": None})

    async def test_an_empty_catalog_never_calls_the_model(self):
        result, llm = await self._find({"options": []}, rows=[])
        self.assertEqual(result, {"options": [], "similar_topic": None})
        llm.assert_not_awaited()

    async def test_the_prompt_carries_the_catalog_and_the_request(self):
        _, llm = await self._find({"options": []}, query="חיבור שברים פשוטים")
        prompt = llm.await_args.args[0][0]["content"]
        self.assertIn("חיבור שברים פשוטים", prompt)
        self.assertIn("CET.SCI.MASS-01", prompt)


class FinderRouteTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_foreign_group_is_refused_before_any_search(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=False)):
            response = await routes.find_group_learnings(
                "grp-x", {"query": "שברים"}, session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)

    async def test_a_blank_or_bloated_query_is_a_422(self):
        from fastapi import HTTPException

        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=True)):
            for bad in ("", "   ", "א" * 301):
                with self.assertRaises(HTTPException) as caught:
                    await routes.find_group_learnings(
                        "grp-1", {"query": bad}, session={"sub": "teacher-1"})
                self.assertEqual(caught.exception.status_code, 422)

    async def test_the_route_hands_the_service_answer_through(self):
        from app.routes import teacher_students as routes

        answer = {"options": [], "similar_topic": "שברים"}
        find = AsyncMock(return_value=answer)
        with patch.object(routes, "_guard_group", AsyncMock(return_value=True)), \
             patch("app.services.learning_finder.find_learnings", find):
            response = await routes.find_group_learnings(
                "grp-1", {"query": "שברים", "subject": "math", "language": "he"},
                session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body), answer)
        self.assertEqual(find.await_args.kwargs["subject"], "math")
        self.assertEqual(find.await_args.kwargs["teacher_id"], "teacher-1")


if __name__ == "__main__":
    unittest.main()
