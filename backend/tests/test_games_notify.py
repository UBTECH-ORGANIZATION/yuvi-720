"""The four game kinds are real notification kinds, and one event rings once."""

from __future__ import annotations

import asyncio
import unittest

from app.services import notifications, realtime
from app.services.games import notify, store
from tests.games_support import COMP, GamesHarness, LEARNER, OBJECTIVE, UNIT


class GameNotifyTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.harness = GamesHarness().__enter__()
        self.game = await store.create_game(
            learner_id=LEARNER, objective_id=OBJECTIVE, unit_id=UNIT, component_id=COMP,
            title="חתולי חלל", genre="runner",
        )

    async def asyncTearDown(self):
        self.harness.__exit__(None, None, None)

    async def test_every_game_kind_is_accepted_by_notify(self):
        for kind in notify.GAME_KINDS:
            row = await notifications.notify(LEARNER, kind, title_key=f"notif.{kind}",
                                             notification_id=f"{kind}:x:1")
            self.assertIsNotNone(row, kind)
        self.assertEqual(set(notify.GAME_KINDS),
                         {"game_ready", "game_failed", "game_edit_ready", "game_fix_ready"})

    async def test_notify_game_writes_the_row_and_pushes_the_frame(self):
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe(f"user:{LEARNER}", heartbeat=5):
                frames.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.02)

        row = await notify.notify_game(notifications.KIND_GAME_READY, self.game, 1)
        await asyncio.sleep(0.02)
        task.cancel()

        self.assertEqual(row["_id"], f"game_ready:{self.game['_id']}:1")
        self.assertEqual(row["title_key"], "notif.game_ready")
        self.assertEqual(row["params"], {"title": "חתולי חלל"})
        self.assertEqual(row["recipient_role"], "learner")
        action = row["actions"][0]
        self.assertEqual(action["label_key"], "notif.action.openGame")
        self.assertEqual(action["route"],
                         f"/games/play?game={self.game['_id']}&from=bell")
        game_frames = [frame for frame in frames if frame.get("type") == "game"]
        self.assertEqual(len(game_frames), 1)
        self.assertEqual(game_frames[0]["game_id"], self.game["_id"])
        self.assertEqual(game_frames[0]["v"], 1)
        # The bell's own frame rides the same topic.
        self.assertTrue(any(frame.get("type") == "notification" for frame in frames))

    async def test_the_same_version_rings_once(self):
        self.assertIsNotNone(await notify.notify_game("game_edit_ready", self.game, 2))
        self.assertIsNone(await notify.notify_game("game_edit_ready", self.game, 2))
        self.assertEqual(await notifications.unread_count(LEARNER), 1)

    async def test_a_non_game_kind_is_refused_here(self):
        with self.assertRaises(ValueError):
            await notify.notify_game(notifications.KIND_KUDOS, self.game, 1)

    async def test_progress_is_a_frame_and_never_a_bell(self):
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe(f"user:{LEARNER}", heartbeat=5):
                frames.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.02)
        notify.publish_progress(LEARNER, self.game["_id"], "build", status="building")
        await asyncio.sleep(0.02)
        task.cancel()

        self.assertEqual(frames[0]["event"], "build")
        self.assertEqual(frames[0]["status"], "building")
        self.assertEqual(await notifications.unread_count(LEARNER), 0)

    def test_locales_carry_every_key(self):
        import json
        from pathlib import Path

        root = Path(__file__).resolve().parents[2] / "locales"
        for lang in ("he", "en", "ar"):
            table = json.loads((root / f"{lang}.json").read_text(encoding="utf-8"))
            for kind in notify.GAME_KINDS:
                self.assertIn("{title}", table[f"notif.{kind}"], (lang, kind))
            self.assertIn("notif.action.openGame", table)


if __name__ == "__main__":
    unittest.main()
