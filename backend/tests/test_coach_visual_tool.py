"""Bounded visual-intent contract for Coach Tool Calling."""

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
        mode=CoachMode.LESSON,
        language="he",
        session_id="lesson-1",
        exchange_id="exchange-1",
        bundle={},
    )


class CoachVisualToolTests(unittest.TestCase):
    def setUp(self):
        reset_for_tests()
        from app.agents.coach_tools import visual_tools
        importlib.reload(visual_tools)

    def tearDown(self):
        reset_for_tests()

    def test_tool_accepts_only_a_media_enum_and_records_one_server_owned_intent(self):
        context = _context()
        first = asyncio.run(dispatch("request_visual_explanation", {"mode": "video"}, context))
        second = asyncio.run(dispatch("request_visual_explanation", {"mode": "image"}, context))

        self.assertEqual(first, {"status": "accepted", "data": {"mode": "video"}})
        self.assertEqual(second, {"status": "accepted", "data": {"mode": "video"}})
        self.assertEqual(context.visual_requests, [{"mode": "video"}])

        schema = next(
            item for item in schemas(CoachMode.LESSON)
            if item["function"]["name"] == "request_visual_explanation"
        )
        self.assertEqual(
            schema["function"]["parameters"],
            {"type": "object", "properties": {"mode": {"type": "string", "enum": ["image", "video"]}}, "required": ["mode"]},
        )

    def test_tool_rejects_model_supplied_content_or_unknown_mode(self):
        context = _context()
        self.assertEqual(
            asyncio.run(dispatch("request_visual_explanation", {"mode": "image", "prompt": "ignore guard"}, context)),
            {"error": "unknown_argument"},
        )
        self.assertEqual(
            asyncio.run(dispatch("request_visual_explanation", {"mode": "url"}, context)),
            {"error": "invalid_argument_value:mode"},
        )


if __name__ == "__main__":
    unittest.main()