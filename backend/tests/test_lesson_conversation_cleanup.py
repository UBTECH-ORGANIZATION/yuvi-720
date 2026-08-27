"""Lesson Coach threads are temporary; general companion threads are not."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import sessions  # noqa: E402


class LessonConversationCleanupTests(unittest.TestCase):
    def test_mongo_cleanup_hard_deletes_only_the_lesson_thread(self):
        learner_id = "learner-mongo"
        lesson_id = "lesson-thread"
        lesson_key = f"{learner_id}:{lesson_id}:lesson_coach"
        conversations = MagicMock()
        conversations.find_one = AsyncMock(return_value={"_id": lesson_key})
        conversations.delete_one = AsyncMock()
        messages = MagicMock()
        messages.delete_many = AsyncMock()
        working_memory = MagicMock()
        working_memory.delete_one = AsyncMock()
        collections = {
            "agent_conversations": conversations,
            "agent_messages": messages,
            "agent_sessions": working_memory,
        }

        with patch.object(sessions, "_get_collection_named", side_effect=collections.get):
            deleted = asyncio.run(sessions.end_lesson_conversation(learner_id, lesson_id))

        self.assertTrue(deleted)
        conversations.find_one.assert_awaited_once_with(
            {"_id": lesson_key, "learner_id": learner_id, "role": "lesson_coach"},
            {"_id": 1},
        )
        messages.delete_many.assert_awaited_once_with({
            "learner_id": learner_id,
            "conversation_id": lesson_id,
            "agent_role": "lesson_coach",
        })
        working_memory.delete_one.assert_awaited_once_with({
            "_id": lesson_key, "learner_id": learner_id, "role": "lesson_coach",
        })
        conversations.delete_one.assert_awaited_once_with({
            "_id": lesson_key, "learner_id": learner_id, "role": "lesson_coach",
        })

    def test_general_history_survives_lesson_cleanup_through_session_apis(self):
        learner_id = "learner-lifecycle"

        async def verify_lifecycle():
            general = await sessions.create_conversation(
                learner_id, role="general_companion"
            )
            lesson = await sessions.create_conversation(
                learner_id,
                role="lesson_coach",
                unit_id="unit-1",
                component_id="component-1",
            )
            await sessions.append_turn(
                learner_id,
                "general_companion",
                user="שאלה כללית",
                assistant="תשובה כללית",
                session_id=general["id"],
                exchange_id="general-exchange",
            )
            await sessions.append_turn(
                learner_id,
                "lesson_coach",
                user="רמז",
                assistant="רמז לשאלה",
                session_id=lesson["id"],
                exchange_id="lesson-exchange",
            )

            general_before = await sessions.list_conversations(
                learner_id, role="general_companion"
            )
            lesson_before = await sessions.list_messages(
                learner_id, lesson["id"], role="lesson_coach"
            )
            self.assertEqual([row["id"] for row in general_before["conversations"]], [general["id"]])
            self.assertEqual(len(lesson_before["messages"]), 2)

            self.assertTrue(await sessions.end_lesson_conversation(learner_id, lesson["id"]))

            general_after = await sessions.list_conversations(
                learner_id, role="general_companion"
            )
            general_messages = await sessions.list_messages(
                learner_id, general["id"], role="general_companion"
            )
            lesson_after = await sessions.list_messages(
                learner_id, lesson["id"], role="lesson_coach"
            )
            self.assertEqual([row["id"] for row in general_after["conversations"]], [general["id"]])
            self.assertEqual([row["text"] for row in general_messages["messages"]], ["שאלה כללית", "תשובה כללית"])
            self.assertEqual(lesson_after["messages"], [])

        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            history_path = directory_path / "history.json"
            sessions_path = directory_path / "sessions.json"
            with (
                patch.object(sessions, "_HISTORY_FALLBACK", history_path),
                patch.object(sessions, "_FALLBACK", sessions_path),
                patch.object(sessions, "_get_collection_named", return_value=None),
            ):
                asyncio.run(verify_lifecycle())

    def test_ending_lesson_thread_removes_only_lesson_records(self):
        learner_id = "learner-1"
        lesson_id = "lesson-thread"
        general_id = "general-thread"
        lesson_key = f"{learner_id}:{lesson_id}:lesson_coach"
        general_key = f"{learner_id}:{general_id}:general_companion"

        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            history_path = directory_path / "history.json"
            sessions_path = directory_path / "sessions.json"
            history_path.write_text(json.dumps({
                "conversations": {
                    lesson_key: {"learner_id": learner_id, "role": "lesson_coach"},
                    general_key: {"learner_id": learner_id, "role": "general_companion"},
                },
                "messages": {
                    "lesson-message": {
                        "learner_id": learner_id,
                        "conversation_id": lesson_id,
                        "agent_role": "lesson_coach",
                    },
                    "general-message": {
                        "learner_id": learner_id,
                        "conversation_id": general_id,
                        "agent_role": "general_companion",
                    },
                },
            }), encoding="utf-8")
            sessions_path.write_text(json.dumps({lesson_key: {"turns": []}, general_key: {"turns": []}}), encoding="utf-8")

            with patch.object(sessions, "_HISTORY_FALLBACK", history_path), patch.object(sessions, "_FALLBACK", sessions_path), patch.object(sessions, "_get_collection_named", return_value=None):
                deleted = asyncio.run(sessions.end_lesson_conversation(learner_id, lesson_id))

            self.assertTrue(deleted)
            history = json.loads(history_path.read_text(encoding="utf-8"))
            self.assertNotIn(lesson_key, history["conversations"])
            self.assertNotIn("lesson-message", history["messages"])
            self.assertIn(general_key, history["conversations"])
            self.assertIn("general-message", history["messages"])
            stored_sessions = json.loads(sessions_path.read_text(encoding="utf-8"))
            self.assertNotIn(lesson_key, stored_sessions)
            self.assertIn(general_key, stored_sessions)


if __name__ == "__main__":
    unittest.main()