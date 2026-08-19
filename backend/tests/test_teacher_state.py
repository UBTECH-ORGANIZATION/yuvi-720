"""A teacher's own UI state: their row, their draft, bounded.

The composer writes this on a debounce while a teacher types, which is what
makes the two properties below matter — a client may only write the one key it
owns, and it may not grow the document without limit.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.dependencies import require_teacher_session
from app.routes import teacher_state as routes
from app.services import teacher_state as store

DRAFT = {"draft_id": "d1", "learner_id": "kid-a", "notes": "we talked", "goals": []}


class _FakeCollection:
    def __init__(self, document=None):
        self.document = document
        self.updates: list[dict] = []

    async def find_one(self, _query):
        return self.document

    async def update_one(self, _query, update, upsert=False):
        self.updates.append(update["$set"])
        self.document = {**(self.document or {}), **update["$set"]}


class StoreTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_draft_round_trips(self):
        collection = _FakeCollection()
        with patch.object(store, "_get_collection_named", return_value=collection):
            await store.update_teacher_state("teacher-1", {"mentoring_draft": DRAFT})
            state = await store.get_teacher_state("teacher-1")
        self.assertEqual(state["mentoring_draft"], DRAFT)
        self.assertEqual(state["teacher_id"], "teacher-1")

    async def test_a_client_cannot_write_a_key_it_does_not_own(self):
        collection = _FakeCollection()
        with patch.object(store, "_get_collection_named", return_value=collection):
            await store.update_teacher_state(
                "teacher-1", {"mentoring_draft": DRAFT, "roles": ["admin"], "teacher_id": "x"})
        written = collection.updates[0]
        self.assertNotIn("roles", written)
        self.assertEqual(written["teacher_id"], "teacher-1", "identity is the server's")

    async def test_an_oversized_draft_is_refused_not_truncated(self):
        """Half a teacher's notes stored silently is worse than a failed save."""
        huge = {"notes": "x" * (store.MAX_DRAFT_BYTES + 1)}
        collection = _FakeCollection()
        with patch.object(store, "_get_collection_named", return_value=collection):
            with self.assertRaises(store.TeacherStateError) as caught:
                await store.update_teacher_state("teacher-1", {"mentoring_draft": huge})
        self.assertEqual(caught.exception.code, "draft_too_large")
        self.assertEqual(collection.updates, [], "nothing is written when it is refused")

    async def test_clearing_the_draft_is_allowed(self):
        collection = _FakeCollection({"mentoring_draft": DRAFT})
        with patch.object(store, "_get_collection_named", return_value=collection):
            state = await store.update_teacher_state("teacher-1", {"mentoring_draft": None})
        self.assertIsNone(state["mentoring_draft"])

    async def test_an_unknown_teacher_reads_an_empty_state(self):
        with patch.object(store, "_get_collection_named", return_value=_FakeCollection()):
            state = await store.get_teacher_state("nobody")
        self.assertEqual(state, {"teacher_id": "nobody", "mentoring_draft": None})

    async def test_a_missing_id_fails_loudly(self):
        """The reason `normalize_learner_id` raises: a mis-wired route must not
        quietly read and write some other account."""
        with self.assertRaises(ValueError):
            await store.get_teacher_state("")


class RouteTest(unittest.TestCase):
    def _client(self) -> TestClient:
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[require_teacher_session] = lambda: {
            "sub": "teacher-1", "roles": ["teacher"],
        }
        return TestClient(app)

    def test_reading_returns_this_teachers_state(self):
        with patch.object(
            routes.store, "get_teacher_state",
            AsyncMock(return_value={"teacher_id": "teacher-1", "mentoring_draft": None}),
        ) as read:
            response = self._client().get("/api/teacher/state")
        self.assertEqual(response.status_code, 200)
        read.assert_awaited_once_with("teacher-1")
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_the_identity_comes_from_the_session_not_the_body(self):
        with patch.object(
            routes.store, "update_teacher_state",
            AsyncMock(return_value={"teacher_id": "teacher-1", "mentoring_draft": DRAFT}),
        ) as write:
            response = self._client().patch(
                "/api/teacher/state",
                json={"mentoring_draft": DRAFT, "teacher_id": "somebody-else"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(write.await_args.args[0], "teacher-1")
        self.assertNotIn("teacher_id", write.await_args.args[1])

    def test_a_patch_that_says_nothing_does_not_blank_the_draft(self):
        """`exclude_unset`: clearing has to be asked for, never implied."""
        with patch.object(
            routes.store, "update_teacher_state",
            AsyncMock(return_value={"teacher_id": "teacher-1", "mentoring_draft": DRAFT}),
        ) as write:
            self._client().patch("/api/teacher/state", json={})
        self.assertEqual(write.await_args.args[1], {})

    def test_an_explicit_null_does_clear_it(self):
        with patch.object(
            routes.store, "update_teacher_state",
            AsyncMock(return_value={"teacher_id": "teacher-1", "mentoring_draft": None}),
        ) as write:
            self._client().patch("/api/teacher/state", json={"mentoring_draft": None})
        self.assertEqual(write.await_args.args[1], {"mentoring_draft": None})

    def test_an_oversized_draft_becomes_a_400(self):
        with patch.object(
            routes.store, "update_teacher_state",
            AsyncMock(side_effect=store.TeacherStateError("draft_too_large")),
        ):
            response = self._client().patch(
                "/api/teacher/state", json={"mentoring_draft": {"notes": "x"}})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content), {"error": "draft_too_large"})


if __name__ == "__main__":
    unittest.main()
