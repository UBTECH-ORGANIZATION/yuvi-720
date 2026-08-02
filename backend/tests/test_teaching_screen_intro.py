"""Yuvi must open a turn on screens that TEACH, not only on screens that ask.

`question_intro` is deliberately gated silent when no question resolves — that is
what keeps the iframe's cover frame quiet. But the client sent it for EVERY
arrival, so a video or a summary screen produced an empty stream, the client
dropped the empty bubble, and the chat showed no thread for that screen at all
("why are there no chat sections for learnings or videos"). The teaching screens
now get their own trigger; these tests pin both halves of that contract.
"""

from __future__ import annotations

import asyncio
import copy
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach  # noqa: E402


VIDEO_SCREEN = {
    "current": {
        "question": {},                       # a video asks nothing
        "informationToBot": "פריט העשרה: הקשר בין מדידה מדויקת וצדק…",
        "item": {
            "kind": "watch",
            "title": "פריט העשרה: הקשר בין מדידה מדויקת וצדק",
            "content_type": "motivational",
            "media_format": "video",
        },
        "recent_events": [],
        "hint_ladder": {},
    },
    "profile": {},
    "portrait": {},
    "locale": "he",
}

BARE_SCREEN = {
    "current": {"question": {}, "informationToBot": "", "item": {}, "recent_events": [], "hint_ladder": {}},
    "profile": {},
    "portrait": {},
    "locale": "he",
}


def _drive(trigger: str, bundle: dict, model_output=("בוא נצפה יחד בסרטון הקצר הזה. ",)):
    """Run the real proactive path with a stubbed model; return (streamed, instructions)."""
    seen: dict = {}

    async def fake_stream(messages, usage_context):
        seen["messages"] = messages
        for chunk in model_output:
            yield chunk

    async def fake_bundle(*args, **kwargs):
        return copy.deepcopy(bundle)

    async def async_none(*args, **kwargs):
        return None

    async def async_false(*args, **kwargs):
        return False

    async def async_list(*args, **kwargs):
        return []

    async def async_dict(*args, **kwargs):
        return {}

    async def safe(*args, **kwargs):
        return "safe"

    def passthrough(text, lang):
        return mock.Mock(text=text)

    async def run():
        chunks = []
        async for piece in coach.run_coach_stream(
            "test-learner", user_message=None, language="he", session_id="s1", trigger=trigger
        ):
            chunks.append(piece)
        return "".join(chunks)

    from app.agents import tutor_decision

    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(coach.sessions, "conversation_needs_title", async_false), \
         mock.patch.object(coach.sessions, "get_recent", async_list), \
         mock.patch.object(coach.sessions, "get_conversation_memory", async_dict), \
         mock.patch.object(coach.sessions, "append_turn", async_none), \
         mock.patch.object(tutor_decision, "log_decision", async_none), \
         mock.patch.object(tutor_decision, "record_hint_level", async_none):
        streamed = asyncio.run(run())
    return streamed, seen.get("messages")


def _prompt_text(messages) -> str:
    """Everything the model is shown — instructions, context block and trigger."""
    if not messages:
        return ""
    return " ".join(str(m.get("content") or "") for m in messages)


class TeachingScreenIntroTests(unittest.TestCase):
    def test_a_video_screen_gets_a_real_turn(self):
        streamed, _ = _drive("lesson_step_intro", VIDEO_SCREEN)
        self.assertIn("סרטון", streamed)

    def test_the_question_intro_still_stays_silent_there(self):
        """Which is exactly why the screen used to get no thread."""
        streamed, _ = _drive("question_intro", VIDEO_SCREEN)
        self.assertEqual(streamed, "")

    def test_a_screen_we_know_nothing_about_stays_silent(self):
        """Better no bubble than a bubble inventing what is on screen."""
        streamed, _ = _drive("lesson_step_intro", BARE_SCREEN)
        self.assertEqual(streamed, "")

    def test_the_coach_is_told_it_is_a_teaching_screen(self):
        _, messages = _drive("lesson_step_intro", VIDEO_SCREEN)
        prompt = _prompt_text(messages)
        self.assertIn("מסך לימוד", prompt)

    def test_the_screen_identity_reaches_the_context_block(self):
        """`current_question_text: —` alone reads as a question that failed to load."""
        prompt = _prompt_text(_drive("lesson_step_intro", VIDEO_SCREEN)[1])
        self.assertIn("current_screen_kind: watch", prompt)
        self.assertIn("current_screen_media: video", prompt)
        self.assertIn("current_screen_content_type: motivational", prompt)

    def test_the_video_medium_reaches_the_prompt(self):
        _, messages = _drive("lesson_step_intro", VIDEO_SCREEN)
        self.assertIn(coach.MEDIA_AWARENESS["video"]["he"], _prompt_text(messages))

    def test_a_question_screen_with_a_video_also_gets_the_media_note(self):
        """`…-01-01-003` plays a clip and then asks — both are true at once."""
        bundle = copy.deepcopy(VIDEO_SCREEN)
        bundle["current"]["question"] = {"text": "לפי מה נדע אם צריך לאפס?", "options": [], "correct": []}
        bundle["current"]["item"]["kind"] = "question"
        _, messages = _drive("question_intro", bundle, model_output=("בוא נסתכל על המסך. ",))
        self.assertIn(coach.MEDIA_AWARENESS["video"]["he"], _prompt_text(messages))


if __name__ == "__main__":
    unittest.main()
