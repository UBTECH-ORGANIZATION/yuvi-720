from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import mentoring


class ProgressionMentoringTests(unittest.IsolatedAsyncioTestCase):
    def test_first_goal_is_deterministic_and_includes_deleted_history(self) -> None:
        records = [
            {
                "id": "conversation-b",
                "created_at": "2026-02-01T00:00:00Z",
                "goals": [{"id": "goal-b", "deleted": False}],
            },
            {
                "id": "conversation-a",
                "created_at": "2026-01-01T00:00:00Z",
                "deleted": True,
                "goals": [{"id": "goal-a", "deleted": True}],
            },
        ]
        self.assertEqual(mentoring._first_goal_id_from_records(records), "goal-a")

    async def test_progress_update_returns_sparks_and_xp_receipts(self) -> None:
        record = {
            "id": "conversation-1",
            "learner_id": "learner-1",
            "goals": [{
                "id": "goal-1",
                "progress_stage": "chosen",
                "reward_value": 40,
                "deleted": False,
            }],
            "deleted": False,
        }
        spark_receipt = {"granted": 10}
        xp_receipt = {"awarded": 20, "duplicate": False}
        with patch.object(
            mentoring, "_load_conversation", AsyncMock(return_value=record)
        ), patch.object(
            mentoring, "_save_conversation", AsyncMock()
        ), patch.object(
            mentoring, "_project_goals", AsyncMock()
        ), patch.object(
            mentoring, "_first_persisted_goal_id", AsyncMock(return_value="goal-1")
        ), patch.object(
            mentoring.rewards, "grant_goal_stage", AsyncMock(return_value=spark_receipt)
        ), patch.object(
            mentoring.progression_ledger,
            "remember_first_objective",
            AsyncMock(return_value="goal-1"),
        ), patch.object(
            mentoring.progression,
            "award_objective_stage",
            AsyncMock(return_value=xp_receipt),
        ) as award_xp:
            result = await mentoring.update_goal_progress(
                "learner-1", "conversation-1", "goal-1", "started"
            )

        self.assertEqual(result["reward"], spark_receipt)
        self.assertEqual(result["xpReward"], xp_receipt)
        award_xp.assert_awaited_once_with(
            "learner-1", "goal-1", "started", is_first=True
        )


if __name__ == "__main__":
    unittest.main()