"""Pagination and isolation checks for learner-owned Coach conversations."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import coach, sessions


class AgentChatHistoryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.collection_patch = patch.object(sessions, "_get_collection_named", return_value=None)
        self.collection_patch.start()
        self.session_path_patch = patch.object(sessions, "_FALLBACK", root / "sessions.json")
        self.history_path_patch = patch.object(sessions, "_HISTORY_FALLBACK", root / "history.json")
        self.session_path_patch.start()
        self.history_path_patch.start()
        sessions._indexes_ready = False

    async def asyncTearDown(self) -> None:
        self.history_path_patch.stop()
        self.session_path_patch.stop()
        self.collection_patch.stop()
        self.temp_dir.cleanup()

    async def test_conversations_and_messages_are_cursor_paginated(self) -> None:
        learner_id = "history-test-learner"
        first = await sessions.create_conversation(learner_id)
        for index in range(5):
            await sessions.append_turn(
                learner_id,
                "coach",
                user=f"question {index}",
                assistant=f"answer {index}",
                session_id=first["id"],
                exchange_id=f"exchange-{index}",
            )
        second = await sessions.create_conversation(learner_id)
        await sessions.append_turn(
            learner_id,
            "coach",
            user="second thread",
            assistant="second answer",
            session_id=second["id"],
            exchange_id="exchange-second",
        )
        third = await sessions.create_conversation(learner_id)

        first_page = await sessions.list_conversations(learner_id, limit=2)
        self.assertEqual(len(first_page["conversations"]), 2)
        self.assertTrue(first_page["has_more"])
        second_page = await sessions.list_conversations(
            learner_id, limit=2, cursor=first_page["next_cursor"]
        )
        conversation_ids = {
            item["id"]
            for item in first_page["conversations"] + second_page["conversations"]
        }
        self.assertEqual(conversation_ids, {first["id"], second["id"], third["id"]})

        page = await sessions.list_messages(learner_id, first["id"], limit=3)
        loaded = list(page["messages"])
        while page["has_more"]:
            page = await sessions.list_messages(
                learner_id, first["id"], limit=3, cursor=page["next_cursor"]
            )
            loaded = page["messages"] + loaded
        self.assertEqual(len(loaded), 10)
        self.assertEqual([item["role"] for item in loaded[:2]], ["user", "assistant"])
        self.assertEqual(loaded[0]["text"], "question 0")
        self.assertEqual(loaded[-1]["text"], "answer 4")
        self.assertEqual(
            await sessions.get_first_user_message(learner_id, first["id"]),
            "question 0",
        )

        recent_first = await sessions.get_recent(
            learner_id, "coach", limit=4, session_id=first["id"]
        )
        recent_second = await sessions.get_recent(
            learner_id, "coach", limit=4, session_id=second["id"]
        )
        self.assertEqual(len(recent_first), 4)
        self.assertEqual(len(recent_second), 2)
        self.assertEqual(recent_second[0]["content"], "second thread")

        visual = {"id": "visual-1", "type": "image", "data_url": "data:image/png;base64,AA=="}
        attached = await sessions.attach_visual(
            learner_id,
            first["id"],
            "exchange-4:1",
            visual,
            "answer before visual",
            "answer after visual",
        )
        self.assertTrue(attached)
        latest = await sessions.list_messages(learner_id, first["id"], limit=2)
        assistant = latest["messages"][-1]
        self.assertEqual(assistant["visual"]["id"], "visual-1")
        self.assertEqual(assistant["text_after"], "answer after visual")

        deleted = await sessions.soft_delete_conversation(learner_id, second["id"])
        self.assertTrue(deleted)
        visible = await sessions.list_conversations(learner_id, limit=10)
        self.assertNotIn(second["id"], {item["id"] for item in visible["conversations"]})
        stored = sessions._read_history_fallback()
        second_key = sessions._key(learner_id, "coach", second["id"])
        self.assertTrue(stored["conversations"][second_key]["is_deleted"])
        self.assertTrue(any(
            message.get("conversation_id") == second["id"]
            for message in stored["messages"].values()
        ))

    async def test_create_reuses_the_existing_empty_conversation(self) -> None:
        learner_id = "single-empty-conversation-learner"
        first = await sessions.create_conversation(learner_id)
        repeated = await sessions.create_conversation(learner_id)
        self.assertEqual(repeated["id"], first["id"])

        await sessions.append_turn(
            learner_id,
            "coach",
            user="How do parallel lines work?",
            assistant="Let us inspect their angles.",
            session_id=first["id"],
            exchange_id="first-completed-exchange",
        )
        next_conversation = await sessions.create_conversation(learner_id)
        self.assertNotEqual(next_conversation["id"], first["id"])

    async def test_model_title_is_short_and_never_copies_the_first_message(self) -> None:
        first_message = "Please explain how to identify similar triangles"
        with patch.object(
            coach,
            "call_llm",
            new=AsyncMock(return_value="Recognizing Similar Triangles"),
        ):
            title, source = await coach.generate_conversation_title(first_message, "en")
        self.assertEqual(title, "Recognizing Similar Triangles")
        self.assertEqual(source, "model")

        with patch.object(
            coach,
            "call_llm",
            new=AsyncMock(return_value=first_message),
        ):
            title, source = await coach.generate_conversation_title(first_message, "en")
        self.assertEqual(title, coach.TITLE_FALLBACK["en"])
        self.assertEqual(source, "fallback")
        self.assertNotEqual(title, first_message)


if __name__ == "__main__":
    unittest.main()