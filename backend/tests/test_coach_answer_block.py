"""End-to-end wiring: a reveal produced by the model never reaches the client.

The matcher itself is covered in test_answer_guard. This drives the real
`run_coach_stream` with a stubbed model that emits the exact leak observed in
production, and asserts the learner receives the refusal instead — including
that everything after the reveal is dropped, and that the persisted turn matches
what was actually shown.
"""

from __future__ import annotations

import asyncio
import copy
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import answer_guard, coach  # noqa: E402


BALLOON_BUNDLE = {
    "current": {
        "question": {
            "text": "איזה בלון כבד יותר — המנופח או הריק?",
            "options": ["הבלון המנופח כבד יותר", "הבלון הריק כבד יותר"],
            "correct": ["הבלון המנופח כבד יותר"],
        },
        "recent_events": [],
        "hint_ladder": {},
    },
    "profile": {},
    "portrait": {},
    "locale": "he",
}


def _drive(
    model_output: list[str],
    user_message: str | None = "תן לי את התשובה",
    trigger: str | None = None,
):
    """Run the coach with a stubbed model; return (streamed_text, persisted)."""
    persisted: dict = {}
    debug_trace: list[dict[str, str]] = []

    async def fake_stream(messages, usage_context):
        for chunk in model_output:
            yield chunk

    async def fake_bundle(*args, **kwargs):
        return copy.deepcopy(BALLOON_BUNDLE)

    async def fake_append_turn(*args, **kwargs):
        persisted.update(kwargs)

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
            "test-learner", user_message=user_message, trigger=trigger,
            language="he", session_id="s1",
            surface_context={"screen": "learning_lesson", "component_id": "mass-component"},
            debug_trace=debug_trace,
        ):
            chunks.append(piece)
        persisted["debug_trace"] = debug_trace
        return "".join(chunks)

    from app.agents import tutor_decision

    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(coach, "classify_query_intent", lambda *a, **k: "learning_help"), \
         mock.patch.object(coach.sessions, "conversation_needs_title", async_false), \
         mock.patch.object(coach.sessions, "get_recent", async_list), \
         mock.patch.object(coach.sessions, "get_conversation_memory", async_dict), \
         mock.patch.object(coach.sessions, "append_turn", fake_append_turn), \
         mock.patch.object(tutor_decision, "log_decision", async_none), \
         mock.patch.object(tutor_decision, "record_hint_level", async_none):
        streamed = asyncio.run(run())
    return streamed, persisted


class CoachAnswerBlockTests(unittest.TestCase):
    def test_the_reveal_never_reaches_the_learner(self):
        streamed, _ = _drive([
            "התשובה היא שהבלון המנופח כבד יותר, כי יש בו אוויר. ",
            "ולחמצן יש מסה, אז כשיש יותר אוויר בתוך הבלון יש לו יותר מסה. ",
        ])
        self.assertNotIn("המנופח כבד יותר", streamed)
        self.assertIn(answer_guard.REDIRECT["he"], streamed)

    def test_content_after_the_reveal_is_dropped_too(self):
        """Whatever followed was built on the answer already being out."""
        streamed, _ = _drive([
            "התשובה היא שהבלון המנופח כבד יותר. ",
            "עכשיו נסה לחשוב למה זה ככה. ",
        ])
        self.assertNotIn("עכשיו נסה לחשוב", streamed)

    def test_clean_guidance_before_a_reveal_is_kept(self):
        streamed, _ = _drive([
            "בוא נתחיל ממה שנכנס לבלון כשמנפחים אותו. ",
            "התשובה היא שהבלון המנופח כבד יותר. ",
        ])
        self.assertIn("בוא נתחיל ממה שנכנס לבלון", streamed)
        self.assertIn(answer_guard.REDIRECT["he"], streamed)

    def test_a_guiding_reply_streams_through_untouched(self):
        streamed, _ = _drive([
            "מה בעצם נכנס לבלון כשמנפחים אותו? ",
            "ואם לאוויר יש מסה, מה זה אומר על המאזניים? ",
        ])
        self.assertIn("מה בעצם נכנס לבלון", streamed)
        self.assertIn("מה זה אומר על המאזניים", streamed)
        self.assertNotIn(answer_guard.REDIRECT["he"], streamed)

    def test_lesson_question_context_does_not_consume_the_entire_reply_budget(self):
        streamed, _ = _drive([
            "השאלה הפעילה היא מצאו את האוצר. ",
            "לפניכם שתי תיבות. ",
            "המסה של כל אחת מהן היא 10 ק\"ג. ",
            "סימנת נפח התיבה. ",
            "כדי להשוות משקל צריך לבדוק גם את המסה. ",
        ], user_message="מה השאלה הפעילה ומה סימנתי?")

        self.assertIn("סימנת נפח התיבה", streamed)
        self.assertIn("כדי להשוות משקל", streamed)

    def test_persisted_turn_matches_what_the_learner_saw(self):
        streamed, persisted = _drive([
            "התשובה היא שהבלון המנופח כבד יותר. ",
        ])
        self.assertEqual(persisted.get("assistant"), streamed.strip())
        self.assertNotIn("המנופח כבד יותר", persisted.get("assistant", ""))

    def test_hint_mode_is_guarded_too(self):
        streamed, _ = _drive(["הבלון המנופח כבד יותר, כי יש בו אוויר. "])
        self.assertIn(answer_guard.REDIRECT["he"], streamed)

    def test_blocked_question_intro_uses_safe_availability_fallback(self):
        streamed, persisted = _drive(
            ["הבלון המנופח כבד יותר, כי יש בו אוויר. "],
            user_message=None,
            trigger="question_intro",
        )
        fallback = coach.QUESTION_INTRO_BLOCKED_FALLBACK["he"]
        self.assertEqual(streamed, fallback)
        self.assertEqual(persisted.get("assistant"), fallback)
        self.assertNotIn(answer_guard.REDIRECT["he"], streamed)
        self.assertNotIn("המנופח כבד יותר", streamed)

    def test_safe_question_intro_streams_normally(self):
        streamed, persisted = _drive(
            ["בוא/י נבדוק מה קורה כשמנפחים את הבלון. "],
            user_message=None,
            trigger="question_intro",
        )
        self.assertEqual(streamed, "בוא/י נבדוק מה קורה כשמנפחים את הבלון.")
        self.assertEqual(persisted.get("assistant"), streamed)
        self.assertNotIn(coach.QUESTION_INTRO_BLOCKED_FALLBACK["he"], streamed)


if __name__ == "__main__":
    unittest.main()
