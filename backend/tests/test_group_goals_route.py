"""The class Goals screen's aggregate read: scoped like every group read."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class GroupGoalsRoute(unittest.IsolatedAsyncioTestCase):
    async def _call(self, *, guarded: bool):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_group", AsyncMock(return_value=guarded)), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b"])), \
             patch("app.services.mentoring.list_conversations",
                   AsyncMock(side_effect=lambda lid, role: [
                       {"learner": lid, "role": role, "goals": []}])) as listing:
            response = await routes.group_goals("g1", session={"sub": "teacher-1"})
        return response, listing

    async def test_out_of_scope_teacher_is_refused(self):
        response, listing = await self._call(guarded=False)
        self.assertEqual(response.status_code, 403)
        listing.assert_not_awaited()

    async def test_returns_every_learner_with_teacher_view(self):
        response, listing = await self._call(guarded=True)
        import json
        body = json.loads(response.body)
        rows = body["learners"]
        self.assertEqual([row["learner_id"] for row in rows], ["kid-a", "kid-b"])
        # The projection the learner must never see is exactly the one used here.
        for call in listing.await_args_list:
            self.assertEqual(call.args[1], "teacher")


if __name__ == "__main__":
    unittest.main()
