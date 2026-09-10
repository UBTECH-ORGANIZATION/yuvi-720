"""The games store: CRUD, versions, the cursor, the caps, model/effort, and
the admin's job window.

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

    # ── model / effort / instrumentation ─────────────────────────────────────

    async def test_model_and_effort_live_on_the_game_and_the_job(self):
        game = await _make()
        self.assertIsNone(game["model"])
        self.assertEqual(game["reasoning_effort"], "low")
        for gone in ("question_mode", "question_total", "question_kinds"):
            self.assertNotIn(gone, game)
        picked = await _make(model="claude-sonnet-5", reasoning_effort="medium")
        self.assertEqual((picked["model"], picked["reasoning_effort"]), ("claude-sonnet-5", "medium"))
        with self.assertRaises(store.GameStoreError):
            await _make(reasoning_effort="max")

        job = await store.create_job(game_id=picked["_id"], learner_id=LEARNER, kind="create",
                                     payload={"model": "claude-sonnet-5", "reasoning_effort": "medium"})
        self.assertEqual((job["model"], job["reasoning_effort"]), ("claude-sonnet-5", "medium"))
        for key in ("timings", "attempts_detail", "judge"):
            self.assertIsNone(job[key])
        bare = await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="create", payload={})
        self.assertIsNone(bare["model"])
        self.assertEqual(bare["reasoning_effort"], "low")
        # The worker's instrumentation lands through update_job as-is.
        updated = await store.update_job(job["_id"], timings={"total_s": 80.0}, judge={"scores": {"fun": 3}})
        self.assertEqual(updated["timings"], {"total_s": 80.0})
        self.assertEqual((await store.get_job(job["_id"]))["judge"]["scores"]["fun"], 3)

    async def test_add_version_keeps_the_judge_verdict(self):
        game = await _make()
        verdict = {"scores": {"learning_through_play": 4, "fun": 3}, "notes": "ok", "revised": False}
        entry = await store.add_version(game["_id"], blob_path="a", sha256="1", source="create", judge=verdict)
        self.assertEqual(entry["judge"], verdict)
        stored = await store.get_game(game["_id"])
        self.assertEqual(stored["versions"][0]["judge"]["scores"]["fun"], 3)
        plain = await store.add_version(game["_id"], blob_path="b", sha256="2", source="edit")
        self.assertIsNone(plain["judge"])

    async def test_list_jobs_since_windows_newest_first_with_titles(self):
        game = await _make(title="Space cats")
        other = await _make(OTHER, title="Moon dogs")
        first = await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="create", payload={})
        second = await store.create_job(game_id=other["_id"], learner_id=OTHER, kind="edit", payload={}, version=1)
        stale = await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="fix", payload={}, version=1)
        await store.update_job(stale["_id"], created_at="2020-01-01T00:00:00+00:00")
        rows = await store.list_jobs_since(hours=24)
        self.assertEqual([row["_id"] for row in rows], [second["_id"], first["_id"]])
        self.assertEqual([row["_id"] for row in await store.list_jobs_since(hours=24, limit=1)], [second["_id"]])
        titles = await store.get_games([row["game_id"] for row in rows] + ["gm-missing"])
        self.assertEqual({gid: row["title"] for gid, row in titles.items()},
                         {game["_id"]: "Space cats", other["_id"]: "Moon dogs"})
        self.assertEqual(await store.get_games([]), {})


if __name__ == "__main__":
    unittest.main()
