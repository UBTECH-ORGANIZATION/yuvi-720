"""Phase 6 — the streamed assistant keeps every promise the blocking one made.

Streaming is where a grounding contract goes to die: text on a teacher's screen
cannot be unsaid, so an answer that the blocking path would have *replaced* must
never have been streamed in the first place. These tests assert the buffering
rule that makes that true, plus parity of the final payload with `run_assistant`.

The provider is stubbed throughout — this is a test of our control flow.
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
    endpoint="/api/teacher/assistant/stream", feature="feature_6_teacher_view",
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


def text_round(content: str, *, chunks: int = 3):
    """A round that writes `content`, split the way a provider would."""
    size = max(1, -(-len(content) // chunks))
    pieces = [content[i:i + size] for i in range(0, len(content), size)]
    return {"text": pieces, "message": {"role": "assistant", "content": content}}


def tool_round(name: str, args: dict):
    return {"text": [], "message": {
        "role": "assistant", "content": None,
        "tool_calls": [{
            "id": "call-1", "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }],
    }}


def stub_provider(rounds: list[dict]):
    """Replay scripted rounds through the `call_llm_stream_tools` event shape."""
    remaining = list(rounds)

    async def fake(messages, **kwargs):
        if not remaining:
            return
        current = remaining.pop(0)
        if current is None:      # a dead provider yields nothing at all
            return
        for piece in current["text"]:
            yield {"type": "text", "text": piece}
        yield {"type": "message", "message": current["message"]}

    return fake


async def drain(generator) -> tuple[list[str], list[list], dict]:
    """Collect a run into (text chunks, trace snapshots, final payload)."""
    chunks: list[str] = []
    traces: list[list] = []
    done: dict = {}
    async for event in generator:
        if "text" in event:
            chunks.append(event["text"])
        elif "trace" in event:
            traces.append(event["trace"])
        elif "done" in event:
            done = event["done"]
    return chunks, traces, done


class StreamGroundingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_an_ungrounded_factual_answer_is_never_streamed(self):
        """The rule that makes streaming safe: no tool result, no visible text."""
        rounds = [
            text_round("רון נמצא ב-73% התקדמות במתמטיקה."),   # ungrounded claim
            text_round("רון נמצא ב-73% התקדמות במתמטיקה."),   # forced round, still nothing
        ]
        with patch.object(teacher_assistant, "call_llm_stream_tools", stub_provider(rounds)):
            chunks, _, done = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "מה ההתקדמות של רון?", context=context()))

        self.assertEqual(chunks, [], "an ungrounded claim reached the teacher's screen")
        self.assertIsNone(done["text"])
        self.assertEqual(done["text_key"], teacher_assistant.UNKNOWN_NO_DATA)
        self.assertFalse(done["grounded"])

    async def test_a_grounded_answer_streams_before_it_finishes(self):
        rounds = [
            tool_round("get_student_overview", {"learner_id": MINE}),
            text_round("{{student:kid-mine}} מתקשה בשברים.", chunks=4),
        ]
        with patch.object(teacher_assistant, "call_llm_stream_tools", stub_provider(rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"math": {}},
                                           "struggle_items": [{"label": "שברים"}]})):
            chunks, traces, done = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "איך רון מסתדר?", context=context()))

        self.assertGreater(len(chunks), 1, "the answer arrived in one blocking piece")
        self.assertEqual("".join(chunks), done["text"])
        self.assertTrue(done["grounded"])
        # The trace lands before the answer does — that is what the panel shows
        # while the tool rounds run.
        self.assertEqual(traces[0][0]["name"], "get_student_overview")

    async def test_chit_chat_is_released_once_the_gate_declines_to_fire(self):
        """"תודה" is buffered, never blocked — the teacher still sees it."""
        with patch.object(teacher_assistant, "call_llm_stream_tools",
                          stub_provider([text_round("בשמחה!")])):
            chunks, _, done = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "תודה", context=context()))

        self.assertEqual("".join(chunks), "בשמחה!")
        self.assertEqual(done["text"], "בשמחה!")

    async def test_the_forced_reprompt_still_rescues_the_turn(self):
        rounds = [
            text_round("רון נמצא ב-73%."),                            # ungrounded, buffered
            tool_round("get_student_overview", {"learner_id": MINE}),  # forced
            text_round("על פי הנתונים, {{student:kid-mine}} התקדם ב-40%."),
        ]
        with patch.object(teacher_assistant, "call_llm_stream_tools", stub_provider(rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"math": {"percent": 40}},
                                           "struggle_items": []})):
            chunks, _, done = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "מה ההתקדמות של רון?", context=context()))

        self.assertTrue(done["grounded"])
        self.assertIn("40%", done["text"])
        # The discarded first draft must not be part of what was said.
        self.assertNotIn("73%", "".join(chunks))

    async def test_no_provider_produces_an_honest_key_not_an_invented_answer(self):
        with patch.object(teacher_assistant, "call_llm_stream_tools", stub_provider([None])):
            chunks, _, done = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "מה שלום הכיתה?", context=context()))

        self.assertEqual(chunks, [])
        self.assertIsNone(done["text"])
        self.assertEqual(done["text_key"], teacher_assistant.UNAVAILABLE)

    async def test_the_final_payload_matches_the_blocking_path(self):
        """Two entry points, one contract — the client must not care which ran."""
        def rounds():
            return [
                tool_round("get_student_overview", {"learner_id": MINE}),
                text_round("{{student:kid-mine}} מתקשה בשברים."),
            ]

        insights = AsyncMock(return_value={"progress": {"math": {}},
                                           "struggle_items": [{"label": "שברים"}]})
        with patch.object(teacher_assistant, "call_llm_stream_tools", stub_provider(rounds())), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights", insights):
            _, _, streamed = await drain(teacher_assistant.run_assistant_stream(
                "teacher-a", "איך רון מסתדר?", context=context()))

        blocking_rounds = [step["message"] for step in rounds()]
        with patch.object(teacher_assistant, "call_llm", AsyncMock(side_effect=blocking_rounds)), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights", insights):
            blocking = await teacher_assistant.run_assistant(
                "teacher-a", "איך רון מסתדר?", context=context())

        self.assertEqual(streamed, blocking)


class VoiceTests(unittest.TestCase):
    """The answer style is a product promise, so it is asserted, not hoped for."""

    def setUp(self):
        self.prompt = teacher_assistant._system_prompt("he", {})

    def test_the_prompt_forbids_printing_internal_identifiers(self):
        lowered = self.prompt.lower()
        self.assertIn("learner_has_no_goals", lowered)
        self.assertIn("never write a tool name", lowered)

    def test_the_prompt_no_longer_asks_for_the_raw_reason(self):
        """The old wording ("say why, using the reason") is what leaked the codes."""
        self.assertNotIn("using the reason", self.prompt.lower())
        self.assertIn("translate the reason", self.prompt.lower())

    def test_the_prompt_bounds_the_length_and_the_shape(self):
        lowered = self.prompt.lower()
        self.assertIn("120 words", lowered)
        self.assertIn("bullets only", lowered)
        self.assertIn("utc", lowered)          # …as a thing never to print
        self.assertIn("one concrete offer", lowered)


if __name__ == "__main__":
    unittest.main()
