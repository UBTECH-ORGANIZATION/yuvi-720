"""Contracts for built-in learner-safe Coach read tools."""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools.registry import (  # noqa: E402
    CoachToolContext,
    dispatch,
    reset_for_tests,
    schemas,
)


def _context() -> CoachToolContext:
    return CoachToolContext(
        learner_id="learner-1",
        mode=CoachMode.GENERAL,
        language="he",
        session_id="general-1",
        exchange_id="exchange-1",
        bundle={
            "goals": [{"text": "Practice fractions", "deadline": "2026-08-30", "status": "open"}],
            "teacher_guidance": ["never expose this"],
            "profile": {
                "interests": ["space"],
                "learning_style": "visual",
                "preferences": ["examples"],
            },
            "strengths": ["curiosity"],
            "challenges": ["fractions"],
            "strategies": ["use diagrams"],
            "current": {"on_lesson_screen": False, "task_status": "no_open_task"},
            "reflection_summary": {
                "has_recent_reflection": True,
                "recent_count": 1,
                "most_recent_prompt_id": "lesson:fractions",
                "most_recent_at": "2026-08-20T10:00:00+00:00",
                "answer": "must never be exposed",
            },
        },
    )


class CoachReadToolsTests(unittest.TestCase):
    def setUp(self):
        reset_for_tests()
        from app.agents.coach_tools import read_tools
        importlib.reload(read_tools)

    def tearDown(self):
        reset_for_tests()

    def test_general_schemas_expose_only_safe_read_tools(self):
        names = {schema["function"]["name"] for schema in schemas(CoachMode.GENERAL)}
        self.assertEqual(
            names,
            {"get_active_goals", "get_profile_summary", "get_learning_status", "get_reflection_summary", "get_calendar"},
        )

    def test_profile_projection_omits_teacher_guidance(self):
        result = asyncio.run(dispatch("get_profile_summary", {}, _context()))
        self.assertEqual(result["status"], "available")
        self.assertNotIn("teacher_guidance", result["data"])
        self.assertEqual(result["data"]["interests"], ["space"])

    def test_goals_tool_returns_only_scoped_bundle_goals(self):
        result = asyncio.run(dispatch("get_active_goals", {}, _context()))
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"], [{"text": "Practice fractions", "deadline": "2026-08-30", "status": "open"}])

    def test_reflection_summary_omits_the_learner_answer(self):
        result = asyncio.run(dispatch("get_reflection_summary", {}, _context()))
        self.assertEqual(result["status"], "available")
        self.assertTrue(result["data"]["has_recent_reflection"])
        self.assertNotIn("answer", result["data"])


if __name__ == "__main__":
    unittest.main()