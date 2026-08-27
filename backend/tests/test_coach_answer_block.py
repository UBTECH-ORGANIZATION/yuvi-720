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
    model_output: list[str] | list[list[str]], user_message: str = "תן לי את התשובה", support_mode: str | None = None,
    trigger: str | None = None, bundle: dict | None = None, query_intent: str = "learning_help",
):
    """Run the coach with a stubbed model; return (streamed_text, persisted)."""
    persisted: dict = {}
    model_calls = 0

    async def fake_stream(messages, usage_context):
        nonlocal model_calls
        persisted["model_messages"] = messages
        outputs = (
            model_output
            if not model_output or isinstance(model_output[0], str)
            else model_output[min(model_calls, len(model_output) - 1)]
        )
        model_calls += 1
        for chunk in outputs:
            yield chunk

    async def fake_bundle(*args, **kwargs):
        return copy.deepcopy(bundle or BALLOON_BUNDLE)

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
            "test-learner", user_message=user_message, language="he", session_id="s1",
            support_mode=support_mode,
            trigger=trigger,
            surface_context={"screen": "learning_lesson"},
        ):
            chunks.append(piece)
        return "".join(chunks)

    from app.agents import tutor_decision

    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(coach, "classify_query_intent", lambda *a, **k: query_intent), \
         mock.patch.object(coach.sessions, "conversation_needs_title", async_false), \
         mock.patch.object(coach.sessions, "get_recent", async_list), \
         mock.patch.object(coach.sessions, "get_conversation_memory", async_dict), \
         mock.patch.object(coach.sessions, "append_turn", fake_append_turn), \
         mock.patch("app.brain.consolidator.capture_and_consolidate", async_none), \
         mock.patch.object(tutor_decision, "log_decision", async_none), \
         mock.patch.object(tutor_decision, "record_hint_level", async_none):
        streamed = asyncio.run(run())
    return streamed, persisted


class CoachAnswerBlockTests(unittest.TestCase):
    def test_capabilities_query_is_grounded_and_limited_to_two_sentences(self):
        streamed, persisted = _drive(
            [
                "היי, אני יובי, ונצא יחד למסע למידה שמתאים בדיוק לקצב שלך ✨. "
                "אני כאן לחשוב איתך, לעודד ולמצוא בכל פעם את הצעד הבא. "
                "הנה פירוט של כל מה שאני יכול לעשות."
            ],
            user_message="מה אתה יכול לעשות?",
            query_intent="capabilities_query",
        )

        self.assertIn("היי, אני יובי", streamed)
        self.assertIn("✨", streamed)
        self.assertNotIn("הנה פירוט", streamed)
        self.assertIn(
            "יכולות מאושרות בלבד",
            persisted["model_messages"][0]["content"],
        )
        self.assertIn("אימוג'י אחד", persisted["model_messages"][0]["content"])

    def test_chat_originated_hint_streams_with_history(self):
        streamed, _ = _drive(
            ["בדוק קודם מה נשאר קבוע בין המדידות."],
            user_message="אפשר רמז?",
            support_mode="hint",
        )
        self.assertIn("מה נשאר קבוע", streamed)

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

    def test_persisted_turn_matches_what_the_learner_saw(self):
        streamed, persisted = _drive([
            "התשובה היא שהבלון המנופח כבד יותר. ",
        ])
        self.assertEqual(persisted.get("assistant"), streamed.strip())
        self.assertNotIn("המנופח כבד יותר", persisted.get("assistant", ""))

    def test_hint_mode_retries_a_blocked_draft(self):
        streamed, _ = _drive(
            [
                ["הבלון המנופח כבד יותר, כי יש בו אוויר. "],
                ["התשובה היא שהבלון המנופח כבד יותר. "],
                ["מה משתנה בבלון כשמכניסים אליו משהו? "],
            ],
            user_message="אפשר רמז?",
            support_mode="hint",
        )
        self.assertIn("מה משתנה בבלון", streamed)
        self.assertNotIn("המנופח כבד יותר", streamed)
        self.assertNotIn(answer_guard.REDIRECT["he"], streamed)

    def test_hint_mode_uses_safe_fallback_after_three_blocked_drafts(self):
        streamed, _ = _drive(
            [
                ["הבלון המנופח כבד יותר, כי יש בו אוויר. "],
                ["התשובה היא שהבלון המנופח כבד יותר. "],
                ["הבלון המנופח כבד יותר. "],
            ],
            user_message="אפשר רמז?",
            support_mode="hint",
        )
        self.assertIn(coach.HINT_GUARD_FALLBACK["he"], streamed)
        self.assertNotIn("המנופח כבד יותר", streamed)
        self.assertNotIn(answer_guard.REDIRECT["he"], streamed)

    def test_blocked_question_intro_stays_task_oriented(self):
        bundle = copy.deepcopy(BALLOON_BUNDLE)
        bundle["current"]["item"] = {"title": "תרגול: מיון פריטים"}

        streamed, _ = _drive(
            ["התשובה היא שהבלון המנופח כבד יותר. "],
            user_message=None,
            trigger="question_intro",
            bundle=bundle,
        )

        self.assertNotIn(answer_guard.REDIRECT["he"], streamed)
        self.assertIn("עכשיו עובדים על תרגול: מיון פריטים", streamed)
        self.assertNotIn("המנופח כבד יותר", streamed)


if __name__ == "__main__":
    unittest.main()
