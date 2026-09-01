"""The pregen short-circuit: same wire, same persistence, zero model calls.

Drives the real ``run_coach_stream`` with a stubbed model and a stubbed
content-intelligence lookup, and pins the contract from the plan: a fresh
Hebrew pregen text streams exactly as authored with NO model call and the
identical persistence shape; every miss condition (absent, non-Hebrew,
answer-guard flag, personal triggers) falls through to the live path; and the
hint/explanation baselines are injected as guidance, never served verbatim.
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
from app.services import content_intelligence  # noqa: E402


LESSON_BUNDLE = {
    "current": {
        "on_lesson_screen": True,
        "component_id": "comp-1",
        "item_id": "comp-1-001",
        "question_id": "q1",
        "question": {
            "text": "מהי יחידת המידה של מסה?",
            "options": ["גרם", "ניוטון"],
            "correct": ["גרם"],
        },
        "item": {"title": "פתיחה", "kind": "question"},
        "informationToBot": "מסך על יחידות מידה",
        "recent_events": [],
        "hint_ladder": {},
    },
    "profile": {},
    "portrait": {},
    "locale": "he",
}

PREGEN = {
    "question_intro": "שאלה ראשונה מחכה לכם על המסך.",
    "lesson_step_intro": "במסך הזה נכיר את הרעיון המרכזי.",
    "lesson_welcome": "היום נלמד על מדידת מסה.",
    "video_summary": "בסרטון רואים איך שוקלים גוף.",
    "hint_l1": "חשבו איזו יחידה מתאימה למדידת חומר.",
    "explanation": "השאלה בודקת הבנה של יחידות מידה למסה.",
}


def _drive(
    *, trigger=None, support_mode=None, user_message=None, language="he",
    pregen=None, hint_level=None, model_output=("תשובה חיה מהמודל.",),
    bundle_overrides=None, arrival_question=None, pregen_question_gate=None,
):
    """(streamed, persisted, model_calls) from one run_coach_stream pass.

    ``bundle_overrides`` merges into ``current`` (e.g. a stale question
    pointer); ``arrival_question`` stubs ``arrival_question_id`` (the slide's
    first question for an arriving learner, None when the pointer already
    names a question on the slide); ``pregen_question_gate`` makes
    question-scope lookups hit only for that question id — the shape of a
    config that stores q1 while the brain still points at the previous
    screen's question.
    """
    persisted: dict = {}
    counters = {"model": 0}

    async def fake_stream(messages, usage_context):
        counters["model"] += 1
        persisted["model_messages"] = messages
        for chunk in model_output:
            yield chunk

    async def fake_bundle(*args, **kwargs):
        bundle = copy.deepcopy(LESSON_BUNDLE)
        bundle["current"].update(bundle_overrides or {})
        return bundle

    async def fake_append_turn(*args, **kwargs):
        persisted.update(kwargs)

    def fake_pregen(kind, component_id, item_id="", question_id=""):
        table = pregen if pregen is not None else {}
        text = table.get(kind)
        if text is None:
            return None
        if (pregen_question_gate is not None
                and kind in ("question_intro", "hint_l1", "explanation")
                and question_id != pregen_question_gate):
            return None
        persisted.setdefault("pregen_lookups", []).append(
            (kind, component_id, item_id, question_id))
        return {"text": text, "fingerprint": "abcd", "kind": kind}

    async def fake_greeting(learner_id, lang):
        return "היי גל!"

    async def async_none(*a, **k):
        return None

    async def async_false(*a, **k):
        return False

    async def async_list(*a, **k):
        return []

    async def async_dict(*a, **k):
        return {}

    async def no_tool_plan(messages, *a, **k):
        return messages

    async def safe(*a, **k):
        return "safe"

    def passthrough(text, lang):
        return mock.Mock(text=text)

    async def run():
        chunks = []
        trace: list[dict[str, str]] = []
        async for piece in coach.run_coach_stream(
            "test-learner", user_message=user_message, language=language,
            session_id="s1", trigger=trigger, support_mode=support_mode,
            hint_level=hint_level,
            surface_context={"screen": "learning_lesson", "component_id": "comp-1"},
            debug_trace=trace,
        ):
            chunks.append(piece)
        persisted["debug_trace"] = trace
        return "".join(chunks)

    from app.agents import tutor_decision

    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(coach, "welcome_greeting", fake_greeting), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(coach, "_plan_coach_tools", no_tool_plan), \
         mock.patch.object(content_intelligence, "pregen_text", fake_pregen), \
         mock.patch.object(content_intelligence, "arrival_question_id",
                           lambda *a: arrival_question), \
         mock.patch.object(content_intelligence, "record_pregen_hit", async_none), \
         mock.patch.object(content_intelligence, "enrichment", lambda *a: None), \
         mock.patch.object(coach.sessions, "conversation_needs_title", async_false), \
         mock.patch.object(coach.sessions, "get_recent", async_list), \
         mock.patch.object(coach.sessions, "get_conversation_memory", async_dict), \
         mock.patch.object(coach.sessions, "append_turn", fake_append_turn), \
         mock.patch("app.brain.consolidator.capture_and_consolidate", async_none), \
         mock.patch.object(tutor_decision, "log_decision", async_none), \
         mock.patch.object(tutor_decision, "record_hint_level", async_none):
        streamed = asyncio.run(run())
    return streamed, persisted, counters["model"]


class FreshPregenServesWithoutTheModel(unittest.TestCase):
    def test_question_intro_streams_the_stored_text(self):
        streamed, persisted, model_calls = _drive(
            trigger="question_intro", pregen=PREGEN)
        self.assertEqual(streamed, PREGEN["question_intro"])
        self.assertEqual(model_calls, 0)
        self.assertEqual(persisted["question_key"], "comp-1|comp-1-001|q1")
        self.assertFalse(persisted["include_user_in_history"])
        self.assertIn("pregen_hit:question_intro",
                      [t.get("name") for t in persisted["debug_trace"]])

    def test_lesson_welcome_keeps_the_deterministic_greeting(self):
        streamed, persisted, model_calls = _drive(
            trigger="lesson_welcome", pregen=PREGEN)
        self.assertEqual(streamed, f"היי גל! {PREGEN['lesson_welcome']}")
        self.assertEqual(model_calls, 0)
        self.assertEqual(persisted["assistant"], f"היי גל! {PREGEN['lesson_welcome']}")

    def test_step_intro_and_video_summary_serve_from_item_scope(self):
        for trigger, support in (("lesson_step_intro", None), (None, "video_summary")):
            streamed, persisted, model_calls = _drive(
                trigger=trigger, support_mode=support, pregen=PREGEN)
            self.assertEqual(model_calls, 0, (trigger, support))
            kind = trigger or "video_summary"
            self.assertEqual(streamed, PREGEN[kind])
            lookup = persisted["pregen_lookups"][-1]
            self.assertEqual(lookup[1:], ("comp-1", "comp-1-001", ""))


class EveryMissFallsThroughToLive(unittest.TestCase):
    def test_arrival_with_empty_question_pointer_serves_the_first_intro(self):
        # The screen_change push is `component|item` — on arrival the question
        # pointer is empty. The slide's first question serves its intro,
        # whether it is the only one or the top of a multi-part screen.
        streamed, persisted, model_calls = _drive(
            trigger="question_intro", pregen=PREGEN,
            bundle_overrides={"question_id": ""},
            arrival_question="q1", pregen_question_gate="q1")
        self.assertEqual(streamed, PREGEN["question_intro"])
        self.assertEqual(model_calls, 0)
        self.assertIn(("question_intro", "comp-1", "comp-1-001", "q1"),
                      persisted["pregen_lookups"])

    def test_a_stale_pointer_from_the_previous_screen_falls_back(self):
        # The brain still names the PREVIOUS screen's question (q3, not on this
        # slide); the miss retries with the slide's arrival question.
        streamed, _, model_calls = _drive(
            trigger="question_intro", pregen=PREGEN,
            bundle_overrides={"question_id": "q3"},
            arrival_question="q1", pregen_question_gate="q1")
        self.assertEqual(streamed, PREGEN["question_intro"])
        self.assertEqual(model_calls, 0)

    def test_a_pointer_on_this_slide_never_gets_the_first_part_intro(self):
        # The pointer names a question that IS on the slide (the learner is
        # mid-screen) but its text is absent — arrival_question_id returns
        # None in that shape, and the intro must not re-open part 1 on someone
        # standing at part 3: live generation it is.
        _, persisted, model_calls = _drive(
            trigger="question_intro", pregen=PREGEN,
            bundle_overrides={"question_id": "q3"},
            arrival_question=None, pregen_question_gate="q1")
        self.assertEqual(model_calls, 1)
        self.assertIn("pregen_miss:question_intro",
                      [t["name"] for t in persisted["debug_trace"]])

    def test_an_assumed_position_is_declared_to_the_model(self):
        # Entry without a reported screen grounds on a position GUESS (last
        # recorded screen, or the first on a fresh start), and the context
        # says so — the coach may use the content, never the position.
        _, persisted, _ = _drive(
            user_message="מה אני רואה?", pregen={},
            bundle_overrides={"position_assumed": True})
        context = "".join(str(m) for m in persisted["model_messages"])
        self.assertIn("_screen_position: assumed_screen", context)
        _, persisted, _ = _drive(user_message="מה אני רואה?", pregen={})
        context = "".join(str(m) for m in persisted["model_messages"])
        self.assertIn("_screen_position: reported", context)

    def test_a_variant_screen_demands_hedged_specifics(self):
        # The assumed screen has look-alike catalog siblings (same wording,
        # different data) — the context carries the do-not-quote-values rule.
        _, persisted, _ = _drive(
            user_message="מה אני רואה?", pregen={},
            bundle_overrides={"position_assumed": True,
                              "screen_has_variants": True})
        context = "".join(str(m) for m in persisted["model_messages"])
        self.assertIn("_screen_variants:", context)
        _, persisted, _ = _drive(user_message="מה אני רואה?", pregen={})
        context = "".join(str(m) for m in persisted["model_messages"])
        self.assertNotIn("_screen_variants:", context)

    def test_an_absent_text_generates_live(self):
        streamed, persisted, model_calls = _drive(
            trigger="question_intro", pregen={})
        self.assertEqual(model_calls, 1)
        self.assertIn("תשובה חיה", streamed)
        self.assertIn("pregen_miss:question_intro",
                      [t.get("name") for t in persisted["debug_trace"]])

    def test_a_non_hebrew_ui_generates_live(self):
        _, _, model_calls = _drive(
            trigger="question_intro", language="en", pregen=PREGEN)
        self.assertEqual(model_calls, 1)

    def test_a_body_that_reveals_the_answer_is_never_served(self):
        leaky = dict(PREGEN, question_intro="רמז קטן: התשובה היא גרם.")
        streamed, _, model_calls = _drive(trigger="question_intro", pregen=leaky)
        self.assertEqual(model_calls, 1)          # live path took over
        self.assertNotIn("התשובה היא גרם", streamed)

    def test_personal_triggers_always_stay_live(self):
        _, persisted, model_calls = _drive(
            trigger="success", pregen=dict(PREGEN, success="כל הכבוד!"))
        self.assertEqual(model_calls, 1)
        self.assertNotIn("pregen_hit:success",
                         [t.get("name") for t in persisted["debug_trace"]])

    def test_a_real_learner_message_never_short_circuits(self):
        _, _, model_calls = _drive(
            user_message="מה זה מסה?", pregen=PREGEN)
        self.assertEqual(model_calls, 1)


class BaselinesGroundTheModelNotTheLearner(unittest.TestCase):
    def _instructions(self, persisted) -> str:
        return persisted["model_messages"][0]["content"]

    def test_hint_l1_carries_the_baseline_as_guidance(self):
        _, persisted, model_calls = _drive(
            support_mode="hint", hint_level=1, pregen=PREGEN)
        self.assertEqual(model_calls, 1)          # the model still answers
        self.assertIn(PREGEN["hint_l1"], self._instructions(persisted))
        self.assertIn("קו בסיס", self._instructions(persisted))

    def test_hint_l2_stays_fully_live(self):
        _, persisted, _ = _drive(support_mode="hint", hint_level=2, pregen=PREGEN)
        self.assertNotIn(PREGEN["hint_l1"], self._instructions(persisted))

    def test_explanation_carries_its_baseline(self):
        _, persisted, _ = _drive(support_mode="explanation", pregen=PREGEN)
        self.assertIn(PREGEN["explanation"], self._instructions(persisted))


class EnrichmentReachesTheContextBlock(unittest.TestCase):
    def test_render_context_names_what_the_screen_shows(self):
        bundle = copy.deepcopy(LESSON_BUNDLE)
        bundle["current"]["screen_enrichment"] = {
            "visible_text": "לפניכם שתי תיבות שוות מסה",
            "media": ["video: מסה ומשקל (143s)"],
        }
        bundle["coach_mode"] = "lesson_coach"
        rendered = coach._render_context(bundle, "מה רואים על המסך?")
        self.assertIn("current_screen_visible_text: לפניכם שתי תיבות", rendered)
        self.assertIn("current_screen_media_inventory: video: מסה ומשקל", rendered)

    def test_absent_enrichment_renders_a_quiet_dash(self):
        bundle = copy.deepcopy(LESSON_BUNDLE)
        bundle["coach_mode"] = "lesson_coach"
        rendered = coach._render_context(bundle, "שאלה")
        self.assertIn("current_screen_visible_text: —", rendered)


if __name__ == "__main__":
    unittest.main()
