"""Safety boundaries for the learner Coach tool registry."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools.registry import (  # noqa: E402
    CoachTool,
    CoachToolContext,
    dispatch,
    register,
    reset_for_tests,
    schemas,
)


async def _handler(_context: CoachToolContext, args: dict) -> dict:
    return {"data": args}


def _context(mode: CoachMode) -> CoachToolContext:
    return CoachToolContext(
        learner_id="learner-1",
        mode=mode,
        language="he",
        session_id="session-1",
        exchange_id="exchange-1",
        bundle={},
    )


class CoachToolRegistryTests(unittest.TestCase):
    def setUp(self):
        reset_for_tests()
        register(CoachTool(
            name="lesson_only_tool",
            description="Test-only lesson tool.",
            parameters={
                "type": "object",
                "properties": {"period": {"type": "string", "enum": ["today"]}},
                "required": ["period"],
            },
            handler=_handler,
            allowed_modes=frozenset({CoachMode.LESSON}),
        ))

    def tearDown(self):
        reset_for_tests()

    def test_general_mode_does_not_receive_lesson_tool_schema(self):
        self.assertEqual(schemas(CoachMode.GENERAL), [])
        self.assertEqual(schemas(CoachMode.LESSON)[0]["function"]["name"], "lesson_only_tool")

    def test_general_mode_cannot_dispatch_lesson_tool(self):
        result = asyncio.run(dispatch("lesson_only_tool", {"period": "today"}, _context(CoachMode.GENERAL)))
        self.assertEqual(result, {"error": "tool_not_allowed_for_mode"})

    def test_unknown_argument_is_rejected(self):
        result = asyncio.run(dispatch(
            "lesson_only_tool",
            {"period": "today", "learner_id": "other"},
            _context(CoachMode.LESSON),
        ))
        self.assertEqual(result, {"error": "unknown_argument"})


if __name__ == "__main__":
    unittest.main()