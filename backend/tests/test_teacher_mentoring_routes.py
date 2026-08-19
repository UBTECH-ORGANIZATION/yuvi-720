"""The teacher's mentoring route is guarded like every other teacher read.

Two gates, both required: `require_teacher_session` on the route, and
`_guard_learner` → `org.teacher_can_access_learner` per learner. The refusal is
uniform on purpose — distinguishing "not yours" from "does not exist" tells an
unauthorised teacher which children are on someone else's roster.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class DocumentMentoringRouteTest(unittest.IsolatedAsyncioTestCase):
    BODY = {
        "notes": "דיברנו על זוויות",
        "goals": [{"title": "לתרגל", "deadline": "2026-09-01"}],
        "draft_id": "draft-1",
    }

    async def _call(self, *, allowed: bool, body=None):
        from app.routes import teacher_students as routes

        with patch("app.brain.org.teacher_can_access_learner",
                   AsyncMock(return_value=allowed)) as access, \
             patch("app.services.goal_approval.document_conversation",
                   AsyncMock(return_value={"id": "ment_1"})) as document:
            response = await routes.document_mentoring(
                "kid-a", dict(body or self.BODY),
                session={"sub": "teacher-1", "sid": "sid-9"},
            )
        return response, access, document

    async def test_a_teacher_off_the_roster_is_refused(self):
        response, _access, document = await self._call(allowed=False)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.body), {"error": "forbidden"})
        document.assert_not_awaited()

    async def test_the_refusal_is_never_cached(self):
        response, _access, _document = await self._call(allowed=False)
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    async def test_nothing_is_written_before_the_guard_runs(self):
        """A 403 must not have already created a conversation."""
        _response, access, document = await self._call(allowed=False)
        access.assert_awaited()
        document.assert_not_awaited()

    async def test_an_allowed_teacher_writes_the_conversation(self):
        response, _access, document = await self._call(allowed=True)
        self.assertEqual(response.status_code, 200)
        document.assert_awaited_once()
        self.assertEqual(document.await_args.args, ("teacher-1", "kid-a"))

    async def test_the_teachers_session_is_what_reports_to_the_ministry(self):
        """This path never touches the learner's route, so the statement can
        only carry the session it was generated in — the teacher's."""
        _response, _access, document = await self._call(allowed=True)
        self.assertEqual(document.await_args.kwargs["lrs_session_id"], "sid-9")

    async def test_the_body_reaches_the_service_intact(self):
        _response, _access, document = await self._call(allowed=True)
        kwargs = document.await_args.kwargs
        self.assertEqual(kwargs["notes"], "דיברנו על זוויות")
        self.assertEqual(len(kwargs["goals"]), 1)
        self.assertEqual(kwargs["draft_id"], "draft-1")

    async def test_a_service_refusal_becomes_a_status(self):
        from app.routes import teacher_students as routes
        from app.services import goal_approval

        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.goal_approval.document_conversation",
                   AsyncMock(side_effect=goal_approval.ApprovalError("empty_conversation"))):
            response = await routes.document_mentoring(
                "kid-a", {}, session={"sub": "teacher-1", "sid": "sid-9"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.body), {"error": "empty_conversation"})


if __name__ == "__main__":
    unittest.main()
