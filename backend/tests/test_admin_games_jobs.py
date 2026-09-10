"""The admin job ledger: every learner's jobs in a window, with the game's
title and the worker's instrumentation — and never a payload.
"""

from __future__ import annotations

import asyncio
import json
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth.dependencies import require_admin
from app.routes import admin_games
from app.services.games import store
from tests.games_support import COMP, GamesHarness, LEARNER, OBJECTIVE, OTHER, UNIT


def _run(coro):
    return asyncio.run(coro)


class AdminGamesJobsTest(unittest.TestCase):
    def setUp(self):
        self.harness = GamesHarness().__enter__()
        app = FastAPI()
        app.include_router(admin_games.router)
        app.dependency_overrides[require_admin] = lambda: "root"
        self.client = TestClient(app)

    def tearDown(self):
        self.harness.__exit__(None, None, None)

    async def _seed(self):
        game = await store.create_game(learner_id=LEARNER, objective_id=OBJECTIVE, unit_id=UNIT,
                                       component_id=COMP, title="Space cats", genre="runner",
                                       model="claude-sonnet-5", reasoning_effort="medium")
        other = await store.create_game(learner_id=OTHER, objective_id=OBJECTIVE, unit_id=UNIT,
                                        component_id=COMP, title="Moon dogs", genre="puzzle")
        payload = {"model": "claude-sonnet-5", "reasoning_effort": "medium",
                   "context": {"learning_description": "secret-ish paragraph"}}
        first = await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="create", payload=payload)
        await store.update_job(first["_id"], status="done", started_at="2026-09-10T10:00:00+00:00",
                               finished_at="2026-09-10T10:02:00+00:00",
                               timings={"total_s": 120.0, "model_s": [80.0]},
                               attempts_detail=[{"n": 1, "ok": True}],
                               judge={"scores": {"fun": 4}, "revised": False},
                               usage_summary={"cost_usd": 0.3})
        second = await store.create_job(game_id=other["_id"], learner_id=OTHER, kind="edit", payload={}, version=1)
        stale = await store.create_job(game_id=game["_id"], learner_id=LEARNER, kind="fix", payload={}, version=1)
        await store.update_job(stale["_id"], created_at="2020-01-01T00:00:00+00:00")
        return game, other, first, second, stale

    def test_lists_the_window_with_titles_and_instrumentation(self):
        game, other, first, second, stale = _run(self._seed())
        response = self.client.get("/api/admin/games/jobs")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        items = response.json()["items"]
        self.assertEqual([row["job_id"] for row in items], [second["_id"], first["_id"]], "newest first, window applied")
        done = items[1]
        self.assertEqual(done["title"], "Space cats")
        self.assertEqual(done["learner_id"], LEARNER)
        self.assertEqual(done["kind"], "create")
        self.assertEqual(done["status"], "done")
        self.assertEqual((done["model"], done["reasoning_effort"]), ("claude-sonnet-5", "medium"))
        self.assertEqual(done["timings"]["total_s"], 120.0)
        self.assertEqual(done["attempts_detail"], [{"n": 1, "ok": True}])
        self.assertEqual(done["judge"]["scores"]["fun"], 4)
        self.assertEqual(done["usage_summary"], {"cost_usd": 0.3})
        self.assertEqual(done["started_at"], "2026-09-10T10:00:00+00:00")
        self.assertIsNone(done["error_class"])
        self.assertEqual(items[0]["title"], "Moon dogs")
        self.assertEqual(set(done), {
            "job_id", "game_id", "learner_id", "kind", "status", "model", "reasoning_effort",
            "started_at", "finished_at", "error_class", "usage_summary", "timings",
            "attempts_detail", "judge", "title",
        })
        text = json.dumps(response.json())
        self.assertNotIn("payload", text)
        self.assertNotIn("secret-ish", text)

    def test_limit_and_since_hours(self):
        game, other, first, second, stale = _run(self._seed())
        one = self.client.get("/api/admin/games/jobs", params={"limit": 1}).json()["items"]
        self.assertEqual([row["job_id"] for row in one], [second["_id"]])
        wide = self.client.get("/api/admin/games/jobs", params={"since_hours": 24 * 90}).json()["items"]
        self.assertEqual(len(wide), 2, "the stale job is older than the widest window")
        self.assertEqual(self.client.get("/api/admin/games/jobs", params={"limit": 0}).status_code, 422)
        self.assertEqual(self.client.get("/api/admin/games/jobs", params={"since_hours": 24 * 91}).status_code, 422)


if __name__ == "__main__":
    unittest.main()
