from __future__ import annotations

import copy
import unittest

try:
    from backend.scripts.migrate_badge_removal import build_update, migrate
except ModuleNotFoundError:
    from scripts.migrate_badge_removal import build_update, migrate


class _Collection:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = {str(row["_id"]): copy.deepcopy(row) for row in rows}
        self.writes = 0

    async def find(self, _query):
        for row in self.rows.values():
            yield copy.deepcopy(row)

    async def update_one(self, query, update, upsert=False):
        learner_id = str(query["_id"])
        row = self.rows.setdefault(learner_id, {"_id": learner_id})
        row.update(copy.deepcopy(update.get("$set", {})))
        for key in update.get("$unset", {}):
            row.pop(key, None)
        for field, spec in update.get("$addToSet", {}).items():
            values = row.setdefault(field, [])
            for value in spec["$each"]:
                if value not in values:
                    values.append(value)
        self.writes += 1


class BadgeRemovalMigrationTests(unittest.IsolatedAsyncioTestCase):
    def test_only_studio_shaped_avatar_is_transferred(self) -> None:
        design = {"variant": "girl", "colors": {"body": "#fff"}, "equipped": {}}
        update = build_update("learner", {"avatar": design}, {})
        self.assertEqual(update["$set"]["yuvi_design"], design)

        profile_choice = {"kind": "badge", "badge": {"subject": "math"}}
        update = build_update("learner", {"avatar": profile_choice}, {})
        self.assertNotIn("yuvi_design", update["$set"])

    def test_existing_design_wins_over_legacy_avatar(self) -> None:
        current = {"variant": "boy", "equipped": {}}
        legacy = {"variant": "girl", "equipped": {}}
        update = build_update(
            "learner", {"avatar": legacy, "yuvi_design": current}, {}
        )
        self.assertNotIn("yuvi_design", update["$set"])

    def test_claimed_replacement_levels_grant_only_their_assets(self) -> None:
        update = build_update(
            "learner", {}, {"claimed_level_rewards": [3, 4, "7", 21]}
        )
        grants = update["$addToSet"]
        self.assertEqual(grants["avatar_unlocks"]["$each"], ["laurel"])
        self.assertEqual(
            grants["room_unlocks"]["$each"], ["mathBoard", "trophyShelf"]
        )

    async def test_migration_is_idempotent_and_preserves_existing_unlocks(self) -> None:
        legacy = {"variant": "girl", "equipped": {"headTop": "laurel"}}
        states = _Collection([{
            "_id": "learner",
            "avatar": legacy,
            "badges": ["old"],
            "avatar_unlocks": ["existingHat"],
            "room_unlocks": ["existingChair"],
        }])
        progression = _Collection([{
            "_id": "learner", "claimed_level_rewards": [4, 7, 12]
        }])

        first = await migrate(states, progression, dry_run=False)
        after_first = copy.deepcopy(states.rows)
        second = await migrate(states, progression, dry_run=False)

        self.assertEqual(states.rows, after_first)
        self.assertEqual(first["reward_grants"], 3)
        self.assertEqual(second["reward_grants"], 0)
        state = states.rows["learner"]
        self.assertNotIn("avatar", state)
        self.assertNotIn("badges", state)
        self.assertEqual(state["yuvi_design"], legacy)
        self.assertEqual(set(state["avatar_unlocks"]), {"existingHat", "laurel"})
        self.assertEqual(
            set(state["room_unlocks"]), {"existingChair", "trophyShelf", "podium"}
        )

    async def test_dry_run_does_not_write(self) -> None:
        states = _Collection([{"_id": "learner", "badges": ["old"]}])
        progression = _Collection([])
        before = copy.deepcopy(states.rows)

        stats = await migrate(states, progression, dry_run=True)

        self.assertEqual(states.rows, before)
        self.assertEqual(states.writes, 0)
        self.assertEqual(stats["learners"], 1)


if __name__ == "__main__":
    unittest.main()