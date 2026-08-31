"""Weekly Studio surprise selection stays deterministic and teacher-gated."""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

from app.services import studio_surprises


def _conversation(*goals):
    return {"id": "conversation-1", "visibility": "shared", "goals": list(goals)}


def _goal(goal_id: str, deadline: str, **extra):
    return {"id": goal_id, "title": f"Goal {goal_id}", "deadline": deadline, "status": "open", **extra}


class StudioSurprisesTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.records: dict[str, dict] = {}
        self.now = datetime(2026, 8, 31, tzinfo=timezone.utc)

    def _storage(self):
        async def load(record_id):
            return self.records.get(record_id)

        async def create(record):
            return self.records.setdefault(record["id"], record)

        return patch("app.services.studio_surprises._load", new=load), patch(
            "app.services.studio_surprises._create", new=create)

    async def test_reserves_the_open_goal_with_the_nearest_deadline_once(self):
        conversations = [_conversation(
            _goal("later", "2026-09-10"),
            _goal("first", "2026-09-03"),
            _goal("done", "2026-09-01", status="done"),
        )]
        load, create = self._storage()
        with load, create, patch("app.services.mentoring._raw_conversations", new=AsyncMock(return_value=conversations)):
            first = await studio_surprises.get_weekly_surprise("learner-a", self.now)
            again = await studio_surprises.get_weekly_surprise("learner-a", self.now)

        self.assertTrue(first["available"])
        self.assertEqual(first["state"], "covered")
        self.assertEqual(first["goal"]["title"], "Goal first")
        self.assertNotIn("reward_kind", first, "the cloak must not reveal its reward")
        self.assertEqual(again, first)
        self.assertEqual(len(self.records), 1)

    async def test_returns_no_surprise_when_no_deadlined_open_goal_exists(self):
        load, create = self._storage()
        conversations = [_conversation(_goal("missing", ""), _goal("done", "2026-09-02", status="done"))]
        with load, create, patch("app.services.mentoring._raw_conversations", new=AsyncMock(return_value=conversations)):
            result = await studio_surprises.get_weekly_surprise("learner-a", self.now)
        self.assertEqual(result, {"available": False, "week": "2026-W36"})

    async def test_approval_reveals_only_the_matching_current_week_surprise(self):
        record_id = "learner-a:2026-W36"
        self.records[record_id] = {
            "id": record_id, "learner_id": "learner-a", "week": "2026-W36",
            "conversation_id": "conversation-1", "goal_id": "goal-1",
            "goal_title": "Fractions", "reward_kind": "surprise_arcade", "state": "covered",
        }
        with patch("app.services.studio_surprises._load", new=AsyncMock(return_value=self.records[record_id])), \
             patch("app.services.studio_surprises._get_collection_named", return_value=None), \
             patch("app.services.studio_surprises._read_fallback", return_value=[self.records[record_id]]), \
             patch("app.services.studio_surprises._write_fallback"):
            await studio_surprises.reveal_approved_goal("learner-a", "conversation-1", "goal-1")
        self.assertEqual(self.records[record_id]["state"], "revealed")

    async def test_approval_before_a_studio_visit_creates_a_revealed_reward(self):
        conversations = [_conversation(_goal("goal-1", "2026-09-03"))]
        load, create = self._storage()
        with load, create, patch("app.services.mentoring._raw_conversations", new=AsyncMock(return_value=conversations)), \
             patch("app.services.studio_surprises.week_key", return_value="2026-W36"):
            await studio_surprises.reveal_approved_goal("learner-a", "conversation-1", "goal-1")
        record = self.records["learner-a:2026-W36"]
        self.assertEqual(record["state"], "revealed")
        self.assertEqual(record["goal_title"], "Goal goal-1")
