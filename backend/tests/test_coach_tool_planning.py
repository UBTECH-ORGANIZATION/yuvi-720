"""Feature-flagged provider tool planning for Yuvi Coach."""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach import _plan_coach_tools  # noqa: E402
from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools.registry import (  # noqa: E402
    CoachTool,
    CoachToolContext,
    register,
    reset_for_tests,
)
from app.services.ai_usage import UsageContext  # noqa: E402


async def _tool_handler(_context: CoachToolContext, _args: dict) -> dict:
    return {"data": {"source": "test"}}


def _context() -> CoachToolContext:
    return CoachToolContext(
        learner_id="learner-1",
        mode=CoachMode.GENERAL,
        language="he",
        session_id="general-1",
        exchange_id="exchange-1",
        bundle={},
    )


def _usage() -> UsageContext:
    return UsageContext(
        actor_id="learner-1",
        actor_type="learner",
        endpoint="/test",
        feature="feature_3_learning_companion",
        operation="test",
        source="test",
    )


class CoachToolPlanningTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        reset_for_tests()
        register(CoachTool(
            name="test_read_tool",
            description="Test tool.",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=_tool_handler,
            allowed_modes=frozenset({CoachMode.GENERAL}),
        ))
        self.addCleanup(reset_for_tests)
        self._original_flag = os.environ.get("COACH_TOOL_CALLING_ENABLED")
        self.addCleanup(self._restore_flag)

    def _restore_flag(self):
        if self._original_flag is None:
            os.environ.pop("COACH_TOOL_CALLING_ENABLED", None)
        else:
            os.environ["COACH_TOOL_CALLING_ENABLED"] = self._original_flag

    async def test_enabled_planning_dispatches_tool_and_appends_result(self):
        os.environ["COACH_TOOL_CALLING_ENABLED"] = "true"
        provider = AsyncMock(side_effect=[
            {
                "role": "assistant",
                "tool_calls": [{
                    "id": "call-1",
                    "function": {"name": "test_read_tool", "arguments": "{}"},
                }],
            },
            {"role": "assistant", "content": "Ready to answer."},
        ])
        debug_trace: list[dict[str, str]] = []

        with patch("app.agents.coach.call_llm", provider):
            messages = await _plan_coach_tools(
                [{"role": "user", "content": "Hello"}], _context(), _usage(), debug_trace
            )

        self.assertEqual(provider.await_count, 2)
        self.assertEqual(messages[-1]["role"], "tool")
        self.assertEqual(messages[-1]["name"], "test_read_tool")
        self.assertIn('"source": "test"', str(messages[-1]["content"]))
        self.assertEqual(debug_trace, [{"name": "test_read_tool", "status": "ok", "source": "agent"}])

    async def test_disabled_planning_does_not_call_provider(self):
        os.environ["COACH_TOOL_CALLING_ENABLED"] = "false"
        provider = AsyncMock()

        with patch("app.agents.coach.call_llm", provider):
            messages = await _plan_coach_tools(
                [{"role": "user", "content": "Hello"}], _context(), _usage()
            )

        self.assertEqual(provider.await_count, 0)
        self.assertEqual(messages, [{"role": "user", "content": "Hello"}])


if __name__ == "__main__":
    unittest.main()