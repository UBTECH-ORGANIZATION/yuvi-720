"""The question-quality classifier (PBI 451): gated, closed-enum, write-once,
and invisible to the child.

    python -m pytest tests/test_question_quality.py -q

A wrong label is a wrong judgement about a child, so anything the model
returns outside the taxonomy is dropped, never coerced. And the label is a
teacher-side reading — the student chat payload must never carry it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import sessions
from app.services import question_quality


class LearningChatGate(unittest.TestCase):
    """Companion/general chat is never classified — same boundary as the
    `yuvi_chat` activity row: a lesson question open, or the lesson screen."""

    def test_a_question_key_opens_the_gate(self) -> None:
        self.assertTrue(question_quality.is_learning_chat("comp|item|q1", None))

    def test_the_lesson_screen_opens_the_gate(self) -> None:
        self.assertTrue(question_quality.is_learning_chat(
            None, {"screen": "learning_lesson"}))

    def test_companion_chat_stays_out(self) -> None:
        self.assertFalse(question_quality.is_learning_chat(None, None))
        self.assertFalse(question_quality.is_learning_chat(
            None, {"screen": "student_dashboard"}))
        self.assertFalse(question_quality.is_learning_chat("", {}))


class ClassifyTests(unittest.IsolatedAsyncioTestCase):
    async def _classify(self, raw, text="למה התשובה שלי לא נכונה?"):
        with patch("app.services.question_quality.call_llm",
                   new=AsyncMock(return_value=raw)) as llm:
            result = await question_quality.classify(
                text, subject="math", lang="he", usage_context=object())
        return result, llm

    async def test_a_valid_label_is_returned(self) -> None:
        result, _ = await self._classify('{"label": "self_diagnostic", "confidence": 0.9}')
        self.assertEqual(result["label"], "self_diagnostic")
        self.assertEqual(result["confidence"], 0.9)

    async def test_a_label_outside_the_taxonomy_is_dropped(self) -> None:
        result, _ = await self._classify('{"label": "brilliant", "confidence": 0.9}')
        self.assertIsNone(result)

    async def test_broken_json_is_dropped_not_coerced(self) -> None:
        result, _ = await self._classify("not json at all")
        self.assertIsNone(result)

    async def test_a_message_too_short_to_be_a_question_skips_the_call(self) -> None:
        result, llm = await self._classify('{"label": "conceptual"}', text="כ")
        self.assertIsNone(result)
        llm.assert_not_called()


class WriteOnceTests(unittest.IsolatedAsyncioTestCase):
    """`set_question_quality` labels a message exactly once (fallback path)."""

    def _history(self, store):
        return patch.object(sessions, "_read_history_fallback", lambda: store), \
            patch.object(sessions, "_write_history_fallback", lambda h: None), \
            patch.object(sessions, "_get_collection_named", lambda name: None)

    async def test_the_first_write_lands_and_the_second_is_a_no_op(self) -> None:
        store = {"messages": {"ex1:0": {
            "learner_id": "kid", "conversation_id": "s1",
            "agent_role": "lesson_coach", "message_role": "user",
        }}, "conversations": {}}
        reads, writes, collection = self._history(store)
        with reads, writes, collection:
            first = await sessions.set_question_quality(
                "kid", "s1", "ex1", {"label": "conceptual"}, role="lesson_coach")
            second = await sessions.set_question_quality(
                "kid", "s1", "ex1", {"label": "answer_seeking"}, role="lesson_coach")
        self.assertTrue(first)
        self.assertFalse(second)
        self.assertEqual(
            store["messages"]["ex1:0"]["question_quality"]["label"], "conceptual")

    async def test_another_learners_message_is_unwritable(self) -> None:
        store = {"messages": {"ex1:0": {
            "learner_id": "someone-else", "conversation_id": "s1",
            "agent_role": "coach", "message_role": "user",
        }}, "conversations": {}}
        reads, writes, collection = self._history(store)
        with reads, writes, collection:
            written = await sessions.set_question_quality(
                "kid", "s1", "ex1", {"label": "conceptual"})
        self.assertFalse(written)


class PrivacyInvariant(unittest.TestCase):
    def test_the_label_never_reaches_the_student_payload(self) -> None:
        payload = sessions._message_payload({
            "_id": "ex1:0", "message_role": "user", "content": "למה?",
            "question_quality": {"label": "self_diagnostic", "confidence": 0.9},
        })
        self.assertNotIn("question_quality", payload)
        flattened = str(payload)
        self.assertNotIn("self_diagnostic", flattened)


class StoreBothTests(unittest.IsolatedAsyncioTestCase):
    """The lesson chat is a TEMPORARY thread (deleted on lesson exit), so the
    label is stamped on the message AND written durably to learner_signals."""

    async def test_classify_and_store_writes_message_and_durable_row(self) -> None:
        stamped: list[tuple] = []
        durable: list[tuple] = []

        async def fake_set(learner, session, exchange, quality, role="coach"):
            stamped.append((exchange, quality["label"], role))
            return True

        async def fake_record(learner, kind, **kwargs):
            durable.append((kind, kwargs.get("dedupe_key"), kwargs.get("meta")))

        with patch("app.services.question_quality.classify",
                   new=AsyncMock(return_value={"label": "verification", "confidence": 0.8, "v": 1})), \
                patch("app.agents.sessions.set_question_quality", side_effect=fake_set), \
                patch("app.services.learner_signals.record", side_effect=fake_record):
            await question_quality.classify_and_store(
                "kid", "s1", "ex1", "זה נכון?",
                subject="math", question_key="c|i|q", lang="he",
                role="lesson_coach", usage_context=object())
        self.assertEqual(stamped, [("ex1", "verification", "lesson_coach")])
        self.assertEqual(durable, [("question_quality", "qq:ex1",
                                    {"label": "verification", "confidence": 0.8,
                                     "question_key": "c|i|q"})])

    async def test_an_unclassifiable_message_writes_nothing(self) -> None:
        with patch("app.services.question_quality.classify",
                   new=AsyncMock(return_value=None)), \
                patch("app.agents.sessions.set_question_quality") as stamp, \
                patch("app.services.learner_signals.record") as record:
            await question_quality.classify_and_store(
                "kid", "s1", "ex1", "טקסט",
                subject=None, question_key=None, lang="he", usage_context=object())
        stamp.assert_not_called()
        record.assert_not_called()


if __name__ == "__main__":
    unittest.main()
