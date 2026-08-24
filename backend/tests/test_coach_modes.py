"""Mode boundaries for lesson and general Yuvi chats."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach_modes import CoachMode, project_bundle, resolve_mode  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()