"""Inside a lesson, a picture arrives when it was asked for — not on its own.

Mid-question, an unrequested diagram interrupts the work in front of the learner:
"what does this word mean?" wants an answer, not a scene. So lesson CHAT only
plans a visual on an explicit request; hints/explanations (the support endpoint)
and every screen outside a lesson keep auto-planning, and a reply that gets no
scene still offers the on-demand "show me" buttons.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes import agent as agent_routes  # noqa: E402


REPLY = "המילה 'מדידה' כאן מתארת את מה שהתקבל מהמכשיר בכל ניסיון, ולכן היא מספר. " * 2


class LessonVisualGateTests(unittest.TestCase):
    def _events(self, planner_result: dict | None) -> list[dict]:
        planner = AsyncMock(return_value=planner_result)
        renderer = AsyncMock(return_value={"renderer": "svg-fallback", "scene": {}, "caption": ""})
        with patch.object(agent_routes, "plan_manim_visual", planner), \
             patch.object(agent_routes, "render_visual", renderer), \
             patch.object(agent_routes.sessions, "attach_visual", AsyncMock(return_value=True)), \
             patch.object(agent_routes, "should_offer_visual", AsyncMock(return_value=False)), \
             patch.object(agent_routes, "_current_question_context", AsyncMock(return_value="")):
            async def collect():
                return [
                    json.loads(event.removeprefix("data: ").strip())
                    async for event in agent_routes._stream_visual_tail(
                        learner_id="L",
                        conversation_id="c",
                        exchange_id="e",
                        endpoint="/api/agent/coach/stream",
                        user_message="איך עובד מחזור המים?",
                        response_text=REPLY,
                        language="he",
                        on_lesson_screen=False,
                    )
                ]
            return asyncio.run(collect())

    def _planned(self, message: str, *, auto_visual: bool) -> bool:
        planner = AsyncMock(return_value=None)
        with patch.object(agent_routes, "plan_manim_visual", planner), \
             patch.object(agent_routes, "should_offer_visual", AsyncMock(return_value=False)), \
             patch.object(agent_routes, "_current_question_context", AsyncMock(return_value="")):
            async def drain():
                async for _ in agent_routes._stream_visual_tail(
                    learner_id="L",
                    conversation_id="c",
                    exchange_id="e",
                    endpoint="/api/agent/coach/stream",
                    user_message=message,
                    response_text=REPLY,
                    language="he",
                    on_lesson_screen=True,
                    auto_visual=auto_visual,
                ):
                    pass
            asyncio.run(drain())
        return planner.await_count > 0

    def test_a_comprehension_question_in_a_lesson_draws_nothing(self):
        self.assertFalse(self._planned("מה זה אומר במשפט הזה?", auto_visual=False))

    def test_asking_to_see_something_still_draws(self):
        self.assertTrue(self._planned("אפשר איור שיסביר את זה?", auto_visual=False))

    def test_outside_a_lesson_the_planner_still_judges_for_itself(self):
        self.assertTrue(self._planned("מה זה אומר במשפט הזה?", auto_visual=True))

    def test_calendar_query_disables_automatic_visuals(self):
        self.assertFalse(agent_routes._auto_visual_for_coach(
            "מה יש לי מחר?", "he", "student_dashboard",
        ))

    def test_regular_dashboard_query_keeps_automatic_visuals(self):
        self.assertTrue(agent_routes._auto_visual_for_coach(
            "איך עובד מחזור המים?", "he", "student_dashboard",
        ))

    def test_explicit_calendar_visual_request_still_draws(self):
        auto_visual = agent_routes._auto_visual_for_coach(
            "אפשר איור של מערכת השעות שלי?", "he", "student_dashboard",
        )
        self.assertFalse(auto_visual)
        self.assertTrue(self._planned(
            "אפשר איור של מערכת השעות שלי?", auto_visual=auto_visual,
        ))

    def test_declined_visual_plan_clears_the_preparing_status(self):
        statuses = [event["visual_status"] for event in self._events(None) if "visual_status" in event]
        self.assertEqual(statuses, ["planning", "none"])

    def test_accepted_visual_plan_reports_planning_before_rendering(self):
        scene = {"use_visual": True, "elements": []}
        statuses = [event["visual_status"] for event in self._events(scene) if "visual_status" in event]
        self.assertEqual(statuses, ["planning", "rendering"])

    def test_on_demand_general_chat_visual_is_attached_to_its_message(self):
        visual = {"id": "visual-1", "type": "image", "scene": {}}
        attached = AsyncMock(return_value=True)
        request = agent_routes.VisualizeRequest(
            user_message="אפשר לראות את זה?",
            assistant_text="כך פועל התהליך.",
            conversation_id="chat-1",
            assistant_message_id="exchange-1:1",
        )
        with patch.object(agent_routes, "plan_manim_visual", AsyncMock(return_value={"elements": []})), \
             patch.object(agent_routes, "render_visual", AsyncMock(return_value=visual)), \
             patch.object(agent_routes.sessions, "attach_visual", attached):
            asyncio.run(agent_routes.visualize(request, {"sub": "learner-1"}))
        attached.assert_awaited_once_with(
            "learner-1", "chat-1", "exchange-1:1", visual,
            "כך פועל התהליך.", "", role="general_companion",
        )
