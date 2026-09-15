from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services.progression import ledger
from app.services.progression import rewards as progression_rewards

LEARNER = "test-learner-level-rewards"


class ProgressionRewardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.room_unlocks: list[str] = []
        self.avatar_unlocks: list[str] = []

        async def grant_room(_learner_id: str, asset_id: str) -> list[str]:
            if asset_id not in self.room_unlocks:
                self.room_unlocks.append(asset_id)
            return list(self.room_unlocks)

        async def grant_avatar(_learner_id: str, asset_id: str) -> list[str]:
            if asset_id not in self.avatar_unlocks:
                self.avatar_unlocks.append(asset_id)
            return list(self.avatar_unlocks)

        self.spark_grant = AsyncMock(return_value={"granted": 30})
        self._patches = [
            patch.object(ledger, "_FALLBACK", Path(self._tmp.name) / "progression.json"),
            patch.object(ledger, "_get_collection_named", lambda name: None),
            patch.object(progression_rewards, "grant_room_unlock", grant_room),
            patch.object(progression_rewards, "grant_avatar_unlock", grant_avatar),
            patch.object(progression_rewards, "grant_level_sparks", self.spark_grant),
        ]
        for active_patch in self._patches:
            active_patch.start()

    async def asyncTearDown(self) -> None:
        for active_patch in self._patches:
            active_patch.stop()
        self._tmp.cleanup()

    async def test_level_rewards_settle_once(self) -> None:
        first = await progression_rewards.settle_through_level(LEARNER, 3)
        replay = await progression_rewards.settle_through_level(LEARNER, 3)

        self.assertEqual([row["level"] for row in first], [2, 3])
        self.assertEqual(replay, [])
        self.spark_grant.assert_awaited_once_with(LEARNER, 2, 30)
        self.assertIn("neon", self.room_unlocks)
        self.assertIn("studio_wall_decals_03", self.room_unlocks)

    async def test_level_twenty_contains_layout_projector_and_hint(self) -> None:
        reward = progression_rewards.reward_for_level(20)
        self.assertEqual(reward["extra_hint_tokens"], 1)
        self.assertIn("layout:creatorLoft", reward["room"])
        self.assertIn("starProjector", reward["room"])

    async def test_park_rewards_extend_the_existing_level_bundles(self) -> None:
        self.assertIn("parkCarousel", progression_rewards.reward_for_level(9)["room"])
        self.assertIn("rocketModel", progression_rewards.reward_for_level(10)["room"])
        self.assertIn("parkTree", progression_rewards.reward_for_level(13)["room"])
        self.assertIn("parkBasketSwing", progression_rewards.reward_for_level(15)["room"])

    async def test_former_badge_rewards_have_explicit_xp_levels(self) -> None:
        expected = {
            4: ("room", "trophyShelf"),
            7: ("avatar", "laurel"),
            12: ("room", "podium"),
            16: ("avatar", "explorerGoggles"),
            19: ("room", "observatory"),
            21: ("room", "mathBoard"),
            28: ("room", "championBanner"),
        }
        for level, (kind, asset_id) in expected.items():
            with self.subTest(level=level, asset_id=asset_id):
                self.assertIn(asset_id, progression_rewards.reward_for_level(level)[kind])

    async def test_prestige_rewards_are_generated_through_level_fifty(self) -> None:
        level_35 = progression_rewards.reward_for_level(35)
        self.assertEqual(level_35["sparks"], 100)
        self.assertEqual(level_35["avatar"], ["prestige_level_frame_35"])
        self.assertEqual(level_35["room"], ["prestige_room_object_35"])
        self.assertNotIn("room", progression_rewards.reward_for_level(36))


if __name__ == "__main__":
    unittest.main()