"""v1.1 `requested` and `selected` from the platform and the relay."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import events


class RelayedHelpTests(unittest.IsolatedAsyncioTestCase):
    async def _fields(self, event, statement=None):
        with patch.object(events, "get_session_events", AsyncMock(return_value=[])), \
             patch("app.services.kata_catalog.questions_for_item", return_value=[
                 {"questionId": "q1", "questionType": "choice"}]):
            return await events._content_report_fields(event, statement)

    async def test_the_contents_hint_button_names_its_source_and_kind(self):
        ext, _ = await self._fields({
            "verb": "requested", "learner_id": "kid", "session_id": "s",
            "launch": "cmp-1", "sub_item_id": "cmp-1-003", "question_id": "q1",
        })
        self.assertEqual(ext["helpSource"], "content")
        self.assertEqual(ext["helpType"], "hint")
        self.assertEqual(ext["questionId"], "q1")
        self.assertEqual(ext["questionType"], "choice")
        self.assertEqual(ext["attemptNumber"], 1)

    async def test_a_declared_on_list_help_type_is_kept_an_off_list_one_is_a_hint(self):
        base = {"verb": "requested", "learner_id": "kid", "session_id": "s", "launch": "cmp-1"}
        ext, _ = await self._fields(base, {"context": {"extensions": {
            "https://lxp.education.gov.il/xapi/moe/extensions/helpType": "explanation"}}})
        self.assertEqual(ext["helpType"], "explanation")
        ext, _ = await self._fields(base, {"context": {"extensions": {
            "https://lxp.education.gov.il/xapi/moe/extensions/helpType": "cheat-sheet"}}})
        self.assertEqual(ext["helpType"], "hint")


class PracticeDecisionTests(unittest.IsolatedAsyncioTestCase):
    async def _choose(self, choice):
        from app.routes import learning_catalog

        report, store = AsyncMock(), AsyncMock()
        with patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": "cmp-1", "unit_id": "u1"}), \
             patch("app.services.events.record_path_choice", store), \
             patch("app.services.lrs.reporter.report_selected", report), \
             patch.dict("os.environ", {"LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.co.il"}):
            await learning_catalog.record_path_choice(
                learning_catalog.PathChoiceRequest(component_id="cmp-1", choice=choice),
                session={"sub": "kid", "sid": "sid-1", "roles": ["learner"]},
            )
        return report, store

    async def test_taking_the_extra_is_practice_decision_true(self):
        report, store = await self._choose("more_practice")
        store.assert_awaited_once()
        kwargs = report.await_args.kwargs
        self.assertEqual(kwargs["selection_type"], "practice-decision")
        self.assertEqual(kwargs["response"], "true")
        self.assertEqual(kwargs["object_id"], "https://spark.yuvilab.co.il/component/cmp-1")
        self.assertEqual(kwargs["object_type"], "component")

    async def test_declining_the_offer_is_practice_decision_false_and_no_path_evidence(self):
        report, store = await self._choose("continue")
        store.assert_not_awaited()
        self.assertEqual(report.await_args.kwargs["response"], "false")

    def test_the_wire_value_is_the_v11_token(self):
        from app.services.lrs import statements

        stmt = statements.selected(
            {"exidentifier": "1", "school": None, "nmm": None}, "sid",
            object_id="https://x/component/c", object_type="component",
            selection_type="practice-decision", response="true",
        )
        ext = {k.rsplit("/", 1)[-1]: v for k, v in stmt["context"]["extensions"].items()}
        self.assertEqual(ext["selectionType"], "practice-decision")
        self.assertEqual(stmt["result"]["response"], "true")


if __name__ == "__main__":
    unittest.main()


class ForwardDuplicateTests(unittest.TestCase):
    def setUp(self):
        events._recent_forwards.clear()

    def test_the_same_statement_repeated_within_the_burst_window_is_dropped(self):
        stmt = {"verb": {"id": "http://adlnet.gov/expapi/verbs/initialized"}, "object": {"id": "https://lomdot.example/x/p1"}}
        event = {"verb": "initialized", "object_id": "https://lomdot.example/x/p1"}
        self.assertFalse(events._is_forward_duplicate("kid", stmt, event))
        self.assertTrue(events._is_forward_duplicate("kid", stmt, event))
        # A different object, or a different learner, is a new statement.
        other = {"verb": {"id": "http://adlnet.gov/expapi/verbs/initialized"}, "object": {"id": "https://lomdot.example/x/p2"}}
        self.assertFalse(events._is_forward_duplicate("kid", other, {"verb": "initialized", "object_id": "https://lomdot.example/x/p2"}))
        self.assertFalse(events._is_forward_duplicate("kid-2", stmt, event))

    def test_a_second_answer_with_a_different_result_is_not_a_duplicate(self):
        base = {"verb": {"id": "http://adlnet.gov/expapi/verbs/answered"}, "object": {"id": "https://lomdot.example/x/q1"}}
        event = {"verb": "answered", "object_id": "https://lomdot.example/x/q1"}
        self.assertFalse(events._is_forward_duplicate("kid", {**base, "result": {"success": False}}, event))
        self.assertFalse(events._is_forward_duplicate("kid", {**base, "result": {"success": True}}, event))
