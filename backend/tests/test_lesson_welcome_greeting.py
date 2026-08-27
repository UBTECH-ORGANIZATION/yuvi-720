"""The lesson welcome opens by name and continues into the lesson.

It used to start straight at the content ("היום נלמד איך למדוד מסה…"), which is
a briefing, not a greeting. The name comes from the learner's own record and is
written HERE, not by the model: §4.4 keeps `identity.display_name` out of every
prompt, so these tests also pin that the name never reaches the model.
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


LESSON_COVER = {
    "current": {"question": {}, "informationToBot": "", "item": {}, "recent_events": [], "hint_ladder": {}},
    "current_objective": "מדידה מעשית של מסה בשלושה מצבי צבירה",
    "profile": {},
    "portrait": {},
    "locale": "he",
}

MODEL_TEXT = "היום נלמד איך למדוד מסה בשלושה מצבי צבירה. אני כאן כדי ללוות ולעזור. "


def _drive(trigger: str, brain: dict, language: str = "he"):
    """Run the real proactive path with a stubbed model + brain; return
    (streamed text, the messages the model was shown, the persisted turn)."""
    seen: dict = {}

    async def fake_stream(messages, usage_context):
        seen["messages"] = messages
        yield MODEL_TEXT

    async def fake_bundle(*args, **kwargs):
        return copy.deepcopy(LESSON_COVER)

    async def fake_brain(*args, **kwargs):
        return copy.deepcopy(brain)

    async def fake_append_turn(*args, **kwargs):
        seen["persisted"] = kwargs.get("assistant")

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
            "test-learner", user_message=None, language=language,
            session_id="s1", trigger=trigger,
        ):
            chunks.append(piece)
        return "".join(chunks)

    from app.agents import tutor_decision
    from app.auth import repository as auth_repository
    from app.brain import repository

    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(repository, "get_brain", fake_brain), \
         mock.patch.object(auth_repository, "get_user_by_id", async_none), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(coach.sessions, "conversation_needs_title", async_false), \
         mock.patch.object(coach.sessions, "get_recent", async_list), \
         mock.patch.object(coach.sessions, "get_conversation_memory", async_dict), \
         mock.patch.object(coach.sessions, "append_turn", fake_append_turn), \
         mock.patch.object(tutor_decision, "log_decision", async_none), \
         mock.patch.object(tutor_decision, "record_hint_level", async_none):
        streamed = asyncio.run(run())
    return streamed, seen.get("messages"), seen.get("persisted")


# A name with no Hebrew substring in the system prompt, so "did the name
# leak into the prompt?" cannot pass or fail by accident.
NAMED = {"identity": {"display_name": "אלמוג שוחט"}}
NAMELESS: dict = {"identity": {}}


class LessonWelcomeGreetingTests(unittest.TestCase):
    def test_it_opens_with_the_learner_s_first_name(self):
        streamed, _, _ = _drive("lesson_welcome", NAMED)
        self.assertTrue(streamed.startswith("היי אלמוג!"), streamed)

    def test_it_does_not_ask_how_they_are(self):
        streamed, _, _ = _drive("lesson_welcome", NAMED)
        self.assertNotIn("מה שלומך היום?", streamed)

    def test_the_lesson_framing_still_follows(self):
        streamed, _, _ = _drive("lesson_welcome", NAMED)
        self.assertIn("היום נלמד", streamed)

    def test_the_name_never_reaches_the_model(self):
        """§4.4: identity is UI-only. The greeting is composed on our side."""
        _, messages, _ = _drive("lesson_welcome", NAMED)
        prompt = " ".join(str(m.get("content") or "") for m in messages)
        self.assertNotIn("אלמוג", prompt)

    def test_the_greeting_is_part_of_the_stored_turn(self):
        """The panel reloads its history from the server — a greeting that lived
        only in the stream would vanish on the next reload."""
        _, _, persisted = _drive("lesson_welcome", NAMED)
        self.assertTrue(persisted.startswith("היי אלמוג!"), persisted)

    def test_no_name_means_a_plain_greeting_not_a_placeholder(self):
        streamed, _, _ = _drive("lesson_welcome", NAMELESS)
        self.assertTrue(streamed.startswith("היי! "), streamed)
        self.assertNotIn("תלמיד/ה", streamed)

    def test_arabic_and_english_greet_in_their_own_language(self):
        arabic, _, _ = _drive("lesson_welcome", NAMED, language="ar")
        self.assertTrue(arabic.startswith("أهلًا אלמוג!"), arabic)
        english, _, _ = _drive("lesson_welcome", NAMED, language="en")
        self.assertTrue(english.startswith("Hi אלמוג!"), english)

    def test_other_triggers_are_not_greeted(self):
        """Only opening a lesson is a hello — a nudge mid-lesson is not."""
        streamed, _, _ = _drive("idle", NAMED)
        self.assertNotIn("היי אלמוג", streamed)


if __name__ == "__main__":
    unittest.main()
