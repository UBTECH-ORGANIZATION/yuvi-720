"""The lesson reflection flow: why it opened (the v1.1 `reflectionTrigger`)
and how it closes when the learner dismisses it."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import reflection_flow


class TriggerDerivationTests(unittest.TestCase):
    def test_a_finished_objective_outranks_everything(self):
        self.assertEqual(
            reflection_flow.derive_reflection_trigger(
                unit_state="completed", evidence={"wrong_count": 5}, events=[],
            ),
            "end-of-learning-objective",
        )

    def test_a_struggle_is_a_difficult_task(self):
        for evidence, events, support in (
            ({"wrong_count": 2}, [], None),
            ({"wrong_count": 0, "misconceptions": ["unit-confusion"]}, [], None),
            ({"wrong_count": 0}, [{"verb": "requested"}], None),
            ({"wrong_count": 0}, [], {"hint_level": 1}),
            ({"wrong_count": 0}, [], {"explanation": True}),
        ):
            with self.subTest(evidence=evidence, events=events, support=support):
                self.assertEqual(
                    reflection_flow.derive_reflection_trigger(
                        unit_state="in_progress", evidence=evidence, events=events, support_used=support,
                    ),
                    "difficult-task",
                )

    def test_a_plain_finish_is_the_end_of_the_component(self):
        self.assertEqual(
            reflection_flow.derive_reflection_trigger(
                unit_state="in_progress", evidence={"wrong_count": 1, "misconceptions": []},
                events=[{"verb": "answered"}], support_used={"hint_level": 0, "hint": False},
            ),
            "end-of-learning-component",
        )


class DismissTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        reflection_flow._MEMORY_FLOWS.clear()
        self.reports: list[tuple] = []

    async def _open_flow(self, answered: dict | None = None, skipped: list | None = None):
        flow = {
            "_id": "r1", "learner_id": "kid", "component_id": "c1", "moe_session_id": "sid",
            "questions": [
                {"number": 1, "kind": "rating", "text": "?"},
                {"number": 2, "kind": "open", "text": "??"},
                {"number": 3, "kind": "open", "text": "???"},
            ],
            "answers": answered or {}, "skipped": skipped or [], "status": "open",
            "started_at": "2026-09-17T10:00:00+00:00",
        }
        reflection_flow._MEMORY_FLOWS["r1"] = flow
        return flow

    async def _dismiss(self):
        skipped, completed = AsyncMock(), AsyncMock()
        with patch.object(reflection_flow, "_flows_collection", AsyncMock(return_value=None)), \
             patch.object(reflection_flow.lrs_reporter, "report_reflection_skipped", skipped), \
             patch.object(reflection_flow.lrs_reporter, "report_reflection_completed", completed):
            result = await reflection_flow.dismiss_reflection("kid", "r1")
        return result, skipped, completed

    async def test_open_questions_are_skipped_and_the_flow_closes_unfinished(self):
        await self._open_flow(answered={"1": {"rating": 4}})
        result, skipped, completed = await self._dismiss()
        self.assertEqual(result, {"ok": True, "dismissed": True})
        self.assertEqual([call.args[3] for call in skipped.await_args_list], [2, 3])
        completed.assert_awaited_once()
        self.assertEqual(completed.await_args.kwargs["completion"], False)
        self.assertGreater(completed.await_args.args[3], 0)
        self.assertEqual(reflection_flow._MEMORY_FLOWS["r1"]["status"], "dismissed")

    async def test_already_skipped_questions_are_not_skipped_twice(self):
        await self._open_flow(skipped=[2])
        _, skipped, _ = await self._dismiss()
        self.assertEqual([call.args[3] for call in skipped.await_args_list], [1, 3])

    async def test_dismissing_twice_or_after_completion_does_nothing(self):
        flow = await self._open_flow()
        flow["status"] = "completed"
        result, skipped, completed = await self._dismiss()
        self.assertEqual(result, {"ok": True, "already": True})
        skipped.assert_not_awaited()
        completed.assert_not_awaited()

    async def test_an_unknown_flow_is_none(self):
        result, _, _ = await self._dismiss()
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
