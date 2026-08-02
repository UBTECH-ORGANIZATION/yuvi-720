"""One question must have ONE id, on both sides of the wire.

Measured on the live Kata catalog (29/07): the first question of every item comes
back as a full object URL and any second question as a plain `q2` — two id spaces
inside a single `questions` array:

    …-01-01-001 → ["https://…/methodica-science-mass-measure-01-01-001/q1"]
    …-01-01-010 → ["https://…/methodica-science-mass-measure-01-01-010/q1", "q2"]

The `answered` statement for that same question carries `q1`. So the learner's
position was keyed `…|<URL>` on arrival (resolved from the catalog) and `…|q1`
from the answer — one question, two keys, two chat threads, and a one-shot
support gate that re-armed itself mid-question. The catalog is normalized to the
tail the events use.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import tutor_decision  # noqa: E402
from app.services import kata_catalog, kata_client  # noqa: E402


COMPONENT = "methodica-science-mass-measure-01-01"
BASE = "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01"
URL = f"{BASE}/{COMPONENT}/{COMPONENT}-001/q1"
RAW = {
    "id": COMPONENT,
    "subContent": [
        {
            "id": f"{COMPONENT}-001",
            "title": "הוק",
            "contentType": "motivational",
            "mediaFormat": "interactive-content",
            "informationToBot": "…",
            "questions": [{"questionId": URL, "questionText": "איזה בלון כבד יותר?"}],
        },
        {
            "id": f"{COMPONENT}-010",
            "title": "ממוצע מדידות",
            "contentType": "practice",
            "mediaFormat": "interactive-content",
            "questions": [
                {"questionId": f"{BASE}/{COMPONENT}/{COMPONENT}-010/q1"},
                {"questionId": "q2"},   # …and the same array mixes in a bare id
            ],
        },
    ],
}


class NormalizationTests(unittest.TestCase):
    def test_a_url_reduces_to_the_id_the_events_carry(self):
        self.assertEqual(kata_client.normalize_question_id(URL), "q1")

    def test_an_already_plain_id_is_untouched(self):
        self.assertEqual(kata_client.normalize_question_id("q2"), "q2")

    def test_empty_stays_empty(self):
        self.assertEqual(kata_client.normalize_question_id(None), "")


class CatalogTests(unittest.TestCase):
    def setUp(self):
        component = kata_client.normalize_component(RAW)
        p = mock.patch.object(kata_catalog, "get_component", return_value=component)
        p.start()
        self.addCleanup(p.stop)

    def test_the_screens_only_question_resolves_to_the_event_id(self):
        self.assertEqual(
            kata_catalog.default_question_id(COMPONENT, f"{COMPONENT}-001"), "q1"
        )

    def test_arrival_and_answer_produce_one_key(self):
        """The regression: two keys for one question split its chat thread."""
        item = f"{COMPONENT}-001"
        state = {"component_id": COMPONENT, "item_id": item}
        on_arrival = tutor_decision.support_question_key(
            {**state, "question_id": kata_catalog.default_question_id(COMPONENT, item)},
            COMPONENT,
        )
        on_answer = tutor_decision.support_question_key({**state, "question_id": "q1"}, COMPONENT)
        self.assertEqual(on_arrival, on_answer)
        self.assertTrue(on_arrival.endswith("|q1"))

    def test_ordinals_are_keyed_by_the_event_id(self):
        ordinals = kata_catalog.question_item_ordinals(COMPONENT)
        self.assertEqual(ordinals[f"{COMPONENT}-001|q1"], 1)
        self.assertEqual(ordinals[f"{COMPONENT}-010|q1"], 2)
        # Both questions on `-010` are the learner's SECOND question: the player
        # numbers by screen and calls them סעיף א / סעיף ב of it.
        self.assertEqual(ordinals[f"{COMPONENT}-010|q2"], 2)
        self.assertFalse([k for k in ordinals if "http" in k])

    def test_a_mixed_array_still_keeps_its_questions_apart(self):
        item = f"{COMPONENT}-010"
        self.assertIsNone(kata_catalog.default_question_id(COMPONENT, item))  # ambiguous
        self.assertNotEqual(
            tutor_decision.support_question_key(
                {"component_id": COMPONENT, "item_id": item, "question_id": "q1"}, COMPONENT),
            tutor_decision.support_question_key(
                {"component_id": COMPONENT, "item_id": item, "question_id": "q2"}, COMPONENT),
        )

    def test_the_unique_question_anchor_can_match_again(self):
        """`resolve_catalog_item_id` compares against these ids."""
        self.assertEqual(
            kata_catalog.resolve_catalog_item_id(COMPONENT, f"{COMPONENT}-001", question_id="q2"),
            f"{COMPONENT}-010",
        )


if __name__ == "__main__":
    unittest.main()
