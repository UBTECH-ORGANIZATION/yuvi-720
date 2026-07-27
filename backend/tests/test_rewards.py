"""Spark wallet invariants: idempotency, caps, and server-side price authority.

Runs entirely on the JSON fallback store (Mongo collections patched to None),
so the suite is deterministic and never touches Cosmos.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import rewards
from app.services.rewards import catalog, wallet

LEARNER = "test-learner-rewards"


class SparkWalletTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._unlocks: list[str] = []

        async def fake_unlock(learner_id: str, asset_id: str) -> list[str]:
            if asset_id not in self._unlocks:
                self._unlocks.append(asset_id)
            return list(self._unlocks)

        async def fake_state(learner_id: str) -> dict:
            return {"avatar_unlocks": list(self._unlocks)}

        self._patches = [
            patch.object(wallet, "_FALLBACK", Path(self._tmp.name) / "rewards.json"),
            patch.object(wallet, "_get_collection_named", lambda name: None),
            patch.object(wallet, "grant_avatar_unlock", fake_unlock),
            patch.object(wallet, "get_learner_state", fake_state),
        ]
        for p in self._patches:
            p.start()

    async def asyncTearDown(self) -> None:
        for p in self._patches:
            p.stop()
        self._tmp.cleanup()

    async def test_grant_is_idempotent_per_goal_and_stage(self) -> None:
        first = await rewards.grant_goal_stage(LEARNER, "g1", "started")
        replay = await rewards.grant_goal_stage(LEARNER, "g1", "started")
        self.assertEqual(first["granted"], wallet.EARN_RULES["started"])
        self.assertEqual(replay["granted"], 0)
        self.assertEqual(replay["wallet"]["balance"], wallet.EARN_RULES["started"])

    async def test_chosen_stage_never_pays(self) -> None:
        grant = await rewards.grant_goal_stage(LEARNER, "g1", "chosen")
        self.assertEqual(grant["granted"], 0)
        self.assertEqual(grant["wallet"]["balance"], 0)

    async def test_help_request_is_rewarded_once(self) -> None:
        first = await rewards.grant_help_request(LEARNER, "g1")
        replay = await rewards.grant_help_request(LEARNER, "g1")
        self.assertEqual(first["granted"], wallet.HELP_REWARD)
        self.assertEqual(replay["granted"], 0)

    async def test_daily_cap_stops_farming(self) -> None:
        for index in range(12):
            await rewards.grant_goal_stage(LEARNER, f"goal-{index}", "summarized")
        current = await rewards.get_wallet(LEARNER)
        self.assertEqual(current["balance"], wallet.DAILY_SPARK_CAP)
        self.assertEqual(current["dailyEarned"], wallet.DAILY_SPARK_CAP)

    async def test_purchase_requires_balance_and_price_comes_from_server(self) -> None:
        poor = await rewards.purchase_asset(LEARNER, "astro")
        self.assertFalse(poor["ok"])
        self.assertEqual(poor["reason"], "insufficient")
        self.assertEqual(poor["missing"], catalog.price_of("astro"))

        for index in range(4):
            await rewards.grant_goal_stage(LEARNER, f"goal-{index}", "summarized")

        bought = await rewards.purchase_asset(LEARNER, "astro")
        self.assertTrue(bought["ok"])
        self.assertEqual(bought["price"], catalog.price_of("astro"))
        self.assertEqual(
            bought["wallet"]["balance"],
            wallet.DAILY_SPARK_CAP - catalog.price_of("astro"),
        )
        self.assertIn("astro", self._unlocks)

        again = await rewards.purchase_asset(LEARNER, "astro")
        self.assertFalse(again["ok"])
        self.assertEqual(again["reason"], "owned")

    async def test_milestone_items_are_not_for_sale(self) -> None:
        self.assertIsNone(catalog.price_of("crown"))
        result = await rewards.purchase_asset(LEARNER, "crown")
        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "not_for_sale")

    async def test_ledger_records_every_movement(self) -> None:
        await rewards.grant_goal_stage(LEARNER, "g1", "started")
        await rewards.grant_help_request(LEARNER, "g1")
        entries = await rewards.list_ledger(LEARNER, limit=10)
        self.assertEqual(len(entries), 2)
        self.assertEqual({e["amount"] for e in entries}, {8, 5})

    async def test_fallback_file_stays_valid_json(self) -> None:
        await rewards.grant_goal_stage(LEARNER, "g1", "started")
        data = json.loads(wallet._FALLBACK.read_text(encoding="utf-8"))
        self.assertIn(LEARNER, data["wallets"])


if __name__ == "__main__":
    unittest.main()
