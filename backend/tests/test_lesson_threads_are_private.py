"""A lesson chat belongs to the lesson — it never shows up in chat history.

The thread Yuvi opens inside a learning activity is a per-question conversation
about the screen in front of the learner: it is opened, scoped and closed by the
activity itself. Listing it among the threads the learner started on their own
buries those in noise and offers to reopen a conversation whose whole context is
a question they have moved past.

It must still be fully readable from inside the lesson — this is about the
history LIST, not about deleting anything.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import sessions  # noqa: E402


def _conversation(cid: str, *, component=None, unit=None, updated="2026-07-28T10:00:00+00:00"):
    doc = {
        "_id": cid, "session_id": cid, "learner_id": "L", "role": "coach",
        "title": cid, "title_source": "model", "message_count": 2,
        "updated_at": updated, "created_at": updated, "is_deleted": False,
    }
    if component:
        doc["activity_component_id"] = component
        doc["activity_unit_id"] = unit or "unit-1"
        doc["activity_status"] = "open"
    return doc


class LessonThreadsExcludedFromHistoryTests(unittest.IsolatedAsyncioTestCase):
    """Exercised through the FALLBACK store, which applies the same rule as the
    Mongo query and needs no database."""

    async def _list(self, conversations):
        history = {"conversations": {c["_id"]: c for c in conversations}, "messages": {}}
        with (
            patch.object(sessions, "_get_collection_named", return_value=None),
            patch.object(sessions, "_ensure_indexes", new=AsyncMock()),
            patch.object(sessions, "_migrate_legacy_default", new=AsyncMock()),
            patch.object(sessions, "_read_history_fallback", return_value=history),
        ):
            return await sessions.list_conversations("L", role="coach", limit=20)

    async def test_a_lesson_thread_is_not_listed(self):
        result = await self._list([
            _conversation("own-chat"),
            _conversation("lesson-chat", component="methodica-science-mass-measure-01-01"),
        ])
        ids = [c["id"] for c in result["conversations"]]
        self.assertIn("own-chat", ids)
        self.assertNotIn("lesson-chat", ids)

    async def test_a_learner_started_thread_is_still_listed(self):
        result = await self._list([_conversation("own-chat")])
        self.assertEqual([c["id"] for c in result["conversations"]], ["own-chat"])

    async def test_a_history_of_only_lesson_threads_reads_as_empty(self):
        result = await self._list([
            _conversation("l1", component="comp-a"),
            _conversation("l2", component="comp-b"),
        ])
        self.assertEqual(result["conversations"], [])

    async def test_the_mongo_query_carries_the_same_rule(self):
        """The two stores must not disagree about what history means."""
        captured: dict = {}

        class _Cursor:
            def sort(self, *_a, **_k): return self
            def limit(self, *_a, **_k): return self
            async def to_list(self, length=None): return []

        class _Collection:
            def find(self, query):
                captured["query"] = query
                return _Cursor()

        with (
            patch.object(sessions, "_get_collection_named", return_value=_Collection()),
            patch.object(sessions, "_ensure_indexes", new=AsyncMock()),
            patch.object(sessions, "_migrate_legacy_default", new=AsyncMock()),
        ):
            await sessions.list_conversations("L", role="coach", limit=5)
        # `None` matches documents where the field is null OR absent, so threads
        # written before the field existed are treated as the learner's own.
        self.assertIn("activity_component_id", captured["query"])
        self.assertIsNone(captured["query"]["activity_component_id"])


if __name__ == "__main__":
    unittest.main()
