"""The learning description service: cached per (component, language, prompt
version), regenerated only on authored-content drift, one in-flight task per
key, a fallback that stores nothing — and a prompt that carries question texts
as evidence but never an answer.
"""

from __future__ import annotations

import asyncio
import json
import unittest
from typing import Any
from unittest.mock import AsyncMock, patch

from app.services.games import learning_descriptions as ld
from tests.games_support import COMP, OBJECTIVE, UNIT, snapshot

GOOD = ("In this lesson kids learn to read mass off a balance in kilograms and grams, "
        "convert 1 kg = 1000 g, and tell mass from weight. Typical mistake: mixing the two. "
        "Values stay between 1 and 20 kg.")


class _Collection:
    """The two Mongo calls the module makes, on a dict."""

    def __init__(self) -> None:
        self.docs: dict[str, dict[str, Any]] = {}

    async def find_one(self, query):
        return self.docs.get(query["_id"])

    async def update_one(self, query, update, upsert=False):
        self.docs[query["_id"]] = {**self.docs.get(query["_id"], {}), **update["$set"], "_id": query["_id"]}


def _reply(text: str = GOOD) -> str:
    return json.dumps({"description": text})


class LearningDescriptionsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        snap = snapshot()
        self.component = snap["components"][COMP]
        self.unit = snap["units"][UNIT]
        self.objective = snap["objectives"][OBJECTIVE]
        self.coll = _Collection()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=self.coll)
        self._patch.start()
        ld.reset_for_tests()

    async def asyncTearDown(self):
        self._patch.stop()
        ld.reset_for_tests()

    def _ensure(self, language="he"):
        return ld.ensure_description(self.component, self.unit, self.objective, actor_id="kid-a", language=language)

    # ── id and fingerprint ───────────────────────────────────────────────────

    def test_doc_id_carries_the_prompt_version(self):
        self.assertEqual(ld._doc_id(COMP, "he"), f"{COMP}|he|{ld.PROMPT_VERSION}")
        self.assertTrue(ld._doc_id(COMP, "he").endswith("|v1"))

    def test_fingerprint_reacts_to_authored_content_and_not_to_answers(self):
        base = ld.fingerprint(self.component, self.unit, self.objective)
        self.assertEqual(base, ld.fingerprint(self.component, self.unit, self.objective))
        retitled = {**self.component, "title": "Other"}
        self.assertNotEqual(base, ld.fingerprint(retitled, self.unit, self.objective))
        redescribed = {**self.objective, "description": "changed"}
        self.assertNotEqual(base, ld.fingerprint(self.component, self.unit, redescribed))
        by_item = json.loads(json.dumps(self.component["questions_by_item"]))
        by_item["item-1"][0]["correctAnswers"] = ["גרם"]
        rekeyed = {**self.component, "questions_by_item": by_item}
        self.assertEqual(base, ld.fingerprint(rekeyed, self.unit, self.objective), "answers are not content")

    # ── cache ────────────────────────────────────────────────────────────────

    async def test_cache_hit_skips_the_model(self):
        fp = ld.fingerprint(self.component, self.unit, self.objective)
        self.coll.docs[ld._doc_id(COMP, "he")] = {"_id": ld._doc_id(COMP, "he"), "text": "stored", "fingerprint": fp}
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            self.assertEqual(await self._ensure(), "stored")
        llm.assert_not_awaited()
        self.assertEqual(await ld.cached(COMP, "he"), "stored")
        self.assertEqual(await ld.cached(COMP, "he", fingerprint=fp), "stored")
        self.assertIsNone(await ld.cached(COMP, "he", fingerprint="other"), "a stale row is a miss for the picker")
        self.assertIsNone(await ld.cached(COMP, "en"))

    async def test_fingerprint_drift_regenerates(self):
        doc_id = ld._doc_id(COMP, "he")
        self.coll.docs[doc_id] = {"_id": doc_id, "text": "stale", "fingerprint": "old"}
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            self.assertEqual(await self._ensure(), GOOD)
        llm.assert_awaited_once()
        doc = self.coll.docs[doc_id]
        self.assertEqual(doc["text"], GOOD)
        self.assertEqual(doc["fingerprint"], ld.fingerprint(self.component, self.unit, self.objective))
        self.assertEqual(doc["component_id"], COMP)
        self.assertEqual(doc["language"], "he")
        self.assertTrue(doc["generated_at"])

    async def test_generation_stores_and_a_second_call_reads(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            self.assertEqual(await self._ensure(), GOOD)
            self.assertEqual(await self._ensure(), GOOD)
        llm.assert_awaited_once()

    # ── failure ──────────────────────────────────────────────────────────────

    async def test_failure_returns_the_fallback_and_stores_nothing(self):
        fallback = ld._fallback(self.component, self.unit, self.objective, "he")
        self.assertIn(f"Title of {COMP}", fallback)
        self.assertIn("מסה", fallback)
        for reply in (RuntimeError("down"), None, "", "not json", _reply("too short")):
            mock = AsyncMock(side_effect=reply) if isinstance(reply, Exception) else AsyncMock(return_value=reply)
            with patch("app.services.llm.call_llm", mock):
                self.assertEqual(await self._ensure(), fallback, repr(reply))
            self.assertEqual(self.coll.docs, {}, "a failure is never frozen into the cache")
        # The next call asks again.
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())):
            self.assertEqual(await self._ensure(), GOOD)
        self.assertEqual(len(self.coll.docs), 1)

    # ── in-flight sharing ────────────────────────────────────────────────────

    async def test_concurrent_callers_share_one_task(self):
        calls = 0

        async def slow(*args, **kwargs):
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.02)
            return _reply()

        with patch("app.services.llm.call_llm", AsyncMock(side_effect=slow)):
            results = await asyncio.gather(self._ensure(), self._ensure(), self._ensure())
        self.assertEqual(results, [GOOD, GOOD, GOOD])
        self.assertEqual(calls, 1)
        self.assertEqual(ld._tasks, {}, "the task leaves the registry when it finishes")

    async def test_languages_are_separate_keys(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            await asyncio.gather(self._ensure("he"), self._ensure("en"))
        self.assertEqual(llm.await_count, 2)
        self.assertEqual(set(self.coll.docs), {ld._doc_id(COMP, "he"), ld._doc_id(COMP, "en")})

    # ── the prompt ───────────────────────────────────────────────────────────

    async def test_prompt_carries_question_texts_as_evidence_but_never_answers(self):
        with patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            await self._ensure()
        messages = llm.await_args.args[0]
        text = json.dumps(messages, ensure_ascii=False)
        self.assertIn("Which tool measures mass?", text)
        self.assertIn("Science for 7th Grade", text)
        self.assertIn("Mass is measured with a balance.", text, "teacher notes brief the writer")
        self.assertIn("tell mass from weight", text)
        for forbidden in ("correctAnswers", "Balance  Scale", "קילוגרם", "Ruler", "whatever"):
            self.assertNotIn(forbidden, text)
        kwargs = llm.await_args.kwargs
        self.assertEqual(kwargs["model_tier"], "mini")
        self.assertTrue(kwargs["json_mode"])
        self.assertEqual(kwargs["max_tokens"], 500)
        self.assertEqual(kwargs["timeout"], 20)
        self.assertEqual(kwargs["usage_context"].operation, "game.learning_description")
        self.assertEqual(kwargs["usage_context"].feature, "feature_7_learning_games")

    async def test_no_database_still_generates_without_storing(self):
        with patch("app.brain.repository._get_collection_named", return_value=None), \
             patch("app.services.llm.call_llm", AsyncMock(return_value=_reply())) as llm:
            self.assertEqual(await self._ensure(), GOOD)
            self.assertIsNone(await ld.cached(COMP, "he"))
        llm.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
