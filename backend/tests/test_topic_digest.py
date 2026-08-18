"""Topic digests: the server's own aggregation, written once, kept until the
child's work moves.

    python -m pytest tests/test_topic_digest.py -q

Three things are worth testing, and none of them is what the model says.

**The aggregation**, because it is a deliberate second copy of the client's
`buildTopicSections` — same keys, same thresholds — and a digest paragraph
finds its topic row BY KEY. If the two ports drift, paragraphs silently stop
attaching to rows.

**The cache**, because it is a product decision with a price on it: one
mini-tier call per child per progress-change, a GET that never generates, and
a failed call that must stay retryable instead of being cached as an answer.

**The cleaning**, because a digest for a topic the child never worked on is
exactly the fabrication the grounding rules exist to stop.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import topic_digest


def row(**over):
    base = {
        "component_id": "comp-1", "objective_id": "MATH-AXES",
        "objective_title": "מערכת צירים", "unit_title": "גאומטריה",
        "learning_title": "שיעור צירים", "subject": "math",
        "attempts": 3, "correct": 1, "teaches": "קריאת נקודות על מערכת צירים",
        "time_seconds": 60,
    }
    base.update(over)
    return base


class TheAggregationMirrorsTheClient(unittest.TestCase):
    """Same keys, same thresholds as `buildTopicSections` — the lockstep."""

    def test_questions_serving_one_objective_become_one_topic(self):
        topics = topic_digest.build_topics([
            row(), row(attempts=2, correct=2, teaches="חישוב מרחק בין נקודות"),
        ])
        self.assertEqual(len(topics), 1)
        topic = topics[0]
        self.assertEqual(topic["key"], "obj:MATH-AXES")
        self.assertEqual(topic["attempts"], 5)
        self.assertEqual(topic["correct"], 3)
        self.assertEqual(topic["questions"], 2)

    def test_too_few_attempts_is_not_a_hard_topic(self):
        self.assertEqual(topic_digest.build_topics([row(attempts=3)]), [])

    def test_a_row_with_no_objective_falls_to_its_unit_then_lesson(self):
        by_unit = topic_digest.build_topics(
            [row(objective_id=None, objective_title="", attempts=4)])
        self.assertEqual(by_unit[0]["key"], "unit:גאומטריה")
        self.assertEqual(by_unit[0]["level"], "unit")
        by_lesson = topic_digest.build_topics(
            [row(objective_id=None, objective_title="", unit_title="", attempts=4)])
        self.assertEqual(by_lesson[0]["key"], "lesson:comp-1")
        self.assertEqual(by_lesson[0]["level"], "lesson")

    def test_a_row_named_at_no_level_contributes_nothing(self):
        self.assertEqual(topic_digest.build_topics([
            row(objective_id=None, objective_title="", unit_title="",
                learning_title="", attempts=9),
        ]), [])

    def test_colliding_objective_titles_fall_to_their_unit_names(self):
        topics = topic_digest.build_topics([
            row(objective_id="SCI-A", objective_title="מסה ונפח",
                unit_title="יחידה א", subject="science", attempts=4),
            row(objective_id="SCI-B", objective_title="מסה ונפח",
                unit_title="יחידה ב", subject="science", attempts=4,
                component_id="comp-2"),
        ])
        labels = sorted(t["label"] for t in topics)
        self.assertEqual(labels, ["יחידה א", "יחידה ב"])
        self.assertTrue(all(t["level"] == "unit" for t in topics))

    def test_only_the_texts_of_questions_that_went_badly_feed_the_digest(self):
        topics = topic_digest.build_topics([
            row(attempts=4, correct=1, teaches="הקשה"),
            row(attempts=4, correct=4, teaches="הקלה"),
        ])
        self.assertEqual(topics[0]["teaches"], ["הקשה"])

    def test_hardest_first(self):
        topics = topic_digest.build_topics([
            row(attempts=4, correct=3),
            row(objective_id="MATH-2", objective_title="שברים",
                attempts=4, correct=0, component_id="comp-2"),
        ])
        self.assertEqual(topics[0]["key"], "obj:MATH-2")


class WhatCountsAsNewEvidence(unittest.TestCase):
    def _topics(self, **over):
        return topic_digest.build_topics([row(attempts=4, **over)])

    def test_the_same_work_is_not_new(self):
        self.assertEqual(topic_digest.fingerprint(self._topics()),
                         topic_digest.fingerprint(self._topics()))

    def test_one_more_answer_is_new(self):
        self.assertNotEqual(topic_digest.fingerprint(self._topics()),
                            topic_digest.fingerprint(self._topics(correct=2)))

    def test_a_catalogue_retitle_is_not_news_about_the_child(self):
        self.assertEqual(
            topic_digest.fingerprint(self._topics()),
            topic_digest.fingerprint(self._topics(objective_title="מערכת צירים!",
                                                  teaches="נוסח חדש")))


class TheCleaning(unittest.TestCase):
    KNOWN = {"obj:MATH-AXES"}

    def test_an_invented_topic_never_reaches_a_teacher(self):
        cleaned = topic_digest._clean({"topics": [
            {"key": "obj:MATH-AXES", "sentences": ["משפט אמיתי."]},
            {"key": "obj:INVENTED", "sentences": ["משפט בדוי."]},
        ]}, self.KNOWN)
        self.assertEqual([item["key"] for item in cleaned], ["obj:MATH-AXES"])

    def test_nothing_usable_is_none_not_an_empty_answer(self):
        self.assertIsNone(topic_digest._clean({"topics": []}, self.KNOWN))
        self.assertIsNone(topic_digest._clean({"topics": [
            {"key": "obj:INVENTED", "sentences": ["x"]}]}, self.KNOWN))
        self.assertIsNone(topic_digest._clean(["not a dict"], self.KNOWN))

    def test_sentences_are_clamped_and_surface_is_an_enum(self):
        cleaned = topic_digest._clean({"topics": [{
            "key": "obj:MATH-AXES",
            "sentences": ["א", "ב", "ג", "ד", "ה"],
            "surface": ["rate", "vibes", "attempts"],
        }]}, self.KNOWN)
        self.assertEqual(len(cleaned[0]["sentences"]), topic_digest.MAX_SENTENCES)
        self.assertEqual(cleaned[0]["surface"], ["rate", "attempts"])


class FakeCache:
    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.writes = 0

    async def find_one(self, query):
        stored = self.rows.get(query.get("_id"))
        return dict(stored) if stored else None

    async def update_one(self, query, changes, upsert=False):
        self.writes += 1
        self.rows[query["_id"]] = {**self.rows.get(query["_id"], {}),
                                   **(changes.get("$set") or {})}


DIGEST = [{"key": "obj:MATH-AXES",
           "sentences": ["השאלות עסקו בקריאת נקודות.", "1 מתוך 5 ניסיונות הצליח."],
           "surface": ["rate"]}]


class GeneratedOnceAndKept(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        self.cache = FakeCache()
        self.rows = [row(attempts=5, correct=1)]
        self.generate = AsyncMock(return_value=DIGEST)
        self._patches = [
            patch("app.brain.repository._get_collection_named",
                  return_value=self.cache),
            patch("app.services.learner_activity.question_summary",
                  new=self._summary),
            patch("app.services.learning_analytics.label_learner_rows",
                  new=lambda rows, language="he": rows),
            patch("app.services.kata_catalog.ensure_loaded", AsyncMock()),
            patch.object(topic_digest, "_generate", self.generate),
        ]
        for item in self._patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in self._patches])

    async def _summary(self, learner_id, *, component_id=None, subject=None):
        return self.rows

    async def test_the_first_ask_generates_and_the_second_does_not(self):
        first = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertFalse(first["cached"])
        self.assertEqual(first["topics"], DIGEST)
        second = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertTrue(second["cached"])
        self.assertFalse(second["stale"])
        self.assertEqual(self.generate.await_count, 1)

    async def test_opening_the_profile_never_costs_a_model_call(self):
        opened = await topic_digest.topic_digest(
            "kid-a", "teacher-a", allow_generate=False)
        self.assertEqual(opened["topics"], [])
        self.assertTrue(opened["has_evidence"])
        self.generate.assert_not_awaited()

    async def test_more_work_on_a_topic_is_what_regenerates(self):
        await topic_digest.topic_digest("kid-a", "teacher-a")
        self.rows = [row(attempts=6, correct=2)]
        stale = await topic_digest.topic_digest(
            "kid-a", "teacher-a", allow_generate=False)
        self.assertTrue(stale["stale"])           # old paragraphs, flagged
        self.assertEqual(stale["topics"], DIGEST)
        again = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertFalse(again["stale"])
        self.assertEqual(self.generate.await_count, 2)

    async def test_a_child_with_no_hard_topics_is_not_a_model_call(self):
        self.rows = []
        answer = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertFalse(answer["has_evidence"])
        self.generate.assert_not_awaited()

    async def test_a_failed_call_is_not_cached_as_an_answer(self):
        self.generate.return_value = None
        failed = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertTrue(failed["unavailable"])
        self.assertEqual(self.cache.writes, 0)
        self.generate.return_value = DIGEST
        recovered = await topic_digest.topic_digest("kid-a", "teacher-a")
        self.assertEqual(recovered["topics"], DIGEST)

    async def test_a_different_language_is_a_different_row(self):
        await topic_digest.topic_digest("kid-a", "teacher-a", language="he")
        await topic_digest.topic_digest("kid-a", "teacher-a", language="ar")
        self.assertEqual(self.generate.await_count, 2)
        self.assertEqual(len(self.cache.rows), 2)


if __name__ == "__main__":
    unittest.main()
