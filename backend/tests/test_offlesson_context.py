"""Leaving the lesson must leave its question behind.

Measured 16/08: a learner asked the dashboard companion to show them
photosynthesis and Yuvi answered "the question here is about measuring mass, not
photosynthesis", re-offering the options of the lesson question they had walked
away from.

`current_state` is the LAST lesson pointer and outlives the lesson screen, so the
bundle handed the coach that question under `current_*` names — i.e. as the thing
in front of the learner. The data still travels (asking "where did I stop?" needs
it); only its name and status change, and only off a lesson screen.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _render_context  # noqa: E402
from app.brain import context_engine  # noqa: E402


COMPONENT = "c-01"
ITEM = "c-01-002"

BRAIN = {
    "current_state": {
        "component_id": COMPONENT,
        "unit_id": "u-1",
        "item_id": ITEM,
        "question_id": "q1",
    },
    "goals": [],
    "identity": {"locale": "he"},
}

QUESTIONS = [{
    "questionId": "q1",
    "questionText": "מי מהמדידות חריגה?",
    "answers": ["12.0", "12.1", "18.7"],
    "correctAnswers": ["18.7"],
}]

ROW = {"id": ITEM, "title": "מדידות מסה", "media_format": "interactive-content",
       "content_type": "practice", "question_count": 1, "kind": "question"}


class OffLessonContextTests(unittest.IsolatedAsyncioTestCase):
    async def _rendered(self, screen: str, pinned_question_key=None, message=""):
        with patch.object(context_engine, "view_for", new=AsyncMock(return_value=BRAIN)), \
             patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()), \
             patch("app.services.kata_catalog.get_component", return_value={"id": COMPONENT}), \
             patch("app.services.kata_catalog.questions_for_item", return_value=QUESTIONS), \
             patch("app.services.kata_catalog.item_profile", return_value=ROW), \
             patch("app.services.kata_catalog.resolve_catalog_item_id", side_effect=lambda *a, **k: ITEM), \
             patch("app.services.kata_catalog.information_for_item", return_value="הערות פריט"), \
             patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])):
            bundle = await context_engine.build_coach_bundle(
                "L",
                surface_context={"screen": screen},
                pinned_question_key=pinned_question_key,
            )
        return bundle, _render_context(bundle, message)

    async def test_the_dashboard_is_told_no_question_is_on_screen(self):
        """The exact case that produced the deflection."""
        bundle, rendered = await self._rendered("student_dashboard")
        self.assertFalse((bundle.get("current") or {}).get("on_lesson_screen"))
        self.assertIn("current_question_status: learner_is_not_on_a_lesson_screen_right_now", rendered)
        self.assertIn("current_screen: student_dashboard", rendered)

    async def test_the_lesson_question_is_renamed_not_removed(self):
        """"Where did I stop?" still needs it — as a memory, not as a screen."""
        _, rendered = await self._rendered("student_dashboard")
        self.assertIn("last_lesson_question_text: מי מהמדידות חריגה?", rendered)
        self.assertIn("last_lesson_question_options:", rendered)
        self.assertIn("last_lesson_question_correct_answer_DO_NOT_REVEAL: 18.7", rendered)
        self.assertIn("last_lesson_item_info: הערות פריט", rendered)
        self.assertNotIn("current_question_text:", rendered)
        self.assertNotIn("current_screen_kind:", rendered)

    async def test_an_unmapped_screen_is_treated_as_off_lesson(self):
        _, rendered = await self._rendered("unknown")
        self.assertIn("current_question_status: learner_is_not_on_a_lesson_screen_right_now", rendered)

    async def test_the_lesson_screen_itself_is_unchanged(self):
        bundle, rendered = await self._rendered("learning_lesson")
        self.assertTrue((bundle.get("current") or {}).get("on_lesson_screen"))
        self.assertIn("current_question_status: reached", rendered)
        self.assertIn("current_question_text: מי מהמדידות חריגה?", rendered)
        self.assertNotIn("last_lesson_", rendered)

    async def test_a_pinned_nudge_stays_grounded_wherever_the_learner_went(self):
        """A nudge is composed about a question the learner really was on."""
        bundle, rendered = await self._rendered(
            "student_dashboard", pinned_question_key=f"{COMPONENT}|{ITEM}|q1",
        )
        self.assertTrue((bundle.get("current") or {}).get("on_lesson_screen"))
        self.assertIn("current_question_text: מי מהמדידות חריגה?", rendered)

    async def test_an_option_reference_off_lesson_points_at_the_renamed_question(self):
        _, rendered = await self._rendered("student_dashboard", message="מה אומרת אפשרות 2?")
        self.assertIn("learner_referenced_option: [2/ב] 12.1", rendered)
        self.assertIn("even if last_lesson_question_text", rendered)
