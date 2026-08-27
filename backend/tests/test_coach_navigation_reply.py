"""General Coach navigation replies stay short and do not invent UI details."""

from __future__ import annotations

import asyncio
import copy
import os
import sys
import unittest
from unittest import mock
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach  # noqa: E402
from app.agents.coach_modes import (  # noqa: E402
    NAVIGATION_ACTION_REPLY_INSTRUCTIONS,
    TEACHER_CHAT_ACTION_REPLY_INSTRUCTIONS,
)


class CoachNavigationReplyTests(unittest.TestCase):
    def test_general_action_offer_adds_the_reply_rule_and_limits_output_to_one_sentence(self):
        bundle = {
            "current": {"question": {}, "recent_events": [], "hint_ladder": {}},
            "profile": {},
            "portrait": {},
            "locale": "he",
        }
        captured_messages: list[dict[str, object]] = []
        append_turn = AsyncMock()

        async def plan_action(messages, context, *_args):
            context.action_offers.append({
                "action_id": "open_goals",
                "path": "/mentoring",
                "label_key": "companion.action.goals",
                "category": "navigation",
            })
            return messages

        async def stream_reply(messages, _usage_context):
            captured_messages.extend(messages)
            yield "הוספתי כפתור שיוביל אותך ליעדים שלך. הנה הסבר נוסף שלא צריך להופיע."

        async def collect() -> str:
            chunks = []
            async for chunk in coach.run_coach_stream(
                "learner-pseudonym",
                user_message="איפה היעדים שלי?",
                language="he",
                session_id="general-1",
                surface_context={"screen": "student_dashboard"},
            ):
                chunks.append(chunk)
            return "".join(chunks)

        passthrough = lambda text, _lang: mock.Mock(text=text)
        with patch.object(coach, "_plan_coach_tools", plan_action), \
             patch.object(coach, "_stream_coach_model", stream_reply), \
             patch.object(coach, "build_coach_bundle", AsyncMock(return_value=copy.deepcopy(bundle))), \
             patch.object(coach, "classify_query_intent", return_value="goal_planning"), \
             patch.object(coach.safety, "classify_disclosure", AsyncMock(return_value="safe")), \
             patch.object(coach.safety, "screen_input", side_effect=passthrough), \
             patch.object(coach.safety, "screen_output", side_effect=passthrough), \
             patch.object(coach.sessions, "conversation_needs_title", AsyncMock(return_value=False)), \
             patch.object(coach.sessions, "get_recent", AsyncMock(return_value=[])), \
             patch.object(coach.sessions, "get_conversation_memory", AsyncMock(return_value={})), \
             patch.object(coach.sessions, "append_turn", append_turn), \
             patch("app.brain.consolidator.capture_and_consolidate", AsyncMock(return_value=[])):
            output = asyncio.run(collect())

        self.assertEqual(output, "הוספתי כפתור שיוביל אותך ליעדים שלך.")
        self.assertIn(
            {"role": "system", "content": NAVIGATION_ACTION_REPLY_INSTRUCTIONS["he"]},
            captured_messages,
        )
        self.assertEqual(
            append_turn.await_args.kwargs["assistant_meta"]["actions"][0]["action_id"],
            "open_goals",
        )

    def test_teacher_chat_offer_uses_the_contact_capability_boundary(self):
        bundle = {
            "current": {"question": {}, "recent_events": [], "hint_ladder": {}},
            "profile": {},
            "portrait": {},
            "locale": "he",
        }
        captured_messages: list[dict[str, object]] = []

        async def plan_action(messages, context, *_args):
            context.action_offers.append({
                "action_id": "open_teacher_chat",
                "path": "/student-dashboard/chat",
                "label_key": "companion.action.teacher_chat",
                "category": "navigation",
            })
            return messages

        async def stream_reply(messages, _usage_context):
            captured_messages.extend(messages)
            yield "אני לא יכול לקבוע שיעור במקומך, אבל הוספתי דרך ליצור קשר עם המורה."

        async def collect() -> str:
            chunks = []
            async for chunk in coach.run_coach_stream(
                "learner-pseudonym",
                user_message="אני צריך לקבוע שיעור עם המורה",
                language="he",
                session_id="general-teacher-chat",
                surface_context={"screen": "student_dashboard"},
            ):
                chunks.append(chunk)
            return "".join(chunks)

        passthrough = lambda text, _lang: mock.Mock(text=text)
        with patch.object(coach, "_plan_coach_tools", plan_action), \
             patch.object(coach, "_stream_coach_model", stream_reply), \
             patch.object(coach, "build_coach_bundle", AsyncMock(return_value=copy.deepcopy(bundle))), \
             patch.object(coach, "classify_query_intent", return_value="learning_help"), \
             patch.object(coach.safety, "classify_disclosure", AsyncMock(return_value="safe")), \
             patch.object(coach.safety, "screen_input", side_effect=passthrough), \
             patch.object(coach.safety, "screen_output", side_effect=passthrough), \
             patch.object(coach.sessions, "conversation_needs_title", AsyncMock(return_value=False)), \
             patch.object(coach.sessions, "get_recent", AsyncMock(return_value=[])), \
             patch.object(coach.sessions, "get_conversation_memory", AsyncMock(return_value={})), \
             patch.object(coach.sessions, "append_turn", AsyncMock()), \
             patch("app.brain.consolidator.capture_and_consolidate", AsyncMock(return_value=[])):
            output = asyncio.run(collect())

        self.assertEqual(output, "אני לא יכול לקבוע שיעור במקומך, אבל הוספתי דרך ליצור קשר עם המורה.")
        self.assertIn(
            {"role": "system", "content": TEACHER_CHAT_ACTION_REPLY_INSTRUCTIONS["he"]},
            captured_messages,
        )


if __name__ == "__main__":
    unittest.main()
