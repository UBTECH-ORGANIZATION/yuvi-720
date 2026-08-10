"""The messages screen's kudos read: learner-guarded, and mine-only."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class KudosListRoute(unittest.IsolatedAsyncioTestCase):
    async def test_out_of_scope_teacher_is_refused_without_reads(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value=None)), \
             patch("app.services.kudos.list_for_learner", AsyncMock()) as listing:
            response = await routes.list_kudos("kid-a", session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        listing.assert_not_awaited()

    async def test_returns_only_the_requesting_teachers_kudos(self):
        from app.routes import teacher_students as routes

        rows = [
            {"_id": "k1", "teacher_id": "teacher-1", "message": "כל הכבוד",
             "created_at": "2026-08-01", "delivered_at": None},
            {"_id": "k2", "teacher_id": "teacher-2", "message": "private praise",
             "created_at": "2026-08-02", "delivered_at": "2026-08-02"},
        ]
        with patch.object(routes, "_guard_learner", AsyncMock(return_value="kid-a")), \
             patch("app.services.kudos.list_for_learner", AsyncMock(return_value=rows)):
            response = await routes.list_kudos("kid-a", session={"sub": "teacher-1"})
        body = json.loads(response.body)
        self.assertEqual([row["id"] for row in body["kudos"]], ["k1"])
        # A co-teacher's words to the child never appear in another's thread.
        self.assertNotIn("private praise", json.dumps(body))


if __name__ == "__main__":
    unittest.main()
