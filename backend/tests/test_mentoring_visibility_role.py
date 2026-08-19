"""The learner's own mentoring endpoint cannot be asked for the teacher's view.

`GET /api/mentoring` used to take `role: str = "teacher"` — an unvalidated query
argument. A learner who called it with no parameter, or with `?role=teacher`,
read the `teacher_only_note` written about them. Only the frontend's convention
of sending `role=learner` kept that shut, and a convention is not a boundary.

Two layers are tested here because the bug lived in both: the route no longer
lets the caller choose, and the service's default is no longer the privileged
view.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.dependencies import require_learner
from app.routes import mentoring as routes
from app.services import mentoring


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[require_learner] = lambda: "kid-a"
    return app


class LearnerCannotForceTheTeacherViewTest(unittest.TestCase):
    """The route passes a constant role, whatever the query string says."""

    def _get(self, url: str):
        with patch.object(
            routes.mentoring, "list_conversations", AsyncMock(return_value=[]),
        ) as listed:
            response = TestClient(_app()).get(url)
        self.assertEqual(response.status_code, 200)
        return listed

    def test_no_role_parameter_reads_as_the_learner(self):
        listed = self._get("/api/mentoring")
        listed.assert_awaited_once_with("kid-a", "learner")

    def test_role_teacher_in_the_query_is_ignored(self):
        listed = self._get("/api/mentoring?role=teacher")
        listed.assert_awaited_once_with("kid-a", "learner")

    def test_the_learner_id_in_the_query_is_ignored_too(self):
        """Identity comes from the session, never the request."""
        listed = self._get("/api/mentoring?learner_id=kid-b&role=teacher")
        listed.assert_awaited_once_with("kid-a", "learner")


class TeacherOnlyNoteIsStrippedTest(unittest.IsolatedAsyncioTestCase):
    """End to end through the real service: the note never reaches a learner."""

    ROW = {
        "id": "ment_1",
        "learner_id": "kid-a",
        "author": "teacher",
        "visibility": "shared",
        "notes": "talked about angles",
        "teacher_only_note": "sensitive to criticism",
        "goals": [],
        "created_at": "2026-08-19T10:00:00+00:00",
    }

    async def _list(self, *args):
        with patch.object(
            mentoring, "_raw_conversations", AsyncMock(return_value=[dict(self.ROW)]),
        ), patch.object(
            mentoring, "_backfill_goal_prices", AsyncMock(return_value=None),
        ):
            return await mentoring.list_conversations(*args)

    async def test_learner_view_has_no_teacher_only_note(self):
        rows = await self._list("kid-a", "learner")
        self.assertNotIn("teacher_only_note", rows[0])
        self.assertEqual(rows[0]["notes"], "talked about angles")

    async def test_teacher_view_still_has_it(self):
        rows = await self._list("kid-a", "teacher")
        self.assertEqual(rows[0]["teacher_only_note"], "sensitive to criticism")

    async def test_the_default_viewer_is_the_least_privileged_one(self):
        """Forgetting the argument must not hand out the privileged view."""
        rows = await self._list("kid-a")
        self.assertNotIn("teacher_only_note", rows[0])


if __name__ == "__main__":
    unittest.main()
