"""The point_at_screen tool: server-resolved geometry, lesson-mode only.

The model picks a REGION from a static vocabulary; the handler resolves the
rect from the nightly capture. Missing/stale geometry still accepts the intent
as a whole-frame glow (region None) — the model decided attention belongs on
the lesson, and the frontend can honor that without a position.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import importlib  # noqa: E402

import app.agents.coach_tools  # noqa: F401,E402  (imports register the tools)
from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools import pointing_tools, registry  # noqa: E402
from app.services import content_intelligence  # noqa: E402


ANCHORS = {
    "regions": {"question": {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.1}},
    "no_internal_scroll": True,
    "capture_viewport": {"w": 1280, "h": 860},
}

BUNDLE = {"current": {"component_id": "comp-1", "item_id": "comp-1-001",
                      "question_id": "q1"}}


def _context(mode=CoachMode.LESSON, bundle=None):
    return registry.CoachToolContext(
        learner_id="learner", mode=mode, language="he",
        session_id="s1", exchange_id="x1", bundle=bundle or BUNDLE,
    )


def _dispatch(context, region="question"):
    return asyncio.run(registry.dispatch(
        "point_at_screen", {"region": region}, context))


class PointAtScreen(unittest.TestCase):
    def setUp(self):
        # Another suite's registry.reset_for_tests() wipes the import-time
        # registration; re-running the module puts the tool back.
        if not registry.is_registered_name("point_at_screen"):
            importlib.reload(pointing_tools)

    def test_the_enum_is_the_contract_vocabulary(self):
        tool = registry._REGISTRY["point_at_screen"]
        enum = tool.parameters["properties"]["region"]["enum"]
        self.assertEqual(set(enum), set(content_intelligence.ANCHOR_REGIONS))

    def test_lesson_mode_only(self):
        names = [s["function"]["name"] for s in registry.schemas(CoachMode.LESSON)]
        self.assertIn("point_at_screen", names)
        names = [s["function"]["name"] for s in registry.schemas(CoachMode.GENERAL)]
        self.assertNotIn("point_at_screen", names)
        result = _dispatch(_context(mode=CoachMode.GENERAL))
        self.assertEqual(result["error"], "tool_not_allowed_for_mode")

    def test_a_known_region_resolves_its_rect(self):
        context = _context()
        with mock.patch.object(content_intelligence, "screen_anchors",
                               return_value=ANCHORS):
            result = _dispatch(context)
        self.assertEqual(result["status"], "accepted")
        self.assertEqual(len(context.pointer_requests), 1)
        pointer = context.pointer_requests[0]
        self.assertEqual(pointer["region"], "question")
        self.assertEqual(pointer["rect"], ANCHORS["regions"]["question"])
        self.assertTrue(pointer["no_scroll"])
        self.assertEqual(pointer["question_key"], "comp-1|comp-1-001|q1")

    def test_a_missing_region_becomes_a_whole_frame_glow(self):
        context = _context()
        with mock.patch.object(content_intelligence, "screen_anchors",
                               return_value=ANCHORS):
            result = _dispatch(context, region="table")
        self.assertEqual(result["data"]["region"], "whole_screen")
        self.assertIsNone(context.pointer_requests[0]["region"])
        self.assertIsNone(context.pointer_requests[0]["rect"])

    def test_no_geometry_at_all_still_glows(self):
        context = _context()
        with mock.patch.object(content_intelligence, "screen_anchors",
                               return_value=None):
            result = _dispatch(context)
        self.assertEqual(result["status"], "accepted")
        self.assertIsNone(context.pointer_requests[0]["region"])

    def test_one_pointer_per_turn(self):
        context = _context()
        with mock.patch.object(content_intelligence, "screen_anchors",
                               return_value=ANCHORS):
            _dispatch(context, region="question")
            result = _dispatch(context, region="question")
        self.assertEqual(len(context.pointer_requests), 1)
        self.assertEqual(result["status"], "accepted")

    def test_no_screen_means_not_applicable(self):
        context = _context(bundle={"current": {}})
        result = _dispatch(context)
        self.assertEqual(result["status"], "not_applicable")
        self.assertEqual(context.pointer_requests, [])

    def test_the_kill_switch_declines(self):
        context = _context()
        with mock.patch.dict(os.environ, {"COACH_POINTING_ENABLED": "0"}):
            result = _dispatch(context)
        self.assertEqual(result["status"], "not_applicable")
        self.assertEqual(context.pointer_requests, [])

    def test_an_unknown_region_is_rejected_by_the_schema(self):
        result = asyncio.run(registry.dispatch(
            "point_at_screen", {"region": "sidebar"}, _context()))
        self.assertEqual(result["error"], "invalid_argument_value:region")


if __name__ == "__main__":
    unittest.main()
