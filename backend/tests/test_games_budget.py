"""Daily caps: env → admin defaults → learner override, and the cost report."""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.services.games import budget, store  # noqa: E402
from tests.games_support import CREATE_BODY, LEARNER, GamesHarness, app_for  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.harness = GamesHarness().__enter__()
        self.audit = AsyncMock()
        self.harness.enter_context(patch.object(budget.org_repository, "record_audit", self.audit))
        self.harness.enter_context(patch.object(budget, "get_user_by_id", AsyncMock(return_value={
            "_id": LEARNER, "username": "kid", "display_name": "Kid", "roles": ["learner"],
        })))
        self.client = TestClient(app_for())

    def tearDown(self):
        self.harness.__exit__(None, None, None)

    def test_env_then_admin_defaults_then_learner_override(self):
        self.assertEqual(run(budget.effective_caps(LEARNER)),
                         {"create_per_day": 3, "edit_per_day": 10, "source": "env"})
        run(budget.set_defaults("adm", create_per_day=5, edit_per_day=20))
        self.assertEqual(run(budget.effective_caps(LEARNER)),
                         {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})
        run(budget.set_learner_caps("adm", LEARNER, create_per_day=100, edit_per_day=100, note="pilot"))
        self.assertEqual(run(budget.effective_caps(LEARNER)),
                         {"create_per_day": 100, "edit_per_day": 100, "source": "learner"})
        self.assertEqual(run(budget.effective_caps("other")),
                         {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})
        run(budget.clear_learner_caps("adm", LEARNER))
        self.assertEqual(run(budget.effective_caps(LEARNER))["source"], "admin")
        actions = [call.kwargs["action"] for call in self.audit.call_args_list]
        self.assertEqual(actions, ["set_game_limit_defaults", "set_game_limits", "clear_game_limits"])

    def test_bad_caps_are_refused(self):
        with self.assertRaises(store.GameStoreError):
            run(budget.set_learner_caps("adm", LEARNER, create_per_day=-1, edit_per_day=1))
        with self.assertRaises(store.GameStoreError):
            run(budget.set_defaults("adm", create_per_day=budget.MAX_CAP + 1, edit_per_day=1))

    def test_override_lifts_the_create_cap_on_the_route(self):
        for _ in range(3):
            self.assertEqual(self.client.post("/api/games", json=CREATE_BODY).status_code, 201)
        self.assertEqual(self.client.post("/api/games", json=CREATE_BODY).status_code, 429)
        run(budget.set_learner_caps("adm", LEARNER, create_per_day=100, edit_per_day=100))
        self.assertEqual(self.client.post("/api/games", json=CREATE_BODY).status_code, 201)

    def test_usage_report_sums_job_cost_and_counts_today(self):
        created = self.client.post("/api/games", json=CREATE_BODY).json()
        run(store.update_job(created["job_id"], status="failed", usage_summary={"cost_usd": 1.25}))
        second = self.client.post("/api/games", json=CREATE_BODY).json()
        run(store.update_job(second["job_id"], status="done", usage_summary={"cost_usd": 0.5}))
        run(budget.set_learner_caps("adm", LEARNER, create_per_day=7, edit_per_day=8))

        report = run(budget.usage_report())
        self.assertEqual(report["totals"]["cost_usd"], 1.75)
        self.assertEqual(report["totals"]["jobs_failed"], 1)
        [row] = report["learners"]
        self.assertEqual(row["display_name"], "Kid")
        self.assertEqual(row["games"], 2)
        self.assertEqual(row["creates_today"], 2)
        self.assertEqual(row["cost_usd"], 1.75)
        self.assertEqual(row["sparks"], 175)
        self.assertEqual(row["caps"], {"create_per_day": 7, "edit_per_day": 8, "source": "learner"})


if __name__ == "__main__":
    unittest.main()
