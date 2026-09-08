"""The games store: CRUD, versions, the cursor, the caps, and the answer log.

Runs against the JSON fallback in a temp dir — the same code path a dev box
without credentials uses, and the one that would silently touch production if
`conftest.py` had not blanked the connection string.
"""

from __future__ import annotations

import unittest

from app.services.games import store
from tests.games_support import COMP, GamesHarness, LEARNER, OBJECTIVE, OTHER, UNIT


async def _make(learner: str = LEARNER, **overrides) -> dict:
    fields = dict(learner_id=learner, objective_id=OBJECTIVE, unit_id=UNIT, component_id=COMP,
                  title="Space cats", genre="runner", prompt="space cats")
    fields.update(overrides)
    return await store.create_game(**fields)


class GameStoreTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.harness = GamesHarness().__enter__()

    async def asyncTearDown(self):
        self.harness.__exit__(None, None, None)

    # ── games ────────────────────────────────────────────────────────────────

    async def test_create_then_get(self):
        game = await _make()
        self.assertTrue(game["_id"].startswith("gm-"))
        self.assertEqual(game["status"], "queued")
        self.assertEqual(game["current_version"], 0)
        self.assertEqual(game["versions"], [])
        self.assertIsNone(game["deleted_at"])
        self.assertEqual((await store.get_game(game["_id"]))["title"], "Space cats")

    async def test_list_is_newest_first_and_learner_scoped(self):
        first = await _make()
        second = await _make()
        await _make(OTHER)
        rows, cursor = await store.list_games(LEARNER)
        self.assertEqual([row["_id"] for row in rows], [second["_id"], first["_id"]])
        self.assertIsNone(cursor)

    async def test_list_pages_by_created_at_cursor(self):
        ids = [(await _make())["_id"] for _ in range(5)]
        page1, cursor = await store.list_games(LEARNER, limit=2)
        self.assertEqual([row["_id"] for row in page1], [ids[4], ids[3]])
        self.assertIsNotNone(cursor)
        page2, cursor2 = await store.list_games(LEARNER, limit=2, cursor=cursor)
        self.assertEqual([row["_id"] for row in page2], [ids[2], ids[1]])
        page3, cursor3 = await store.list_games(LEARNER, limit=2, cursor=cursor2)
        self.assertEqual([row["_id"] for row in page3], [ids[0]])
        self.assertIsNone(cursor3)

    async def test_list_filters_by_component_and_objective(self):
        mine = await _make()
        await _make(component_id="COMP-Z")
        await _make(component_id="COMP-Y", objective_id="MOE.OTHER")
        rows, _ = await store.list_games(LEARNER, component_id=COMP)
        self.assertEqual([row["_id"] for row in rows], [mine["_id"]])
        rows, _ = await store.list_games(LEARNER, objective_id=OBJECTIVE)
        self.assertEqual(len(rows), 2)

    async def test_status_ladder_is_validated(self):
        game = await _make()
        await store.update_status(game["_id"], "building")
        self.assertEqual((await store.get_game(game["_id"]))["status"], "building")
        with self.assertRaises(store.GameStoreError):
            await store.update_status(game["_id"], "done")

    async def test_add_version_makes_it_current_and_ready(self):
        game = await _make()
        await store.update_status(game["_id"], "failed", errors_last=[{"message": "boom"}])
        entry = await store.add_version(game["_id"], blob_path="games/k/g/v1/index.html",
                                        sha256="abc", source="create", summary="first",
                                        title="חתולי חלל", sparks=3)
        self.assertEqual(entry["v"], 1)
        game = await store.get_game(game["_id"])
        self.assertEqual(game["status"], "ready")
        self.assertEqual(game["current_version"], 1)
        self.assertEqual(game["errors_last"], [])
        self.assertEqual(game["title"], "חתולי חלל")
        self.assertEqual(game["sparks_spent"], 3)
        second = await store.add_version(game["_id"], blob_path="…/v2/index.html",
                                         sha256="def", source="edit", summary="bigger cats")
        self.assertEqual(second["v"], 2)
        self.assertEqual((await store.get_game(game["_id"]))["current_version"], 2)

    async def test_revert_needs_an_existing_version(self):
        game = await _make()
        await store.add_version(game["_id"], blob_path="a", sha256="1", source="create")
        await store.add_version(game["_id"], blob_path="b", sha256="2", source="edit")
        reverted = await store.set_current_version(game["_id"], 1)
        self.assertEqual(reverted["current_version"], 1)
        self.assertEqual(store.version_entry(reverted)["blob_path"], "a")
        with self.assertRaises(store.GameStoreError):
            await store.set_current_version(game["_id"], 7)

    async def test_soft_delete_hides_but_keeps(self):
        game = await _make()
        await store.soft_delete(game["_id"])
        rows, _ = await store.list_games(LEARNER)
        self.assertEqual(rows, [])
        kept = await store.get_game(game["_id"])
        self.assertIsNotNone(kept["deleted_at"])

    # ── caps ─────────────────────────────────────────────────────────────────

    async def test_daily_create_count_includes_deleted_games(self):
        game = await _make()
        await _make()
        await store.soft_delete(game["_id"])
        self.assertEqual(await store.count_created_today(LEARNER), 2)
        self.assertEqual(await store.count_created_today(OTHER), 0)

    async def test_job_counts_by_kind_and_fix_count_by_version(self):
        game = await _make()
        await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="create", payload={})
        await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="edit", payload={}, version=1)
        await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="fix", payload={}, version=1)
        await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="fix", payload={}, version=2)
        self.assertEqual(await store.count_jobs_today(LEARNER, "edit"), 1)
        self.assertEqual(await store.count_jobs_today(LEARNER, "fix"), 2)
        self.assertEqual(await store.count_fix_jobs_for_version(game["_id"], 1), 1)
        self.assertEqual(await store.count_fix_jobs_for_version(game["_id"], 3), 0)
        latest = await store.latest_job(game["_id"])
        self.assertEqual(latest["kind"], "fix")
        with self.assertRaises(store.GameStoreError):
            await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="rebuild", payload={})

    # ── answers ──────────────────────────────────────────────────────────────

    async def test_answers_are_sequenced_per_game_and_learner(self):
        game = await _make()
        for correct in (True, False, True):
            await store.record_answer(game_id=game["_id"], learner_id=LEARNER,
                                      question_id="item-1#q1", item_id="item-1",
                                      component_id=COMP, correct=correct)
        rows = await store.list_answers(game["_id"], LEARNER)
        self.assertEqual([row["seq"] for row in rows], [1, 2, 3])
        self.assertEqual(rows[1]["_id"], f"{game['_id']}:{LEARNER}:2")
        self.assertEqual([row["correct"] for row in rows], [True, False, True])
        self.assertEqual(await store.list_answers(game["_id"], OTHER), [])


if __name__ == "__main__":
    unittest.main()
