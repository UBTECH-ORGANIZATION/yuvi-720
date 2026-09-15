"""Learning Game Lab console: caps precedence (learner → defaults → env) and
the usage report, over an in-memory database."""

import asyncio
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.console.games_budget import MAX_CAP, GameStoreError
from backend.tests.console_fakes import ConsoleHarness, seed_users


def run(coro):
    return asyncio.run(coro)


LEARNER = "kid"


def _iso(delta_hours: float = 0.0) -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=delta_hours)).isoformat()


class ConsoleGamesBudgetTests(unittest.TestCase):
    def setUp(self) -> None:
        self.h = ConsoleHarness()
        self.budget = self.h.budget
        run(seed_users(self.h, ((LEARNER, ["learner"]),)))
        self.env = patch.dict(os.environ, {}, clear=False)
        self.env.start()
        os.environ.pop("GAMES_DAILY_CREATE_CAP", None)
        os.environ.pop("GAMES_DAILY_EDIT_CAP", None)

    def tearDown(self) -> None:
        self.env.stop()

    def test_env_then_admin_defaults_then_learner_override(self):
        self.assertEqual(run(self.budget.effective_caps(LEARNER)),
                         {"create_per_day": 3, "edit_per_day": 10, "source": "env"})
        os.environ["GAMES_DAILY_CREATE_CAP"] = "4"
        self.assertEqual(run(self.budget.effective_caps(LEARNER))["create_per_day"], 4)

        run(self.budget.set_defaults("adm", create_per_day=5, edit_per_day=20))
        self.assertEqual(run(self.budget.effective_caps(LEARNER)),
                         {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})
        run(self.budget.set_learner_caps("adm", LEARNER, create_per_day=100, edit_per_day=100, note="pilot"))
        self.assertEqual(run(self.budget.effective_caps(LEARNER)),
                         {"create_per_day": 100, "edit_per_day": 100, "source": "learner"})
        self.assertEqual(run(self.budget.effective_caps("other")),
                         {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})
        stored = run(self.h.store.get_limits(LEARNER))
        self.assertEqual(stored["note"], "pilot")
        self.assertEqual(stored["updated_by"], "adm")

        run(self.budget.clear_learner_caps("adm", LEARNER))
        self.assertEqual(run(self.budget.effective_caps(LEARNER))["source"], "admin")
        # Clearing a learner without an override is a no-op, not an audit row.
        run(self.budget.clear_learner_caps("adm", "other"))
        actions = [row["action"] for row in reversed(run(self.h.org.list_audit()))]
        self.assertEqual(actions, ["set_game_limit_defaults", "set_game_limits", "clear_game_limits"])
        self.assertEqual(self.h.db.rows("learner_game_limits")[0]["_id"], "__defaults__")

    def test_bad_caps_are_refused(self):
        with self.assertRaises(GameStoreError):
            run(self.budget.set_learner_caps("adm", LEARNER, create_per_day=-1, edit_per_day=1))
        with self.assertRaises(GameStoreError):
            run(self.budget.set_defaults("adm", create_per_day=MAX_CAP + 1, edit_per_day=1))
        self.assertEqual(self.h.db.rows("learner_game_limits"), [])

    def test_usage_report_sums_job_cost_and_counts_today(self):
        games = self.h.db.rows("learner_games")
        jobs = self.h.db.rows("learner_game_jobs")
        games.append({"_id": "gm-1", "learner_id": LEARNER, "title": "Maze", "created_at": _iso()})
        games.append({"_id": "gm-2", "learner_id": LEARNER, "title": "Quiz", "created_at": _iso(),
                      "deleted_at": _iso()})
        games.append({"_id": "gm-old", "learner_id": LEARNER, "title": "Old", "created_at": _iso(-72)})
        jobs.append({"_id": "gj-1", "game_id": "gm-1", "learner_id": LEARNER, "kind": "create",
                     "status": "failed", "usage_summary": {"cost_usd": 1.25}, "created_at": _iso()})
        jobs.append({"_id": "gj-2", "game_id": "gm-2", "learner_id": LEARNER, "kind": "edit",
                     "status": "done", "usage_summary": {"cost_usd": 0.5}, "created_at": _iso()})
        jobs.append({"_id": "gj-3", "game_id": "gm-old", "learner_id": LEARNER, "kind": "create",
                     "status": "done", "usage_summary": {"cost_usd": 0.25}, "created_at": _iso(-72)})
        run(self.budget.set_learner_caps("adm", LEARNER, create_per_day=7, edit_per_day=8))
        run(self.budget.set_learner_caps("adm", "silent", create_per_day=1, edit_per_day=1))

        report = run(self.budget.usage_report())
        self.assertEqual(set(report), {"defaults", "env", "totals", "learners"})
        self.assertEqual(report["defaults"]["source"], "env")
        self.assertEqual(report["env"], {"create_per_day": 3, "edit_per_day": 10})
        self.assertEqual(report["totals"], {
            "learners": 2, "games": 2, "jobs": 3, "jobs_failed": 1,
            "cost_usd": 2.0, "cost_today_usd": 1.75, "creates_today": 2,
        })
        row, silent = report["learners"]
        self.assertEqual(row["learner_id"], LEARNER)
        self.assertEqual(row["display_name"], "Kid")
        self.assertEqual(row["username"], LEARNER)
        self.assertEqual(row["games"], 2)
        self.assertEqual(row["games_deleted"], 1)
        self.assertEqual(row["creates_today"], 2)
        self.assertEqual(row["edits_today"], 1)
        self.assertEqual(row["cost_usd"], 2.0)
        self.assertEqual(row["cost_today_usd"], 1.75)
        self.assertEqual(row["sparks"], 200)
        self.assertEqual(row["caps"], {"create_per_day": 7, "edit_per_day": 8, "source": "learner"})
        self.assertTrue(row["last_activity"])
        # A cap override without games still gets a row so it can be undone.
        self.assertEqual(silent["learner_id"], "silent")
        self.assertEqual(silent["games"], 0)
        self.assertIsNone(silent["display_name"])

    def test_jobs_window_and_game_titles(self):
        self.h.db.rows("learner_games").append({"_id": "gm-1", "learner_id": LEARNER, "title": "Maze"})
        self.h.db.rows("learner_game_jobs").extend([
            {"_id": "gj-new", "game_id": "gm-1", "learner_id": LEARNER, "kind": "create",
             "status": "done", "created_at": _iso(-1), "payload": {"secret": True}},
            {"_id": "gj-old", "game_id": "gm-1", "learner_id": LEARNER, "kind": "create",
             "status": "done", "created_at": _iso(-24 * 30)},
        ])
        recent = run(self.h.store.list_jobs_since(hours=168, limit=10))
        self.assertEqual([job["_id"] for job in recent], ["gj-new"])
        titles = run(self.h.store.get_games([job["game_id"] for job in recent]))
        self.assertEqual(titles["gm-1"]["title"], "Maze")
        self.assertEqual(run(self.h.store.get_games([])), {})


if __name__ == "__main__":
    unittest.main()
