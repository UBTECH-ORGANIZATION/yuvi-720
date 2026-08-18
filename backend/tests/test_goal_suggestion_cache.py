"""Goal suggestions: generated once, and explained in words.

Two failures, both seen on the screen rather than reasoned about.

**Re-rollable.** The button called the model every time it was pressed, so the
same question produced a different answer every minute — the fastest way to
teach a teacher that none of the three mean anything — and each press was paid
for. They are cached now, and the only thing that produces new ones is new
evidence about the child.

**The "why?" was the request body.** `because.raw` was whatever the model had
been handed: a list of struggle dicts, and the `student_description` CONTAINER,
which the teacher's screen rendered field by field as `blocks [object Object]`
and `events since generation 4`. Explainability means the datum behind the
suggestion, not the payload it travelled in.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mentoring_assist


class FakeCache:
    """One dict, two verbs, and a count of how often it was written."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}
        self.writes = 0

    async def find_one(self, query):
        row = self.rows.get(query.get("_id"))
        return dict(row) if row else None

    async def update_one(self, query, changes, upsert=False):
        self.writes += 1
        self.rows[query["_id"]] = {**self.rows.get(query["_id"], {}),
                                   **(changes.get("$set") or {})}

    async def create_index(self, *_args, **_kwargs):
        return None


EVIDENCE = {
    "struggle_items": [
        {"objective_id": "obj-1", "label": "שברים", "evidence": "3 מתוך 8 נכונות"},
        {"objective_id": "obj-2", "label": "אחוזים", "evidence": "2 מתוך 6 נכונות"},
    ],
    "challenges": ["לזהות מה עוזר לי ללמוד"],
    # The shape the brain actually returns, metadata and all. This is the object
    # that used to reach the teacher's screen verbatim.
    "student_description": {
        "blocks": {"learning": "לומד/ת טוב במנות קצרות עם תשובה מוכנה"},
        "text": "לומד/ת טוב במנות קצרות, ואז ניסיון עצמאי קצר.",
        "stale": True,
        "events_since_generation": 4,
        "last_generated_at": "2026-08-12T09:00:00+00:00",
        "updated_at": "2026-08-12T09:00:00+00:00",
    },
}


class TheGroundingATeacherReads(unittest.TestCase):
    """`because` is a sentence's worth of fact, never the evidence blob."""

    def test_the_description_arrives_as_prose_not_as_its_container(self):
        because = mentoring_assist._because("student_description", EVIDENCE)
        self.assertEqual(because["signal"], "student_description")
        self.assertEqual(set(because["raw"]), {"observation"})
        observation = because["raw"]["observation"]
        self.assertIn("במנות קצרות", observation)
        for leaked in ("blocks", "events_since_generation", "stale", "updated_at"):
            self.assertNotIn(leaked, str(because["raw"]))

    def test_a_description_with_no_text_falls_back_to_its_blocks(self):
        line = mentoring_assist._description_line(
            {"blocks": {"a": "אוהב/ת לעבוד בזוגות", "b": ""}, "text": None,
             "events_since_generation": 9})
        self.assertEqual(line, "אוהב/ת לעבוד בזוגות")

    def test_the_line_is_capped_so_a_card_stays_a_card(self):
        line = mentoring_assist._description_line({"text": "א" * 900}, limit=100)
        self.assertLessEqual(len(line), 101)
        self.assertTrue(line.endswith("…"))

    def test_gaps_arrive_as_labels_not_as_rows_of_dicts(self):
        because = mentoring_assist._because("struggle_items", EVIDENCE)
        self.assertEqual(because["raw"], {"labels": ["שברים", "אחוזים"]})

    def test_challenges_arrive_as_the_challenges(self):
        because = mentoring_assist._because("challenges", EVIDENCE)
        self.assertEqual(because["raw"], {"challenges": ["לזהות מה עוזר לי ללמוד"]})

    def test_a_signal_naming_nothing_falls_to_the_strongest_evidence_there_is(self):
        # The model is asked to copy an evidence key and does not always. The
        # old code answered that by shipping the ENTIRE evidence object.
        because = mentoring_assist._because("vibes", EVIDENCE)
        self.assertEqual(because["signal"], "struggle_items")
        self.assertEqual(because["raw"], {"labels": ["שברים", "אחוזים"]})

    def test_no_evidence_at_all_says_so(self):
        because = mentoring_assist._because("struggle_items", {})
        self.assertEqual(because["signal"], "no_evidence")
        self.assertEqual(because["raw"], {})


class TheEvidenceItself(unittest.IsolatedAsyncioTestCase):
    """What is collected, before anything is asked of it."""

    async def test_a_challenge_is_its_words_not_its_row(self):
        # In this scope a challenge is `{"label": …, "status": "working"}`, and
        # `str()` on it is what put braces in the teacher's panel — and in the
        # model's prompt, which is the worse half.
        view = {"challenges": [{"label": "לזהות מה עוזר לי ללמוד", "status": "working"},
                               {"text": "לשמור על מוטיבציה"}, "לחבר את הלמידה לחיים", {}],
                "student_description": ""}
        with patch("app.brain.context_engine.view_for", AsyncMock(return_value=view)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"struggle_items": []})):
            evidence, _ = await mentoring_assist._goal_evidence("kid-a", "he", None)
        self.assertEqual(evidence["challenges"],
                         ["לזהות מה עוזר לי ללמוד", "לשמור על מוטיבציה",
                          "לחבר את הלמידה לחיים"])


class WhatCountsAsNewEvidence(unittest.TestCase):
    """The fingerprint decides when a teacher is offered new suggestions."""

    def test_the_same_observations_in_a_different_order_are_not_new(self):
        shuffled = {
            **EVIDENCE,
            "struggle_items": list(reversed(EVIDENCE["struggle_items"])),
        }
        self.assertEqual(mentoring_assist._goal_fingerprint(EVIDENCE),
                         mentoring_assist._goal_fingerprint(shuffled))

    def test_one_more_wrong_answer_on_the_same_objective_is_not_new(self):
        # `evidence` under a struggle item carries a running count. If that were
        # in the fingerprint, the suggestions would be invalidated by the child
        # simply continuing to work — which is every session.
        moved = {
            **EVIDENCE,
            "struggle_items": [{**EVIDENCE["struggle_items"][0],
                                "evidence": "3 מתוך 9 נכונות"},
                               EVIDENCE["struggle_items"][1]],
        }
        self.assertEqual(mentoring_assist._goal_fingerprint(EVIDENCE),
                         mentoring_assist._goal_fingerprint(moved))

    def test_a_new_objective_is_new(self):
        added = {
            **EVIDENCE,
            "struggle_items": [*EVIDENCE["struggle_items"],
                               {"objective_id": "obj-3", "label": "מכנה משותף"}],
        }
        self.assertNotEqual(mentoring_assist._goal_fingerprint(EVIDENCE),
                            mentoring_assist._goal_fingerprint(added))

    def test_a_rewritten_description_is_new(self):
        rewritten = {
            **EVIDENCE,
            "student_description": {"text": "משהו אחר לגמרי", "blocks": {}},
        }
        self.assertNotEqual(mentoring_assist._goal_fingerprint(EVIDENCE),
                            mentoring_assist._goal_fingerprint(rewritten))

    def test_regenerating_the_same_description_is_not_new(self):
        # `last_generated_at` and `events_since_generation` move on their own.
        touched = {
            **EVIDENCE,
            "student_description": {**EVIDENCE["student_description"],
                                    "events_since_generation": 40,
                                    "last_generated_at": "2026-09-01T00:00:00+00:00"},
        }
        self.assertEqual(mentoring_assist._goal_fingerprint(EVIDENCE),
                         mentoring_assist._goal_fingerprint(touched))


DRAFTS = [{"title": "יעד", "next_steps": "צעד", "rationale": "כי", "deadline": "2026-08-19",
           "ai": True, "because": {"signal": "struggle_items", "value": None,
                                   "raw": {"labels": ["שברים"]}}}]


class GeneratedOnceAndKept(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.cache = FakeCache()
        self.generate = AsyncMock(return_value=DRAFTS)
        self._patches = [
            patch("app.brain.repository._get_collection_named",
                  return_value=self.cache),
            patch.object(mentoring_assist, "_goal_evidence",
                         AsyncMock(return_value=(EVIDENCE, EVIDENCE["struggle_items"]))),
            patch.object(mentoring_assist, "suggest_goals_for_teacher", self.generate),
        ]
        for item in self._patches:
            item.start()

    async def asyncTearDown(self):
        for item in self._patches:
            item.stop()

    async def test_the_first_ask_generates_and_the_second_does_not(self):
        first = await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
        self.assertFalse(first["cached"])
        second = await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
        self.assertTrue(second["cached"])
        self.assertEqual(second["goals"], DRAFTS)
        self.assertEqual(self.generate.await_count, 1)

    async def test_opening_the_tab_never_costs_a_model_call(self):
        await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
        self.generate.reset_mock()
        opened = await mentoring_assist.goal_suggestions(
            "kid-a", "teacher-b", allow_generate=False)
        self.assertEqual(opened["goals"], DRAFTS)
        self.generate.assert_not_awaited()

    async def test_an_empty_cache_answers_a_page_open_with_nothing_not_a_call(self):
        opened = await mentoring_assist.goal_suggestions(
            "kid-a", "teacher-a", allow_generate=False)
        self.assertEqual(opened["goals"], [])
        self.generate.assert_not_awaited()

    async def test_new_evidence_is_what_produces_new_suggestions(self):
        await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
        moved = {**EVIDENCE, "challenges": ["משהו חדש"]}
        with patch.object(mentoring_assist, "_goal_evidence",
                          AsyncMock(return_value=(moved, moved["struggle_items"]))):
            # A page open still shows the old ones — real, grounded, and marked
            # as overtaken. Hiding them because a hash moved would leave the tab
            # emptier than it was.
            opened = await mentoring_assist.goal_suggestions(
                "kid-a", "teacher-a", allow_generate=False)
            self.assertEqual(opened["goals"], DRAFTS)
            self.assertTrue(opened["stale"])

            again = await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
            self.assertFalse(again["cached"])
        self.assertEqual(self.generate.await_count, 2)

    async def test_a_different_language_is_a_different_row(self):
        await mentoring_assist.goal_suggestions("kid-a", "teacher-a", language="he")
        await mentoring_assist.goal_suggestions("kid-a", "teacher-a", language="ar")
        self.assertEqual(self.generate.await_count, 2)
        self.assertEqual(len(self.cache.rows), 2)

    async def test_a_prompt_rewrite_abandons_every_cached_row(self):
        # The voice fix (#253): suggestions cached under the old prompt address
        # the teacher, and the fingerprint cannot see a prompt change — only the
        # cache id can. Bumping the version must strand old rows entirely, even
        # on a page open, or teachers keep reading the old voice indefinitely.
        await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
        with patch.object(mentoring_assist, "_GOAL_PROMPT_VERSION", "v-next"):
            opened = await mentoring_assist.goal_suggestions(
                "kid-a", "teacher-a", allow_generate=False)
            self.assertEqual(opened["goals"], [])
            regenerated = await mentoring_assist.goal_suggestions("kid-a", "teacher-a")
            self.assertFalse(regenerated["cached"])
        self.assertEqual(self.generate.await_count, 2)

    async def test_the_no_evidence_card_is_never_cached(self):
        # "Nothing to suggest yet" is a true answer and a terrible thing to
        # remember: the day an observation lands, the button must produce real
        # ones rather than replay the apology.
        self.generate.return_value = [{"title": "", "unavailable": True,
                                       "because": {"signal": "no_evidence",
                                                   "value": None, "raw": {}}}]
        result = await mentoring_assist.goal_suggestions("kid-b", "teacher-a")
        self.assertTrue(result["goals"][0]["unavailable"])
        self.assertEqual(self.cache.writes, 0)


if __name__ == "__main__":
    unittest.main()
