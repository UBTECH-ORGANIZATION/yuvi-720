"""Mapping rewards settle from saved answers, never from a client unlock list."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import unlock_sync
from app.services.agency_mapping import section_question_numbers

LEARNER = "kid-1"


def _state_for_sections(*sections: int) -> dict:
    answers = {
        str(question_number): 0
        for section_number in sections
        for question_number in section_question_numbers()[section_number]
    }
    return {
        "learner_id": LEARNER,
        "mapping_progress": {"answers": answers},
        "avatar_unlocks": [],
        "room_unlocks": [],
    }


class MappingSectionUnlockSyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_incomplete_section_does_not_unlock_its_reward(self) -> None:
        state = _state_for_sections(4)
        state["mapping_progress"]["answers"].popitem()

        with patch.object(unlock_sync.kata_catalog, "ensure_loaded", AsyncMock()), \
             patch.object(unlock_sync, "get_brain", AsyncMock(return_value={})), \
             patch.object(unlock_sync, "_learner_events", AsyncMock(return_value=[])), \
             patch.object(unlock_sync, "project_badges", return_value=[]), \
             patch.object(unlock_sync, "get_learner_state", AsyncMock(return_value=state)), \
             patch.object(unlock_sync, "grant_unlock", AsyncMock()) as grant:
            result = await unlock_sync.sync_unlocks(LEARNER)

        self.assertEqual(result["newly_unlocked"], [])
        grant.assert_not_awaited()

    async def test_completed_sections_are_granted_once_and_remain_held(self) -> None:
        state = _state_for_sections(4, 5, 6)

        async def grant(learner_id: str, item_id: str, reason: str) -> dict:
            self.assertEqual(learner_id, LEARNER)
            self.assertEqual(reason, f"earn:{item_id}")
            state["avatar_unlocks"].append(item_id)
            return {"granted": True}

        with patch.object(unlock_sync.kata_catalog, "ensure_loaded", AsyncMock()), \
             patch.object(unlock_sync, "get_brain", AsyncMock(return_value={})), \
             patch.object(unlock_sync, "_learner_events", AsyncMock(return_value=[])), \
             patch.object(unlock_sync, "project_badges", return_value=[]), \
             patch.object(unlock_sync, "get_learner_state", AsyncMock(return_value=state)), \
             patch.object(unlock_sync, "grant_unlock", AsyncMock(side_effect=grant)) as grant_unlock:
            first = await unlock_sync.sync_unlocks(LEARNER)
            second = await unlock_sync.sync_unlocks(LEARNER)

        self.assertEqual(first["newly_unlocked"], ["crown", "ironman", "jetpack"])
        self.assertEqual(second["newly_unlocked"], [])
        self.assertEqual(second["avatar_unlocks"], ["crown", "ironman", "jetpack"])
        self.assertEqual(grant_unlock.await_count, 3)


if __name__ == "__main__":
    unittest.main()