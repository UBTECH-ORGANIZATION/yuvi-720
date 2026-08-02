"""The coach must describe what is in front of the learner, not what is next.

Measured 29/07: a learner on `…-01-01-003` — a video playlist that ALSO carries a
comprehension question part-way through — asked "מה מופיע פה?" while the clip was
playing. Yuvi answered about writing units beside a number: the text of that
mid-video question, which they had not reached.

The bundle already knew the screen was a video (`kind: watch`, `chosen_path:
listening`). What it did not say was WHERE IN THE SCREEN they were, so the
question read as the current task.

The stage is derived from the learner's own xAPI, and deliberately without any
knowledge of this particular component, so it holds for anything Kata ships.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.brain import context_engine  # noqa: E402


COMPONENT = "c-01"
ITEM = "c-01-003"

BRAIN = {
    "current_state": {
        "component_id": COMPONENT,
        "unit_id": "u-1",
        "item_id": ITEM,
        "question_id": "q1",
        "learning_choice": "listening",
    },
    "goals": [],
    "identity": {"locale": "he"},
}

QUESTION = [{"questionId": "q1", "questionText": "מדוע חשוב לכתוב את היחידה?"}]

VIDEO_ROW = {"id": ITEM, "title": "פלייליסט", "media_format": "video",
             "content_type": "instruction", "question_count": 1}
QUIZ_ROW = {"id": ITEM, "title": "שאלה", "media_format": "interactive-content",
            "content_type": "practice", "question_count": 1}
STEP_ROW = {"id": ITEM, "title": "מסך הסבר", "media_format": "text",
            "content_type": "instruction", "question_count": 0}


def _event(verb: str, sub_item=None, launch=COMPONENT):
    return {"verb": verb, "sub_item_id": sub_item, "launch": launch, "result": {}}


class ScreenStageTests(unittest.IsolatedAsyncioTestCase):
    async def _current(self, row, events, questions=QUESTION):
        profile = {**row, "kind": context_engine.kata_catalog.kind_for_row(row)} \
            if hasattr(context_engine, "kata_catalog") else row
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=BRAIN)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": COMPONENT}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=questions), \
             patch("app.services.kata_catalog.item_profile", return_value=profile), \
             patch("app.services.kata_catalog.resolve_catalog_item_id", side_effect=lambda *a, **k: ITEM), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=events)):
            bundle = await context_engine.build_coach_bundle(
                "L", surface_context={"screen": "learning_lesson"},
            )
        return bundle.get("current") or {}

    async def test_watching_a_video_is_not_working_on_its_question(self):
        """The exact case that produced the wrong answer."""
        current = await self._current(
            {**VIDEO_ROW, "kind": "watch"},
            [_event("played"), _event("paused")],
        )
        self.assertEqual((current.get("item") or {}).get("stage"), "consuming_media")
        self.assertFalse((current.get("question") or {}).get("reached"))

    async def test_the_question_is_still_carried_for_when_they_reach_it(self):
        """Withholding it entirely would break the hint the moment they arrive."""
        current = await self._current(
            {**VIDEO_ROW, "kind": "watch"}, [_event("played")],
        )
        self.assertTrue(((current.get("question") or {}).get("text") or "").strip())

    async def test_answering_on_the_media_screen_flips_it_to_reached(self):
        current = await self._current(
            {**VIDEO_ROW, "kind": "watch"},
            [_event("answered", sub_item=ITEM), _event("played")],
        )
        self.assertEqual((current.get("item") or {}).get("stage"), "working_on_question")
        self.assertTrue((current.get("question") or {}).get("reached"))

    async def test_arriving_at_a_video_before_playing_it_is_still_not_the_question(self):
        current = await self._current({**VIDEO_ROW, "kind": "watch"}, [_event("enter", sub_item=ITEM)])
        self.assertEqual((current.get("item") or {}).get("stage"), "arrived_at_media")
        self.assertFalse((current.get("question") or {}).get("reached"))

    async def test_a_plain_question_screen_is_unchanged(self):
        """No medium to be in front of, so the question IS the screen."""
        current = await self._current({**QUIZ_ROW, "kind": "question"}, [_event("enter", sub_item=ITEM)])
        self.assertEqual((current.get("item") or {}).get("stage"), "working_on_question")
        self.assertTrue((current.get("question") or {}).get("reached"))

    async def test_media_from_a_different_component_does_not_count(self):
        current = await self._current(
            {**QUIZ_ROW, "kind": "question"},
            [_event("played", launch="c-99")],
        )
        self.assertEqual((current.get("item") or {}).get("stage"), "working_on_question")

    async def test_a_teaching_screen_reports_no_question(self):
        current = await self._current({**STEP_ROW, "kind": "read"}, [_event("enter", sub_item=ITEM)], questions=[])
        self.assertEqual((current.get("item") or {}).get("stage"), "arrived_at_media")
        self.assertFalse((current.get("question") or {}).get("text"))


class RenderedStatusTests(unittest.TestCase):
    """What the model actually reads."""

    def _status(self, current):
        from app.agents.coach import _question_status
        return _question_status(current)

    def test_unreached_question_is_labelled_as_such(self):
        self.assertEqual(
            self._status({"question": {"text": "שאלה?", "reached": False}}),
            "not_yet_reached_still_on_the_medium",
        )

    def test_reached_question_is_labelled_reached(self):
        self.assertEqual(self._status({"question": {"text": "שאלה?", "reached": True}}), "reached")

    def test_a_screen_without_a_question_says_so(self):
        self.assertEqual(self._status({"question": {}}), "no_question_on_this_screen")
        self.assertEqual(self._status({}), "no_question_on_this_screen")


if __name__ == "__main__":
    unittest.main()
