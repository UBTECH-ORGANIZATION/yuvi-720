"""Generate once, share: the first learner pays, the rest are free — and a
failure is never cached as an answer."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import shared_texts  # noqa: E402
from app.services.ai_usage import UsageContext  # noqa: E402

USAGE = UsageContext(actor_id="t", actor_type="learner", endpoint="t", feature="t",
                     operation="coach.proactive.question_intro", source="t")
CURRENT = {
    "component_id": "comp-1", "item_id": "comp-1-001", "question_id": "q1",
    "question": {"text": "What is the unit of mass?", "options": ["gram", "newton"],
                 "correct": ["gram"]},
    "item": {"title": "Opening", "kind": "question"},
    "informationToBot": "A screen about units. סימני שליטה: the learner answers gram.",
}


def _serve(llm, current=CURRENT, lang="en", kind="question_intro"):
    with mock.patch("app.services.llm.call_llm", llm), \
         mock.patch.object(shared_texts, "_collection", lambda: None):
        return asyncio.run(shared_texts.serve(kind, lang, current, lesson_title="Mass",
                                              usage_context=USAGE))


class GenerateOnceShare(unittest.TestCase):
    def setUp(self):
        shared_texts.reset_for_tests()

    def test_the_second_learner_is_free(self):
        llm = mock.AsyncMock(return_value="Let's look at what this question is about.")
        first = _serve(llm)
        second = _serve(llm)
        self.assertEqual(first["source"], "shared_new")
        self.assertEqual(second, {"text": first["text"], "source": "shared"})
        self.assertEqual(llm.await_count, 1)

    def test_the_answer_section_never_reaches_the_prompt(self):
        llm = mock.AsyncMock(return_value="Let's look at what this question is about.")
        _serve(llm)
        prompt = llm.await_args.args[0][1]["content"]
        self.assertNotIn("סימני שליטה", prompt)
        self.assertNotIn("answers gram", prompt)

    def test_failures_are_never_cached_as_answers(self):
        for bad in ("", "The answer is gram.", "זה בעברית", "x" * 400):
            shared_texts.reset_for_tests()
            llm = mock.AsyncMock(return_value=bad)
            self.assertIsNone(_serve(llm), bad)
            doc = next(iter(shared_texts._MEMORY.values()))
            self.assertEqual(doc["status"], "failed", bad)

    def test_a_content_change_regenerates(self):
        llm = mock.AsyncMock(return_value="Let's look at what this question is about.")
        _serve(llm)
        changed = {**CURRENT, "question": {**CURRENT["question"], "text": "Which unit measures weight?"}}
        self.assertEqual(_serve(llm, changed)["source"], "shared_new")
        self.assertEqual(llm.await_count, 2)

    def test_a_held_claim_makes_others_wait_then_fall_through(self):
        source = shared_texts._grounding("question_intro", CURRENT, "Mass")
        doc_id = shared_texts._doc_id("question_intro", "en", CURRENT)
        shared_texts._MEMORY[doc_id] = {"status": "claimed", "claimed_at": __import__("time").time(),
                                        "fingerprint": shared_texts.fingerprint(source)}
        llm = mock.AsyncMock(return_value="unused")
        with mock.patch.object(shared_texts, "WAIT_SECONDS", 0.3):
            self.assertIsNone(_serve(llm))
        self.assertEqual(llm.await_count, 0)

    def test_off_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("COACH_SHARED_TEXTS", None)
            self.assertFalse(shared_texts.enabled())


if __name__ == "__main__":
    unittest.main()
