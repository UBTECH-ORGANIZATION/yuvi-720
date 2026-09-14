from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.progression import ledger, rules

LEARNER = "test-learner-progression"


class ProgressionLedgerTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_module_award_is_idempotent_and_auditable(self) -> None:
        first = await rules.award_module_completed(LEARNER, "module-1", "goal-1")
        replay = await rules.award_module_completed(LEARNER, "module-1", "goal-1")

        self.assertEqual(first["awarded"], 15)
        self.assertFalse(first["duplicate"])
        self.assertEqual(replay["awarded"], 0)
        self.assertTrue(replay["duplicate"])
        self.assertEqual(replay["progression"]["totalXp"], 15)

        entries = await ledger.list_ledger(LEARNER)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["reason"], "learning_module.completed")
        self.assertEqual(entries[0]["source"]["module_id"], "module-1")

    async def test_personal_path_opening_award_is_idempotent(self) -> None:
        first = await rules.award_personal_path_started(LEARNER)
        replay = await rules.award_personal_path_started(LEARNER)

        self.assertEqual(first["awarded"], 20)
        self.assertFalse(first["duplicate"])
        self.assertEqual(replay["awarded"], 0)
        self.assertTrue(replay["duplicate"])

    async def test_server_owned_rules_accumulate_and_cross_levels(self) -> None:
        await rules.award_learning_goal_completed(LEARNER, "goal-1")
        await rules.award_teacher_quest_completed(LEARNER, "quest-1")
        await rules.award_objective_stage(LEARNER, "objective-1", "started", is_first=True)
        await rules.award_objective_stage(LEARNER, "objective-1", "progressed", is_first=True)

        status = await ledger.get_status(LEARNER)
        self.assertEqual(status["totalXp"], 120)
        self.assertEqual(status["level"], 2)
        self.assertEqual(status["currentLevelXp"], 20)

    async def test_later_objective_only_awards_completion(self) -> None:
        started = await rules.award_objective_stage(
            LEARNER, "objective-2", "started", is_first=False
        )
        progressed = await rules.award_objective_stage(
            LEARNER, "objective-2", "progressed", is_first=False
        )
        completed = await rules.award_objective_stage(
            LEARNER, "objective-2", "summarized", is_first=False
        )
        replay = await rules.award_objective_stage(
            LEARNER, "objective-2", "summarized", is_first=False
        )
        self.assertEqual(started["awarded"], 0)
        self.assertEqual(progressed["awarded"], 0)
        self.assertEqual(completed["awarded"], 50)
        self.assertEqual(replay["awarded"], 0)
        self.assertTrue(replay["duplicate"])

    async def test_first_objective_awards_each_stage_once(self) -> None:
        started = await rules.award_objective_stage(
            LEARNER, "objective-1", "started", is_first=True
        )
        progressed = await rules.award_objective_stage(
            LEARNER, "objective-1", "progressed", is_first=True
        )
        completed = await rules.award_objective_stage(
            LEARNER, "objective-1", "summarized", is_first=True
        )
        replay = await rules.award_objective_stage(
            LEARNER, "objective-1", "summarized", is_first=True
        )

        self.assertEqual([started["awarded"], progressed["awarded"], completed["awarded"]], [20, 30, 50])
        self.assertEqual(replay["awarded"], 0)
        self.assertTrue(replay["duplicate"])
        self.assertEqual((await ledger.get_status(LEARNER))["totalXp"], 100)

    async def test_help_xp_only_exists_at_approved_milestones(self) -> None:
        before = await rules.award_help_milestone(LEARNER, 29)
        milestone = await rules.award_help_milestone(LEARNER, 30)
        replay = await rules.award_help_milestone(LEARNER, 30)
        after = await rules.award_help_milestone(LEARNER, 91)

        self.assertEqual(before["awarded"], 0)
        self.assertEqual(milestone["awarded"], 15)
        self.assertEqual(replay["awarded"], 0)
        self.assertEqual(after["awarded"], 0)

    async def test_unique_help_requests_award_only_the_thirtieth(self) -> None:
        for index in range(29):
            result = await rules.record_qualifying_help(LEARNER, f"request-{index}")
            self.assertEqual(result["awarded"], 0)

        milestone = await rules.record_qualifying_help(LEARNER, "request-29")
        replay = await rules.record_qualifying_help(LEARNER, "request-29")
        next_request = await rules.record_qualifying_help(LEARNER, "request-30")

        self.assertEqual(milestone["awarded"], 15)
        self.assertEqual(milestone["helpRequestCount"], 30)
        self.assertEqual(replay["awarded"], 0)
        self.assertTrue(replay["duplicate"])
        self.assertEqual(replay["helpRequestCount"], 30)
        self.assertEqual(next_request["awarded"], 0)
        self.assertEqual(next_request["helpRequestCount"], 31)


if __name__ == "__main__":
    unittest.main()