"""Mode boundaries for lesson and general Yuvi chats."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach_modes import (  # noqa: E402
    CoachMode,
    lesson_management_redirect,
    project_bundle,
    resolve_mode,
)
from app.agents import coach  # noqa: E402


class CoachModeTests(unittest.TestCase):
    def test_lesson_screen_resolves_to_lesson_mode(self):
        self.assertEqual(
            resolve_mode({"screen": "learning_lesson"}),
            CoachMode.LESSON,
        )

    def test_non_lesson_screen_resolves_to_general_mode(self):
        self.assertEqual(
            resolve_mode({"screen": "student_dashboard"}),
            CoachMode.GENERAL,
        )

    def test_general_mode_removes_stale_lesson_and_teacher_context(self):
        bundle = {
            "teacher_guidance": ["use visuals"],
            "current": {
                "question": {"text": "What is 2 + 2?", "correct": ["4"]},
                "informationToBot": "Current item notes",
                "hint_ladder": {"level": 2},
                "recent_events": [{"verb": "answered", "success": False}],
            },
        }

        projected = project_bundle(bundle, CoachMode.GENERAL)

        self.assertEqual(projected["coach_mode"], CoachMode.GENERAL.value)
        self.assertEqual(projected["teacher_guidance"], [])
        self.assertEqual(
            projected["current"],
            {"on_lesson_screen": False, "task_status": "no_open_task"},
        )

    def test_lesson_mode_keeps_lesson_context_but_not_teacher_guidance(self):
        current = {"question": {"text": "What is 2 + 2?"}}
        projected = project_bundle(
            {"teacher_guidance": ["use visuals"], "current": current},
            CoachMode.LESSON,
        )

        self.assertEqual(projected["coach_mode"], CoachMode.LESSON.value)
        self.assertEqual(projected["current"], current)
        self.assertEqual(projected["teacher_guidance"], [])

    def test_lesson_management_questions_have_a_fixed_redirect(self):
        for intent in (
            "calendar_action_request",
            "calendar_clarification",
            "calendar_query",
            "goal_planning",
            "task_query",
        ):
            self.assertEqual(
                lesson_management_redirect(intent, "he"),
                "היי, עכשיו אני מתמקד איתך בלמידת הלומדה. כדי לקבל מידע בנושא, אפשר לצאת מהלומדה ולדבר איתי שם. 📚",
            )

    def test_lesson_content_questions_do_not_have_a_redirect(self):
        self.assertIsNone(lesson_management_redirect("learning_help", "he"))


class LessonManagementRedirectTests(unittest.TestCase):
    def test_task_question_in_a_lesson_does_not_load_learner_data(self):
        async def collect() -> str:
            chunks = []
            async for chunk in coach.run_coach_stream(
                "learner-pseudonym",
                user_message="אילו משימות יש לי?",
                language="he",
                surface_context={"screen": "learning_lesson"},
            ):
                chunks.append(chunk)
            return "".join(chunks)

        screened = Mock(text="אילו משימות יש לי?")
        build_bundle = AsyncMock()
        with patch.object(coach.safety, "screen_input", return_value=screened), \
             patch.object(coach.safety, "has_unrespectful_language", return_value=False), \
             patch.object(coach.sessions, "get_recent", AsyncMock(return_value=[])), \
             patch.object(coach.safety, "classify_disclosure", AsyncMock(return_value="safe")), \
             patch.object(coach, "build_coach_bundle", build_bundle):
            output = asyncio.run(collect())

        self.assertEqual(output, lesson_management_redirect("task_query", "he"))
        build_bundle.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()