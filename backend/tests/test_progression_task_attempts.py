from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services.tasks import attempts


class TeacherQuestProgressionTests(unittest.IsolatedAsyncioTestCase):
    def _activation(self) -> dict:
        return {
            "content_snapshot": {
                "practice": {"questions": [{"id": "q1"}, {"id": "q2"}]},
            },
        }

    async def _submit(self, questions: dict, award: AsyncMock) -> dict:
        graded = {"score": 100, "questions": questions}
        with patch.object(attempts.store, "get_activation", AsyncMock(return_value=self._activation())), \
                patch.object(attempts.store, "get_launch", AsyncMock(return_value={"status": "active"})), \
                patch.object(attempts.store, "start_attempt", AsyncMock(return_value={"status": "in_progress"})), \
                patch.object(attempts.store, "save_attempt", AsyncMock()), \
                patch.object(attempts.store, "task_of_launch", return_value="task-1"), \
                patch("app.services.tasks.grader.grade_attempt", AsyncMock(return_value=graded)), \
                patch.object(attempts, "_record_completion", AsyncMock()), \
                patch.object(attempts, "_clear_task_pin", AsyncMock()), \
                patch("app.services.progression.award_teacher_quest_completed", award):
            return await attempts.submit("quest-launch-1", "learner-1", answers={"q1": 1, "q2": 2})

    async def test_partial_teacher_quest_does_not_award_xp(self) -> None:
        award = AsyncMock()
        result = await self._submit(
            {"q1": {"skipped": False}, "q2": {"skipped": True}}, award
        )

        self.assertIsNone(result["xpReward"])
        award.assert_not_awaited()

    async def test_full_teacher_quest_awards_twenty_xp_through_authority(self) -> None:
        receipt = {"awarded": 20, "duplicate": False}
        award = AsyncMock(return_value=receipt)
        result = await self._submit(
            {"q1": {"skipped": False}, "q2": {"skipped": False}}, award
        )

        self.assertEqual(result["xpReward"], receipt)
        award.assert_awaited_once_with("learner-1", "quest-launch-1")


if __name__ == "__main__":
    unittest.main()