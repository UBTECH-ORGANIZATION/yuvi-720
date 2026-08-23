"""The generated question topics (#455): decided once, never re-rolled.

The contract under test is `goal_suggestions`' (see test_goal_suggestion_cache):
the first ask generates and stores; every later ask reads; a stored null IS a
decision and is never re-asked; only the authored content changing regenerates
a row; and the answer key never travels anywhere near the prompt.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import question_topics


class _Cursor:
    def __init__(self, items):
        self._items = list(items)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._items:
            raise StopAsyncIteration
        return self._items.pop(0)


class _FakeCollection:
    def __init__(self):
        self.docs: dict[str, dict] = {}

    def find(self, query):
        wanted = set(query["_id"]["$in"])
        return _Cursor(dict(doc) for doc_id, doc in self.docs.items() if doc_id in wanted)

    async def update_one(self, filt, update, upsert=False):
        doc = self.docs.setdefault(filt["_id"], {"_id": filt["_id"]})
        doc.update(update["$set"])


ITEMS = [
    {"id": "item-1", "title": "בסיסי 1: זיהוי תוצאה חריגה (2 סעיפים)", "question_count": 2},
    {"id": "item-2", "title": "שאלת השיא", "question_count": 1},
]

QUESTIONS = {
    "item-1": [
        {"questionId": "q1", "questionText": "סעיף א: האם ישנה תוצאה חריגה?",
         "answers": ["כן", "לא"], "correctAnswers": ["כן"]},
        {"questionId": "q2", "questionText": "סעיף ב: האם לבצע מדידה נוספת?",
         "answers": ["כן", "לא"], "correctAnswers": ["לא"]},
    ],
    "item-2": [
        {"questionId": "q1", "questionText": "חשבו את הממוצע של סדרת המדידות.",
         "answers": ["12"], "correctAnswers": ["12"]},
    ],
}


def _model_answer(topics: dict[str, str | None]) -> str:
    import json
    return json.dumps({"topics": [
        {"key": key, "topic": topic} for key, topic in topics.items()
    ]}, ensure_ascii=False)


ALL_KEYS = {
    "cmp-1|item-1|q1": "זיהוי תוצאה חריגה",
    "cmp-1|item-1|q2": "הצורך במדידה נוספת",
    "cmp-1|item-2|q1": "חישוב ממוצע מדידות",
}


class _Base(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        question_topics.reset_for_tests()
        self.collection = _FakeCollection()
        self.stack = []
        for target, value in [
            ("app.services.question_topics._collection", lambda: self.collection),
            ("app.services.kata_catalog.ensure_loaded", AsyncMock()),
            ("app.services.kata_catalog.item_profiles", lambda cid: ITEMS),
            ("app.services.kata_catalog.questions_for_item",
             lambda cid, iid: QUESTIONS.get(iid, [])),
        ]:
            patcher = patch(target, value)
            patcher.start()
            self.stack.append(patcher)

    def tearDown(self):
        for patcher in self.stack:
            patcher.stop()
        question_topics.reset_for_tests()


class GeneratedOnceAndKept(_Base):
    async def test_the_first_ask_generates_and_the_second_reads(self):
        llm = AsyncMock(return_value=_model_answer(ALL_KEYS))
        with patch("app.services.llm.call_llm", llm):
            first = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
            second = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")

        self.assertEqual(llm.await_count, 1)
        self.assertEqual(first["generated"], 3)
        self.assertEqual(second["generated"], 0)
        self.assertTrue(second["cached"])
        self.assertEqual(second["topics"]["cmp-1|item-1|q1"], "זיהוי תוצאה חריגה")

    async def test_concurrent_asks_share_one_call(self):
        async def _slow(*args, **kwargs):
            await asyncio.sleep(0.05)
            return _model_answer(ALL_KEYS)

        llm = AsyncMock(side_effect=_slow)
        with patch("app.services.llm.call_llm", llm):
            results = await asyncio.gather(
                question_topics.ensure_topics("cmp-1", "teacher-1", language="he"),
                question_topics.ensure_topics("cmp-1", "teacher-2", language="he"),
            )
        self.assertEqual(llm.await_count, 1)
        for result in results:
            self.assertEqual(result["topics"]["cmp-1|item-2|q1"], "חישוב ממוצע מדידות")

    async def test_a_stored_null_is_a_decision_and_is_never_reasked(self):
        llm = AsyncMock(return_value=_model_answer({**ALL_KEYS, "cmp-1|item-1|q2": None}))
        with patch("app.services.llm.call_llm", llm):
            first = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertIsNone(first["topics"]["cmp-1|item-1|q2"])

        with patch("app.services.llm.call_llm", AsyncMock()) as second_llm:
            second = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        second_llm.assert_not_awaited()
        self.assertIsNone(second["topics"]["cmp-1|item-1|q2"])

    async def test_a_transport_failure_stores_nothing_and_stays_retryable(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=None)):
            first = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertEqual(first["topics"], {})
        self.assertEqual(self.collection.docs, {})

        llm = AsyncMock(return_value=_model_answer(ALL_KEYS))
        with patch("app.services.llm.call_llm", llm):
            second = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertEqual(second["generated"], 3)


class RejectionRules(_Base):
    async def test_an_echo_of_the_question_is_stored_as_null(self):
        echo = {**ALL_KEYS, "cmp-1|item-2|q1": "חשבו את הממוצע של סדרת המדידות."}
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_model_answer(echo))):
            result = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertIsNone(result["topics"]["cmp-1|item-2|q1"])

    async def test_a_rambling_topic_is_stored_as_null(self):
        long = {**ALL_KEYS,
                "cmp-1|item-1|q1": "זיהוי של תוצאה חריגה מאוד בתוך סדרת מדידות ארוכה במיוחד"}
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_model_answer(long))):
            result = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertIsNone(result["topics"]["cmp-1|item-1|q1"])

    async def test_a_model_invented_key_is_dropped(self):
        invented = {**ALL_KEYS, "cmp-1|item-9|q9": "נושא מומצא"}
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_model_answer(invented))):
            result = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        self.assertNotIn("cmp-1|item-9|q9", result["topics"])


class ContentChange(_Base):
    async def test_only_the_changed_question_is_reasked(self):
        llm = AsyncMock(return_value=_model_answer(ALL_KEYS))
        with patch("app.services.llm.call_llm", llm):
            await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")

        changed = {
            "item-1": QUESTIONS["item-1"],
            "item-2": [{"questionId": "q1",
                        "questionText": "חשבו את החציון של סדרת המדידות.",
                        "answers": ["10"], "correctAnswers": ["10"]}],
        }
        second_llm = AsyncMock(return_value=_model_answer(
            {"cmp-1|item-2|q1": "חישוב חציון"}))
        with patch("app.services.kata_catalog.questions_for_item",
                   lambda cid, iid: changed.get(iid, [])), \
             patch("app.services.llm.call_llm", second_llm):
            result = await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")

        self.assertEqual(second_llm.await_count, 1)
        prompt = second_llm.await_args.args[0][0]["content"]
        self.assertIn("cmp-1|item-2|q1", prompt)
        self.assertNotIn("cmp-1|item-1|q1", prompt)
        self.assertEqual(result["topics"]["cmp-1|item-2|q1"], "חישוב חציון")
        self.assertEqual(result["topics"]["cmp-1|item-1|q1"], "זיהוי תוצאה חריגה")


class AnswersNeverTravel(_Base):
    async def test_the_prompt_carries_no_answer_key(self):
        llm = AsyncMock(return_value=_model_answer(ALL_KEYS))
        with patch("app.services.llm.call_llm", llm):
            await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")
        prompt = llm.await_args.args[0][0]["content"]
        self.assertNotIn("correctAnswers", prompt)
        self.assertNotIn('"answers"', prompt)
        # The question TEXT travels; the option strings do not.
        self.assertIn("סעיף א", prompt)


class ReadPath(_Base):
    async def test_topics_for_reads_only_what_is_stored(self):
        llm = AsyncMock(return_value=_model_answer(
            {"cmp-1|item-1|q1": "זיהוי תוצאה חריגה"}))
        with patch("app.services.llm.call_llm", llm):
            await question_topics.ensure_topics("cmp-1", "teacher-1", language="he")

        with patch("app.services.llm.call_llm", AsyncMock()) as read_llm:
            topics = await question_topics.topics_for("cmp-1", "he")
        read_llm.assert_not_awaited()
        self.assertEqual(topics.get("cmp-1|item-1|q1"), "זיהוי תוצאה חריגה")
        self.assertNotIn("cmp-1|item-2|q1", topics)


if __name__ == "__main__":
    unittest.main()
