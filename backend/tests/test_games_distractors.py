"""Choice questions that ship with the key as their only option get real
options; matching questions are dropped; nothing else is touched."""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.games import distractors  # noqa: E402


def run(coro):
    return asyncio.run(coro)


COMPONENT = {
    "id": "c1", "title": "מערכת צירים",
    "questions_by_item": {
        "item-1": [
            {"questionId": "q1", "questionType": "choice", "questionText": "מה השיעורים של A?",
             "answers": ["(2,3)"], "correctAnswers": ["(2,3)"]},
            {"questionId": "q2", "questionType": "choice", "questionText": "איזה קטע אופקי?",
             "answers": ["AB", "CD", "EF"], "correctAnswers": ["AB"]},
            {"questionId": "q3", "questionType": "matching", "questionText": "גררו",
             "answers": ["{'source': ['A'], 'target': ['(1,1)']}"], "correctAnswers": ["{'source': 'A', 'target': '(1,1)'}"]},
            {"questionId": "q4", "questionType": "numeric", "questionText": "כמה?",
             "answers": [], "correctAnswers": ["5"]},
        ],
    },
}


class DistractorTests(unittest.TestCase):
    def setUp(self):
        self.stack = []
        self.stack.append(patch("app.services.games.distractors._get_collection_named", return_value=None))
        self.llm = AsyncMock(return_value=json.dumps({
            "item-1#q1:" + distractors._fingerprint(COMPONENT["questions_by_item"]["item-1"][0]): ["(3,2)", "(2,-3)", "(2,3)", "(0,3)"],
        }))
        self.stack.append(patch("app.services.games.distractors.call_llm", self.llm))
        for entry in self.stack:
            entry.start()

    def tearDown(self):
        for entry in self.stack:
            entry.stop()

    def test_needs_distractors_only_for_bare_choice_rows(self):
        rows = COMPONENT["questions_by_item"]["item-1"]
        self.assertEqual([distractors.needs_distractors(r) for r in rows], [True, False, False, False])

    def test_enrich_adds_options_drops_matching_and_keeps_the_rest(self):
        enriched = run(distractors.enrich_component(COMPONENT, actor_id="gal"))
        rows = {r["questionId"]: r for r in enriched["questions_by_item"]["item-1"]}
        self.assertEqual(set(rows), {"q1", "q2", "q4"})
        self.assertEqual(sorted(rows["q1"]["answers"]), ["(0,3)", "(2,-3)", "(2,3)", "(3,2)"])
        self.assertEqual(rows["q1"]["correctAnswers"], ["(2,3)"])
        self.assertEqual(rows["q2"]["answers"], ["AB", "CD", "EF"])
        self.assertEqual(rows["q4"]["answers"], [])
        # the source component is untouched
        self.assertEqual(COMPONENT["questions_by_item"]["item-1"][0]["answers"], ["(2,3)"])
        self.assertEqual(self.llm.await_count, 1)

    def test_options_are_a_stable_shuffle(self):
        first = run(distractors.enrich_component(COMPONENT))["questions_by_item"]["item-1"][0]["answers"]
        second = run(distractors.enrich_component(COMPONENT))["questions_by_item"]["item-1"][0]["answers"]
        self.assertEqual(first, second)

    def test_model_failure_leaves_the_row_bare(self):
        self.llm.side_effect = RuntimeError("apim down")
        enriched = run(distractors.enrich_component(COMPONENT))
        self.assertEqual(enriched["questions_by_item"]["item-1"][0]["answers"], ["(2,3)"])


if __name__ == "__main__":
    unittest.main()
