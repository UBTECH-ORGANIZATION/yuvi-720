"""Phase 6 — the anti-hallucination contract, asserted on the agent loop.

The prompt asks the model to stay grounded. These tests assert what happens when
it does not, because a contract that only exists in prompt text is a hope.

The provider is stubbed throughout: these are tests of *our* control flow —
which answers ship, which are blocked, and what the teacher is told instead.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import teacher_assistant, teacher_tools
from app.agents.teacher_tools.registry import TeacherToolContext
from app.services.ai_usage import UsageContext

USAGE = UsageContext(
    actor_id="teacher-a", actor_type="teacher",
    endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
    operation="teacher_assistant.round_0", source="teacher_assistant",
)

MINE = "kid-mine"


def context(**overrides) -> TeacherToolContext:
    base = dict(
        teacher_id="teacher-a", language="he",
        allowed_group_ids=frozenset({"group-mine"}),
        allowed_learner_ids=frozenset({MINE}),
        is_admin=False, usage_context=USAGE,
    )
    base.update(overrides)
    return TeacherToolContext(**base)


def text_message(content):
    return {"role": "assistant", "content": content}


def tool_message(name, args):
    return {
        "role": "assistant", "content": None,
        "tool_calls": [{
            "id": "call-1", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }],
    }


class GroundingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_a_factual_answer_with_no_tool_call_is_not_shipped(self):
        """Layer 2. The model states a number it never fetched."""
        rounds = [
            text_message("רון נמצא ב-73% התקדמות במתמטיקה."),   # ungrounded claim
            text_message("רון נמצא ב-73% התקדמות במתמטיקה."),   # forced round, still no tools
        ]
        with patch.object(teacher_assistant, "call_llm",
                          AsyncMock(side_effect=rounds)):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "מה ההתקדמות של רון?", context=context())

        self.assertIsNone(result["text"], "an ungrounded factual claim was shipped")
        self.assertEqual(result["text_key"], teacher_assistant.UNKNOWN_NO_DATA)
        self.assertFalse(result["grounded"])

    async def test_the_forced_reprompt_can_rescue_the_turn(self):
        """A model that forgot to call a tool gets exactly one more chance."""
        rounds = [
            text_message("רון נמצא ב-73%."),                       # ungrounded
            tool_message("get_student_overview", {"learner_id": MINE}),  # forced
            text_message("על פי הנתונים, {{student:kid-mine}} התקדם ב-40%."),
        ]
        with patch.object(teacher_assistant, "call_llm", AsyncMock(side_effect=rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"math": {"percent": 40}},
                                           "struggle_items": []})):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "מה ההתקדמות של רון?", context=context())

        self.assertTrue(result["grounded"])
        self.assertIn("40%", result["text"])
        self.assertEqual(result["tools"][0]["name"], "get_student_overview")

    async def test_a_conversational_reply_is_not_forced_through_tools(self):
        """"תודה" must not burn a forced round."""
        with patch.object(teacher_assistant, "call_llm",
                          AsyncMock(return_value=text_message("בשמחה!"))) as llm:
            result = await teacher_assistant.run_assistant(
                "teacher-a", "תודה", context=context())

        self.assertEqual(result["text"], "בשמחה!")
        self.assertEqual(llm.await_count, 1)

    async def test_a_grounded_answer_reports_its_trace(self):
        """Layer 5 — the trace is what makes the claim checkable."""
        rounds = [
            tool_message("get_student_overview", {"learner_id": MINE}),
            text_message("{{student:kid-mine}} מתקשה בשברים."),
        ]
        with patch.object(teacher_assistant, "call_llm", AsyncMock(side_effect=rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"math": {}},
                                           "struggle_items": [{"label": "שברים"}]})):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "איך רון מסתדר?", context=context())

        self.assertEqual(len(result["tools"]), 1)
        self.assertEqual(result["tools"][0]["status"], "ok")
        self.assertTrue(result["grounded"])

    async def test_an_out_of_scope_question_surfaces_the_refusal_in_the_trace(self):
        rounds = [
            tool_message("get_student_overview", {"learner_id": "kid-theirs"}),
            text_message("התלמיד/ה הזה/זו אינו/ה באחת הקבוצות שלך."),
        ]
        with patch.object(teacher_assistant, "call_llm", AsyncMock(side_effect=rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "מה שלום התלמיד של המורה השנייה?", context=context())

        self.assertEqual(result["tools"][0]["status"], "error")
        self.assertEqual(result["tools"][0]["reason"], "not_authorized")

    async def test_an_empty_tool_result_is_visible_as_empty_not_ok(self):
        """A teacher must be able to see that the tool found nothing."""
        rounds = [
            tool_message("get_student_overview", {"learner_id": MINE}),
            text_message("אין נתונים על התלמיד/ה בשבועיים האחרונים."),
        ]
        with patch.object(teacher_assistant, "call_llm", AsyncMock(side_effect=rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {}, "struggle_items": []})):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "מה שלום רון?", context=context())

        self.assertEqual(result["tools"][0]["status"], "empty")
        self.assertEqual(result["tools"][0]["reason"], "learner_has_no_activity")

    async def test_no_provider_produces_an_honest_key_not_an_invented_answer(self):
        with patch.object(teacher_assistant, "call_llm", AsyncMock(return_value=None)):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "מה שלום הכיתה?", context=context())

        self.assertIsNone(result["text"])
        self.assertEqual(result["text_key"], teacher_assistant.UNAVAILABLE)

    async def test_the_round_budget_caps_a_tool_calling_loop(self):
        """A model that only ever calls tools must still terminate."""
        looping = tool_message("list_my_groups", {})
        with patch.object(teacher_assistant, "call_llm",
                          AsyncMock(return_value=looping)) as llm, \
             patch("app.brain.org.groups_for_teacher", AsyncMock(return_value=[])):
            result = await teacher_assistant.run_assistant(
                "teacher-a", "ספר לי הכל", context=context())

        self.assertLessEqual(llm.await_count, teacher_tools.MAX_ROUNDS + 2)
        self.assertIsNotNone(result)

    async def test_one_usage_row_per_round(self):
        """Cost stays attributable per round (plan risk 6)."""
        seen: list[str] = []

        async def fake_llm(messages, *, usage_context, **kwargs):
            seen.append(usage_context.operation)
            return (tool_message("list_my_groups", {}) if len(seen) == 1
                    else text_message("יש לך קבוצה אחת."))

        with patch.object(teacher_assistant, "call_llm", fake_llm), \
             patch("app.brain.org.groups_for_teacher",
                   AsyncMock(return_value=[{"_id": "group-mine", "name": "ז1"}])):
            await teacher_assistant.run_assistant(
                "teacher-a", "אילו קבוצות יש לי?", context=context())

        self.assertEqual(seen, ["teacher_assistant.round_0", "teacher_assistant.round_1"])


class ScopeResolutionTests(unittest.IsolatedAsyncioTestCase):
    async def test_scope_is_resolved_from_the_server_before_the_model_runs(self):
        with patch("app.brain.org.is_admin", AsyncMock(return_value=False)), \
             patch("app.brain.org.groups_for_teacher",
                   AsyncMock(return_value=[{"_id": "group-mine"}])), \
             patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=[MINE, "kid-2"])):
            ctx = await teacher_assistant.build_context("teacher-a", language="he")

        self.assertEqual(ctx.allowed_group_ids, frozenset({"group-mine"}))
        self.assertEqual(ctx.allowed_learner_ids, frozenset({MINE, "kid-2"}))
        self.assertFalse(ctx.is_admin)

    async def test_a_school_admin_gets_their_schools_not_the_ministry(self):
        """`groups_for_teacher` already narrows a school admin — do not widen it."""
        with patch("app.brain.org.is_admin", AsyncMock(return_value=True)), \
             patch("app.brain.org.groups_for_teacher",
                   AsyncMock(return_value=[{"_id": "group-school-1"}])), \
             patch("app.brain.org.learners_in_group", AsyncMock(return_value=["kid-a"])):
            ctx = await teacher_assistant.build_context("admin-school", language="he")

        self.assertEqual(ctx.allowed_group_ids, frozenset({"group-school-1"}))
        self.assertTrue(ctx.is_admin)


class SystemPromptTests(unittest.TestCase):
    def test_the_prompt_states_the_ministry_rules(self):
        prompt = teacher_assistant._system_prompt("he", {})
        lowered = prompt.lower()
        for phrase in ("never compare", "arithmetic", "no data", "list_students"):
            self.assertIn(phrase, lowered, f"the prompt no longer states: {phrase}")

    def test_the_prompt_tells_the_model_it_has_no_names(self):
        prompt = teacher_assistant._system_prompt("he", {})
        self.assertIn("{{student:", prompt)
        self.assertIn("not given student names", prompt)

    def test_the_prompt_carries_the_screen_when_reported(self):
        prompt = teacher_assistant._system_prompt("he", {"route": "/teacher/student/kid-1"})
        self.assertIn("/teacher/student/kid-1", prompt)


if __name__ == "__main__":
    unittest.main()
