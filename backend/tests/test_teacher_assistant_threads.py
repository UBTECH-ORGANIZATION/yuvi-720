"""Teacher assistant threads: they persist, they are named, and they are private.

The dock used to keep its conversation in React state, so a reload erased it,
and the one write path collapsed every teacher's entire history into a single
document called `teacher_assistant`. Threads now reuse `agents.sessions`, which
means the property worth asserting is the one that reuse could quietly break:
the teacher id is the partition key, so one teacher's threads must be invisible
and undeletable from another's session.

Storage runs on the JSON fallback here (no Mongo), which is the same code path a
dev machine uses.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import sessions
from app.routes import teacher_assistant as routes

TEACHER = "teacher-a"
OTHER = "teacher-b"


def session_for(teacher_id: str) -> dict:
    return {"sub": teacher_id, "sid": "sess-1"}


class ThreadTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.patches = [
            patch.object(sessions, "_get_collection_named", return_value=None),
            patch.object(sessions, "_FALLBACK", root / "sessions.json"),
            patch.object(sessions, "_HISTORY_FALLBACK", root / "history.json"),
        ]
        for item in self.patches:
            item.start()
        sessions._indexes_ready = False

    async def asyncTearDown(self) -> None:
        for item in reversed(self.patches):
            item.stop()
        self.temp_dir.cleanup()

    @staticmethod
    def _json(response):
        import json as _json

        return _json.loads(response.body)

    async def _new_thread(self, teacher_id: str) -> str:
        return self._json(await routes.create_conversation(session_for(teacher_id)))["id"]

    async def test_a_turn_survives_the_page_the_teacher_asked_it_from(self):
        thread = await self._new_thread(TEACHER)
        await routes._persist(
            TEACHER, "מה שלום טל?",
            {"text": "טל לא נכנס כבר שישה ימים.", "text_key": None, "tools": [], "grounded": True},
            conversation_id=thread,
        )

        page = self._json(await routes.conversation_messages(thread, limit=20, cursor=None, session=session_for(TEACHER)))
        self.assertEqual([m["role"] for m in page["messages"]], ["user", "assistant"])
        self.assertEqual(page["messages"][1]["text"], "טל לא נכנס כבר שישה ימים.")

    async def test_a_refusal_round_trips_as_its_key_not_as_a_sentence(self):
        """A stored "I don't know" must still render in the teacher's language."""
        thread = await self._new_thread(TEACHER)
        await routes._persist(
            TEACHER, "מה מזג האוויר?",
            {"text": None, "text_key": "tch.assistant.unknown.noData",
             "tools": [], "grounded": False},
            conversation_id=thread,
        )

        page = self._json(await routes.conversation_messages(thread, limit=20, cursor=None, session=session_for(TEACHER)))
        self.assertEqual(page["messages"][1]["text"], "[tch.assistant.unknown.noData]")

    async def test_a_thread_carries_its_model_written_name(self):
        thread = await self._new_thread(TEACHER)
        await routes._persist(
            TEACHER, "מה שלום טל?",
            {"text": "בסדר גמור.", "text_key": None, "tools": [], "grounded": True},
            conversation_id=thread, title="מעקב אחרי טל", title_source="model",
        )

        page = self._json(await routes.conversations(limit=12, cursor=None, session=session_for(TEACHER)))
        self.assertEqual(page["conversations"][0]["title"], "מעקב אחרי טל")

    async def test_one_teacher_cannot_see_or_delete_anothers_thread(self):
        from fastapi import HTTPException

        mine = await self._new_thread(TEACHER)
        await routes._persist(
            TEACHER, "שאלה פרטית",
            {"text": "תשובה פרטית.", "text_key": None, "tools": [], "grounded": True},
            conversation_id=mine,
        )

        theirs = self._json(await routes.conversations(limit=12, cursor=None, session=session_for(OTHER)))
        self.assertEqual(theirs["conversations"], [])

        borrowed = self._json(await routes.conversation_messages(mine, limit=20, cursor=None, session=session_for(OTHER)))
        self.assertEqual(borrowed["messages"], [])

        with self.assertRaises(HTTPException) as raised:
            await routes.delete_conversation(mine, session=session_for(OTHER))
        self.assertEqual(raised.exception.status_code, 404)

        # …and the owner still has it.
        still_mine = self._json(await routes.conversations(limit=12, cursor=None, session=session_for(TEACHER)))
        self.assertEqual(len(still_mine["conversations"]), 1)

    async def test_a_deleted_thread_leaves_the_list(self):
        thread = await self._new_thread(TEACHER)
        await routes._persist(
            TEACHER, "שאלה",
            {"text": "תשובה.", "text_key": None, "tools": [], "grounded": True},
            conversation_id=thread,
        )

        result = self._json(await routes.delete_conversation(thread, session=session_for(TEACHER)))
        self.assertTrue(result["ok"])
        page = self._json(await routes.conversations(limit=12, cursor=None, session=session_for(TEACHER)))
        self.assertEqual(page["conversations"], [])

    async def test_a_thread_is_named_once_and_not_renamed_on_every_turn(self):
        """The title is the first question's subject; later turns must not move it."""
        thread = await self._new_thread(TEACHER)
        with patch("app.agents.conversation_titles.call_llm",
                   AsyncMock(return_value="מעקב אחרי טל")):
            task = await routes._start_title_task(TEACHER, thread, "מה שלום טל?", "he")
            title, source = await routes._resolve_title(task, "he")
        self.assertEqual((title, source), ("מעקב אחרי טל", "model"))

        await routes._persist(
            TEACHER, "מה שלום טל?",
            {"text": "בסדר.", "text_key": None, "tools": [], "grounded": True},
            conversation_id=thread, title=title, title_source=source,
        )

        # Second turn: the thread already has a name, so no title call is made.
        self.assertIsNone(await routes._start_title_task(TEACHER, thread, "ומה עם דנה?", "he"))


if __name__ == "__main__":
    unittest.main()
