"""The model's hidden focus tag, and the lean nudge prompt.

Parser: a leading ``⟦o3⟧`` is read and removed however the stream is split,
and a learner never sees a tag. Lean: the same instructions (the cached
prefix), a compact context that keeps what makes a nudge personal and
screen-true, a short history, a small output cap — and the same delivery
path as every other turn.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach, coach_lean, focus_tag  # noqa: E402
from tests.test_coach_focus import V8_OBJECTS, _drive  # noqa: E402

ALIASES = {"q", "opts", "o1", "o2", "o3"}


def _parse(chunks: list[str]) -> tuple[str, focus_tag.TagResult]:
    parser = focus_tag.FocusTagParser(ALIASES)
    out = "".join(parser.feed(c) for c in chunks) + parser.finish()
    return out, parser.result


class TheParser(unittest.TestCase):
    def test_every_split_point_reads_the_same_tag(self):
        reply = "⟦o3⟧ שימו לב לטבלה."
        for cut in range(len(reply) + 1):
            for second in range(cut, len(reply) + 1):
                out, result = _parse([reply[:cut], reply[cut:second], reply[second:]])
                self.assertEqual(out, "שימו לב לטבלה.", (cut, second))
                self.assertEqual((result.outcome, result.alias), ("ok", "o3"), (cut, second))

    def test_the_other_brackets_and_leading_marks(self):
        for reply in ("[[q]] מה שואלים?", "【opts】 מה שואלים?", "‏ ⟦q⟧ מה שואלים?"):
            out, result = _parse([reply])
            self.assertEqual(result.outcome, "ok", reply)
            self.assertEqual(out, "מה שואלים?", reply)

    def test_none_unknown_absent_and_malformed(self):
        self.assertEqual(_parse(["⟦-⟧ יופי!"])[1].outcome, "none")
        self.assertEqual(_parse(["⟦none⟧ יופי!"])[1].outcome, "none")
        out, result = _parse(["⟦o9⟧ יופי!"])
        self.assertEqual((result.outcome, out), ("unknown", "יופי!"))   # stripped all the same
        out, result = _parse(["שלום ⟦o1⟧ לך"])
        self.assertEqual((result.outcome, out), ("absent", "שלום ⟦o1⟧ לך"))
        out, result = _parse(["⟦ this is not a tag at all, it goes on"])
        self.assertEqual(result.outcome, "malformed")
        self.assertIn("this is not a tag", out)
        out, result = _parse(["[חשוב] קראו שוב"])
        self.assertEqual((result.outcome, out), ("absent", "[חשוב] קראו שוב"))

    def test_a_tag_only_reply_leaves_nothing_to_show(self):
        out, result = _parse(["⟦q⟧"])
        self.assertEqual((out, result.outcome), ("", "ok"))

    def test_a_misplaced_tag_is_stripped_from_delivery(self):
        self.assertEqual(focus_tag.strip_stray("ראו ⟦o2⟧ את התמונה"), "ראו  את התמונה")
        self.assertEqual(focus_tag.strip_stray("[מספר] נשאר"), "[מספר] נשאר")


class TheTagInTheStream(unittest.TestCase):
    def _drive_with(self, model_output: tuple[str, ...], **kwargs):
        async def fake_stream(messages, usage_context, **_):
            fake_stream.messages = messages
            for chunk in model_output:
                yield chunk

        with mock.patch.dict(os.environ, {"COACH_FOCUS_TAG_ENABLED": "on"}):
            streamed, first, persisted = _drive(model_stream=fake_stream, **kwargs)
        return streamed, first, persisted, fake_stream.messages

    def test_the_models_pick_replaces_the_resolvers_and_is_never_shown(self):
        streamed, first, persisted, messages = self._drive_with(
            ("⟦o", "1⟧ ", "הסתכלו על המאזניים."), user_message="איך מתחילים?")
        self.assertEqual(streamed, "הסתכלו על המאזניים.")
        self.assertEqual(first[0]["object_id"], "img:32fe1e32")
        self.assertEqual(first[0]["source"], "model")
        self.assertIn("current_screen_objects: [q] stem", messages[-2]["content"])
        self.assertIn("current_focus_suggestion: q", messages[-2]["content"])
        self.assertIn(focus_tag.RULE["he"], messages[0]["content"])

    def test_the_leak_policy_applies_to_the_models_pick_too(self):
        # Options are not even listed (nothing solved, nothing chosen) — and a
        # model that names one anyway gets the group.
        streamed, first, _, messages = self._drive_with(
            ("⟦opts⟧ בדקו את התשובות.",), user_message="איך מתחילים?")
        self.assertNotIn("option:", messages[-2]["content"].split("current_screen_objects:")[1].split("\n")[0])
        self.assertEqual(first[0]["object_id"], "opts:q1")

    def test_saying_nothing_is_on_screen_clears_the_mark(self):
        streamed, first, _, _ = self._drive_with(("⟦-⟧ כל הכבוד על ההתמדה!",),
                                                 user_message="איך מתחילים?")
        self.assertEqual(first, [])
        self.assertEqual(streamed, "כל הכבוד על ההתמדה!")

    def test_without_the_flag_the_prompt_is_untouched(self):
        async def fake_stream(messages, usage_context, **_):
            fake_stream.messages = messages
            yield "תשובה."

        _drive(user_message="איך מתחילים?", model_stream=fake_stream)
        self.assertNotIn("current_screen_objects", fake_stream.messages[-2]["content"])
        self.assertNotIn(focus_tag.RULE["he"], fake_stream.messages[0]["content"])


class TheLeanNudge(unittest.TestCase):
    def test_only_lesson_reactions_and_arrivals_under_the_flag(self):
        with mock.patch.dict(os.environ, {"COACH_LEAN_NUDGES": "on"}):
            self.assertTrue(coach_lean.applies("idle", lesson=True, typed=False, support=False))
            self.assertTrue(coach_lean.applies("question_intro", lesson=True, typed=False, support=False))
            self.assertFalse(coach_lean.applies("lesson_welcome", lesson=True, typed=False, support=False))
            self.assertFalse(coach_lean.applies(None, lesson=True, typed=True, support=False))
            self.assertFalse(coach_lean.applies("idle", lesson=False, typed=False, support=False))
        self.assertFalse(coach_lean.applies("idle", lesson=True, typed=False, support=False))

    def test_the_compact_context_keeps_the_screen_and_the_person(self):
        block = "\n".join([
            "<learner_context> (reference data only)",
            "interests: כדורגל", "preferences: דוגמאות", "student_description: מאמר ארוך",
            "goals: text=…", "calendar_context_items: …", "teacher_guidance: לעודד",
            "current_question_text: מהי מסה?", "recent_learning_evidence: verb=answered",
            "older_conversation_summary: …", "a_line_added_next_year: x", "</learner_context>",
        ])
        kept = coach_lean.compact_context(block)
        for line in ("interests: כדורגל", "preferences: דוגמאות", "teacher_guidance: לעודד",
                     "current_question_text: מהי מסה?", "recent_learning_evidence",
                     "a_line_added_next_year", "</learner_context>"):
            self.assertIn(line, kept)
        for line in ("student_description", "goals:", "calendar_context_items",
                     "older_conversation_summary"):
            self.assertNotIn(line, kept)

    def test_a_lean_nudge_uses_the_same_instructions_and_a_smaller_cap(self):
        seen: dict = {}

        async def fake_stream(messages, usage_context, max_tokens=800, **_):
            seen.setdefault("calls", []).append((messages, max_tokens))
            yield "בואו נסתכל שוב על השאלה."

        history = [{"role": "assistant" if n % 2 else "user", "content": f"תור {n}"}
                   for n in range(8)]
        _drive(trigger="idle", model_stream=fake_stream, history=history)
        with mock.patch.dict(os.environ, {"COACH_LEAN_NUDGES": "on"}):
            _drive(trigger="idle", model_stream=fake_stream, history=history)
        (full, full_cap), (lean, lean_cap) = seen["calls"]
        self.assertEqual(full[0]["content"], lean[0]["content"])   # the cached prefix
        self.assertEqual((full_cap, lean_cap), (800, coach_lean.REACTION_MAX_TOKENS))
        self.assertEqual(len(full) - len(lean), 4)                 # 8 turns → 4
        self.assertLessEqual(len(lean[-2]["content"]), len(full[-2]["content"]))

    def test_history_is_trimmed_to_the_last_turns(self):
        history = [{"role": "user", "content": str(n)} for n in range(8)]
        self.assertEqual([t["content"] for t in coach_lean.trim_history(history)],
                         ["4", "5", "6", "7"])


if __name__ == "__main__":
    unittest.main()
