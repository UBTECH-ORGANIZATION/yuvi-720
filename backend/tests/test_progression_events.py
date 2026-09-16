from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services import events
from app.services.progression import ledger


class ProgressionEventSettlementTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._patches = [
            patch.object(ledger, "_FALLBACK", Path(self._tmp.name) / "progression.json"),
            patch.object(ledger, "_get_collection_named", lambda name: None),
        ]
        for active_patch in self._patches:
            active_patch.start()

    async def asyncTearDown(self) -> None:
        for active_patch in self._patches:
            active_patch.stop()
        self._tmp.cleanup()

    async def test_component_completion_alone_does_not_award_xp(self) -> None:
        event = {
            "_id": "event-1",
            "learner_id": "learner-1",
            "verb": "completed",
            "launch": "component-1",
            "object_id": "component-1",
            "unit_id": "unit-1",
            "objective_id": "goal-1",
        }
        with patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
                patch("app.services.kata_catalog.get_unit", return_value={"id": "unit-1"}), \
                patch(
                    "app.services.learning_progress.project_unit_roadmap",
                    AsyncMock(return_value={"unit_state": "in_progress"}),
                ), \
                patch(
                    "app.services.progression.award_module_completed", AsyncMock()
                ) as award_module:
            rewards = await events._settle_progression(event, {})

        self.assertEqual(rewards, [])
        award_module.assert_not_awaited()

    async def test_completed_module_and_new_goal_transition_award_both(self) -> None:
        event = {
            "_id": "event-2",
            "learner_id": "learner-1",
            "verb": "completed",
            "launch": "component-2",
            "object_id": "component-2",
            "unit_id": "unit-1",
            "objective_id": "goal-1",
        }
        with patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
                patch("app.services.kata_catalog.get_unit", return_value={"id": "unit-1"}), \
                patch(
                    "app.services.learning_progress.project_unit_roadmap",
                    AsyncMock(return_value={"unit_state": "completed"}),
                ), \
                patch(
                    "app.services.progression.award_module_completed",
                    AsyncMock(return_value={"awarded": 15}),
                ) as award_module, \
                patch(
                    "app.services.progression.award_learning_goal_completed",
                    AsyncMock(return_value={"awarded": 50}),
                ) as award_goal:
            rewards = await events._settle_progression(
                event, {"objective_achieved_now": True}
            )

        self.assertEqual([reward["awarded"] for reward in rewards], [50, 15])
        award_goal.assert_awaited_once_with("learner-1", "goal-1")
        award_module.assert_awaited_once_with("learner-1", "unit-1", "goal-1")

    async def test_item_completion_is_not_module_completion(self) -> None:
        event = {
            "_id": "event-3",
            "learner_id": "learner-1",
            "verb": "completed",
            "launch": "component-1",
            "object_id": "component-1/item-1",
            "sub_item_id": "item-1",
            "unit_id": "unit-1",
        }
        with patch(
            "app.services.progression.award_module_completed", AsyncMock()
        ) as award_module:
            rewards = await events._settle_progression(event, {})

        self.assertEqual(rewards, [])
        award_module.assert_not_awaited()

    async def test_completed_roadmap_awards_module_once_across_replayed_xapi(self) -> None:
        event = {
            "_id": "event-4",
            "learner_id": "learner-1",
            "verb": "completed",
            "launch": "component-2",
            "object_id": "component-2",
            "unit_id": "unit-1",
            "objective_id": "goal-1",
        }
        with patch("app.services.kata_catalog.ensure_loaded", AsyncMock()), \
                patch("app.services.kata_catalog.get_unit", return_value={"id": "unit-1"}), \
                patch(
                    "app.services.learning_progress.project_unit_roadmap",
                    AsyncMock(return_value={"unit_state": "completed"}),
                ):
            first = await events._settle_progression(event, {})
            replay = await events._settle_progression(event, {})

        self.assertEqual(first[0]["awarded"], 15)
        self.assertEqual(replay[0]["awarded"], 0)
        self.assertTrue(replay[0]["duplicate"])


if __name__ == "__main__":
    unittest.main()