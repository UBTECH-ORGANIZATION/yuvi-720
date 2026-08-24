"""Validated navigation contracts for Yuvi Coach action offers."""

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
from app.services import coach_actions  # noqa: E402
from app.agents import coach  # noqa: E402


def _context() -> CoachToolContext:
    return CoachToolContext(
        learner_id="learner-1",
        mode=CoachMode.GENERAL,
        language="he",
        session_id="general-1",
        exchange_id="exchange-1",
        bundle={},
    )


class CoachActionTests(unittest.TestCase):
    def setUp(self):
        reset_for_tests()
        from app.agents.coach_tools import action_tools
        importlib.reload(action_tools)

    def tearDown(self):
        reset_for_tests()

    def test_catalog_returns_only_a_client_safe_navigation_card(self):
        result = coach_actions.offer("open_calendar", CoachMode.GENERAL)
        self.assertEqual(result["status"], "available")
        self.assertEqual(result["data"], {
            "action_id": "open_calendar",
            "path": "/student-dashboard/calendar",
            "label_key": "companion.action.calendar",
            "category": "navigation",
        })
        self.assertNotIn("endpoint", result["data"])
        self.assertNotIn("payload", result["data"])

    def test_action_tool_rejects_a_model_invented_action_id(self):
        result = asyncio.run(dispatch(
            "offer_student_action", {"action_id": "delete_everything"}, _context()
        ))
        self.assertEqual(result, {"error": "invalid_argument_value:action_id"})

    def test_action_tool_schema_has_only_catalog_action_ids(self):
        schema = next(
            item for item in schemas(CoachMode.GENERAL)
            if item["function"]["name"] == "offer_student_action"
        )
        values = schema["function"]["parameters"]["properties"]["action_id"]["enum"]
        self.assertEqual(set(values), set(coach_actions.action_ids(CoachMode.GENERAL)))

    def test_fallback_navigation_targets_the_requested_unavailable_area(self):
        empty_bundle = {"goals": [], "profile": {}, "current": {"task_status": "no_open_task"}}
        cases = {
            "calendar_action_request": "open_calendar",
            "calendar_clarification": "open_calendar",
            "goal_planning": "open_goals",
            "task_query": "open_tasks",
            "profile_question": "open_profile",
            "dashboard_query": "open_dashboard",
        }
        for intent, expected_action in cases.items():
            self.assertEqual(coach._fallback_navigation_action(intent, empty_bundle), expected_action)

    def test_fallback_navigation_does_not_offer_available_data_area(self):
        bundle = {
            "goals": [{"text": "Practice fractions"}],
            "profile": {"interests": ["space"]},
            "current": {"task_status": "resume_available"},
        }
        self.assertIsNone(coach._fallback_navigation_action("goal_planning", bundle))
        self.assertIsNone(coach._fallback_navigation_action("task_query", bundle))
        self.assertIsNone(coach._fallback_navigation_action("profile_question", bundle))
        self.assertIsNone(coach._fallback_navigation_action(
            "calendar_query", bundle, {"status": "available", "items": [{"title": "Math"}]}
        ))

    def test_calendar_fallback_navigation_opens_calendar_when_data_is_unavailable(self):
        self.assertEqual(
            coach._fallback_navigation_action("calendar_query", {}, {"status": "unavailable"}),
            "open_calendar",
        )

    def test_calendar_action_request_opens_calendar_even_when_schedule_is_available(self):
        self.assertEqual(
            coach._fallback_navigation_action(
                "calendar_action_request",
                {},
                {"status": "available", "items": []},
            ),
            "open_calendar",
        )

    def test_fallback_action_is_catalog_validated_and_not_duplicated(self):
        offers: list[dict[str, object]] = []
        coach._append_fallback_navigation_action(offers, "open_calendar", CoachMode.GENERAL)
        coach._append_fallback_navigation_action(offers, "open_calendar", CoachMode.GENERAL)
        self.assertEqual([offer["action_id"] for offer in offers], ["open_calendar"])


if __name__ == "__main__":
    unittest.main()