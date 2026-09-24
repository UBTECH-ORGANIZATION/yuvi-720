"""Focus marks: every on-task lesson reply shows WHAT it is about.

Pins the resolver's rules (coach_focus.decide), the leak policy and the
honesty caps (finalize), the wire frame for old and new clients (to_frame),
the planning gate (coach_planning), and the stream contract: the mark is
committed before the first word on the pregen, proactive, support and typed
paths, and every route flushes it ahead of the first text frame.
"""

from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach, coach_focus, coach_planning  # noqa: E402
from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools import registry  # noqa: E402
from app.services import content_intelligence  # noqa: E402


def _geo(x, y, w, h):
    return [{"w": 1280, "h": 860, "content_w": 1280, "content_h": 780,
             "rect": {"x": x, "y": y, "w": w, "h": h}}]


V8_OBJECTS = [
    {"id": "stem:q1", "kind": "stem", "role": "stem", "q": ["q1"], "parent": None,
     "option_index": None, "label": "השאלה", "geometry": _geo(100, 80, 900, 60)},
    {"id": "opts:q1", "kind": "options", "role": "answer_area", "q": ["q1"], "parent": None,
     "option_index": None, "label": "התשובות", "geometry": _geo(100, 240, 900, 150)},
    {"id": "opt:q1:0", "kind": "option", "role": "answer_area", "q": ["q1"],
     "parent": "opts:q1", "option_index": 0, "label": "אפשרות 1",
     "geometry": _geo(100, 240, 900, 70)},
    {"id": "opt:q1:1", "kind": "option", "role": "answer_area", "q": ["q1"],
     "parent": "opts:q1", "option_index": 1, "label": "אפשרות 2",
     "geometry": _geo(100, 320, 900, 70)},
    {"id": "img:32fe1e32", "kind": "image", "role": "data", "q": [], "parent": None,
     "option_index": None, "label": "המאזניים", "geometry": _geo(980, 80, 250, 250)},
]

CURRENT = {
    "on_lesson_screen": True,
    "component_id": "comp-1", "item_id": "comp-1-001", "question_id": "q1",
    "question": {"text": "מהי יחידת המידה של מסה?", "options": ["גרם", "ניוטון"],
                 "correct": ["גרם"], "reached": True},
    "item": {"title": "פתיחה", "kind": "question"},
    "recent_events": [],
}


def _current(**overrides):
    current = copy.deepcopy(CURRENT)
    current.update(overrides)
    return current


class _WithCatalog(unittest.TestCase):
    objects = V8_OBJECTS
    anchors = None

    def setUp(self):
        catalog = {"objects": copy.deepcopy(self.objects), "layout": {"kind": "fit_viewport"}} \
            if self.objects is not None else None
        patches = [
            mock.patch.object(content_intelligence, "screen_objects", lambda *a: catalog),
            mock.patch.object(content_intelligence, "screen_anchors", lambda *a: self.anchors),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def resolve(self, current=None, **kw):
        kw.setdefault("client_version", 2)
        return coach_focus.resolve(current or _current(), **kw)


class TheRules(_WithCatalog):
    def test_a_question_arrival_marks_the_question(self):
        frame, decision = self.resolve(trigger="question_intro")
        self.assertEqual(frame["object_id"], "stem:q1")
        self.assertEqual(frame["precision"], "exact")
        self.assertEqual(frame["region"], "question")
        self.assertEqual(frame["question_key"], "comp-1|comp-1-001|q1")

    def test_a_hint_points_at_the_data_never_an_option(self):
        frame, _ = self.resolve(support_mode="hint")
        self.assertEqual(frame["object_id"], "img:32fe1e32")
        frame, _ = self.resolve(support_mode="explanation")
        self.assertEqual(frame["kind"], "image")

    def test_the_welcome_and_praise_carry_no_mark(self):
        for trigger in ("lesson_welcome", "success"):
            frame, decision = self.resolve(trigger=trigger)
            self.assertIsNone(frame, trigger)

    def test_nudges_reorient_on_the_question(self):
        for trigger in ("idle", "slow_progress", "wheel_spinning", "rapid_guessing"):
            frame, _ = self.resolve(trigger=trigger)
            self.assertEqual(frame["object_id"], "stem:q1", trigger)

    def test_a_question_not_yet_reached_marks_the_medium(self):
        current = _current(question={**CURRENT["question"], "reached": False})
        frame, _ = self.resolve(current, trigger="idle")
        self.assertEqual(frame["object_id"], "img:32fe1e32")

    def test_typed_messages_mark_what_they_name(self):
        cases = {
            "מה רואים בתמונה?": "img:32fe1e32",
            "לא הבנתי את השאלה": "stem:q1",
            "מה זה הגרף הזה?": "img:32fe1e32",     # a graph drawn as a picture
            "איזה תשובות יש פה": "opts:q1",
            "why is the picture like that": "img:32fe1e32",
            "ما هذه الصورة": "img:32fe1e32",
            "איך מתחילים?": "stem:q1",             # nothing named → the question
        }
        for message, expected in cases.items():
            frame, _ = self.resolve(message=message, query_intent="learning_help")
            self.assertEqual(frame["object_id"], expected, message)

    def test_social_and_off_task_turns_carry_no_mark(self):
        for message, intent in (("תודה!", "learning_help"), ("hi", "learning_help"),
                                ("מה אני אוהב?", "profile_question"),
                                ("מה יש לי מחר?", "calendar_query")):
            frame, _ = self.resolve(message=message, query_intent=intent)
            self.assertIsNone(frame, message)

    def test_off_the_lesson_screen_nothing_is_marked(self):
        frame, _ = self.resolve(_current(on_lesson_screen=False), trigger="idle")
        self.assertIsNone(frame)


class TheLeakPolicy(_WithCatalog):
    def test_naming_an_option_marks_the_group_not_the_option(self):
        # Option 2 is wrong, option 1 is right: BOTH lift, or the mark would
        # tell which is which.
        for index in (0, 1):
            frame, decision = self.resolve(message=f"מה אומרת אפשרות {index + 1}?",
                                           query_intent="learning_help",
                                           referenced_option=index)
            self.assertEqual(frame["object_id"], "opts:q1")
            self.assertEqual(decision.lifted, "option_not_allowed")
            self.assertEqual(frame["precision"], "approx")

    def test_mark_the_right_answer_never_marks_an_option(self):
        frame, _ = self.resolve(message="תסמן לי את התשובה הנכונה",
                                query_intent="learning_help")
        self.assertNotEqual(frame["kind"], "option")

    def test_the_learners_own_choice_may_be_marked(self):
        current = _current(recent_events=[
            {"question_id": "q1", "success": False, "response": "ניוטון"}])
        frame, _ = self.resolve(current, trigger="mistake")
        self.assertEqual(frame["object_id"], "opt:q1:1")
        self.assertEqual(frame["ordinal"], 2)
        frame, _ = self.resolve(current, message="למה טעיתי?", query_intent="learning_help")
        self.assertEqual(frame["object_id"], "opt:q1:1")

    def test_once_solved_an_option_may_be_named(self):
        current = _current(recent_events=[
            {"question_id": "q1", "success": True, "response": "גרם"}])
        frame, _ = self.resolve(current, message="מה אומרת אפשרות 2?",
                                query_intent="learning_help", referenced_option=1)
        self.assertEqual(frame["object_id"], "opt:q1:1")

    def test_another_screens_q1_is_not_this_ones(self):
        current = _current(recent_events=[
            {"question_id": "q1", "item_id": "comp-1-000", "success": True, "response": "גרם"}])
        frame, _ = self.resolve(current, message="מה אומרת אפשרות 2?",
                                query_intent="learning_help", referenced_option=1)
        self.assertEqual(frame["object_id"], "opts:q1")

    def test_no_reason_ever_reaches_the_frame(self):
        frame, _ = self.resolve(message="מה אומרת אפשרות 1?",
                                query_intent="learning_help", referenced_option=0)
        wire = json.dumps(frame, ensure_ascii=False)
        for secret in ("lifted", "option_not_allowed", "rule", "typed:"):
            self.assertNotIn(secret, wire)


class HonestyCaps(_WithCatalog):
    def test_an_assumed_position_marks_by_name_only(self):
        frame, _ = self.resolve(_current(position_assumed=True), trigger="question_intro")
        self.assertEqual(frame["precision"], "semantic")
        self.assertEqual(frame["breakpoints"], [])

    def test_look_alike_variants_mark_whole_regions(self):
        current = _current(screen_has_variants=True, recent_events=[
            {"question_id": "q1", "success": False, "response": "ניוטון"}])
        frame, _ = self.resolve(current, trigger="mistake")
        self.assertEqual(frame["object_id"], "opts:q1")
        self.assertEqual(frame["precision"], "approx")

    def test_an_old_client_never_gets_a_mark_it_would_draw_as_a_glow(self):
        frame, _ = coach_focus.resolve(_current(position_assumed=True),
                                       trigger="question_intro", client_version=1)
        self.assertIsNone(frame)
        frame, _ = coach_focus.resolve(_current(), trigger="question_intro", client_version=1)
        self.assertEqual(set(frame), {"region", "breakpoints", "question_key"})
        self.assertTrue(frame["breakpoints"])


class WithoutAV8Capture(_WithCatalog):
    objects = None
    anchors = {"regions": {"image": [
        {"w": 1280, "h": 860, "content_w": 1280, "content_h": 780,
         "rect": {"x": 1, "y": 2, "w": 300, "h": 200},
         "parts": [{"x": 1, "y": 2, "w": 10, "h": 10}]}]}}

    def test_v7_regions_serve_approximately_and_the_catalog_fills_gaps(self):
        frame, _ = self.resolve(support_mode="hint")
        self.assertEqual(frame["object_id"], "image:v7")
        self.assertEqual(frame["precision"], "approx")
        self.assertNotIn("parts", frame["breakpoints"][0])
        frame, _ = self.resolve(trigger="question_intro")
        self.assertEqual(frame["object_id"], "stem:q1")      # from the catalog
        self.assertEqual(frame["precision"], "semantic")

    def test_no_capture_at_all_still_names_the_question(self):
        self.anchors = None
        frame, _ = self.resolve(trigger="question_intro")
        self.assertEqual((frame["kind"], frame["precision"]), ("stem", "semantic"))


class TheModeSwitch(unittest.TestCase):
    def test_pointing_kill_switch_wins(self):
        with mock.patch.dict(os.environ, {"COACH_POINTING_ENABLED": "0",
                                          "COACH_FOCUS_MARKS_ENABLED": "on"}):
            self.assertEqual(coach_focus.mode(), "off")
        with mock.patch.dict(os.environ, {"COACH_FOCUS_MARKS_ENABLED": "shadow"}):
            self.assertEqual(coach_focus.mode(), "shadow")


class ThePlanningGate(unittest.TestCase):
    def test_a_plain_question_is_not_a_cue(self):
        for message in ("מה זה מסה?", "תן לי רמז", "אני אמורה לפתור את זה?"):
            self.assertFalse(coach_planning.teacher_help_cue(message, [], "learning_help"), message)

    def test_asking_for_the_teacher_or_frustration_is(self):
        for message in ("אפשר לקרוא למורה?", "נמאס לי מזה", "I give up", "أريد المعلمة"):
            self.assertTrue(coach_planning.teacher_help_cue(message, [], "learning_help"), message)

    def test_still_lost_counts_only_after_help(self):
        helped = [{"role": "assistant", "content": "רמז"}, {"role": "assistant", "content": "הסבר"}]
        self.assertFalse(coach_planning.teacher_help_cue("עדיין לא הבנתי", [], "learning_help"))
        self.assertTrue(coach_planning.teacher_help_cue("עדיין לא הבנתי", helped, "learning_help"))

    def test_gated_plans_with_the_teacher_tool_alone(self):
        with mock.patch.dict(os.environ, {"COACH_LESSON_PLANNING": "gated"}):
            self.assertIsNone(coach_planning.lesson_tools(cue=False, focus_marks_on=True))
            self.assertEqual(coach_planning.lesson_tools(cue=True, focus_marks_on=True),
                             frozenset({"suggest_teacher_help"}))
        with mock.patch.dict(os.environ, {"COACH_LESSON_PLANNING": "off"}):
            self.assertIsNone(coach_planning.lesson_tools(cue=True, focus_marks_on=True))

    def test_full_keeps_the_tools_but_not_pointing_while_marks_are_on(self):
        import importlib
        from app.agents.coach_tools import pointing_tools
        if not registry.is_registered_name("point_at_screen"):
            importlib.reload(pointing_tools)
        with mock.patch.dict(os.environ, {"COACH_LESSON_PLANNING": "full"}):
            # Another suite may have reset the registry to pointing alone —
            # then "nothing left to plan with" is None, which is also right.
            tools = coach_planning.lesson_tools(cue=False, focus_marks_on=True)
            self.assertNotIn("point_at_screen", tools or frozenset())
            self.assertIn("point_at_screen",
                          coach_planning.lesson_tools(cue=False, focus_marks_on=False))

    def test_dispatch_refuses_a_tool_outside_the_turns_allowlist(self):
        import importlib
        from app.agents.coach_tools import pointing_tools
        if not registry.is_registered_name("point_at_screen"):
            importlib.reload(pointing_tools)
        context = registry.CoachToolContext(
            learner_id="l", mode=CoachMode.LESSON, language="he", session_id="s",
            exchange_id="x", bundle={}, allowed_tools=frozenset({"suggest_teacher_help"}))
        result = asyncio.run(registry.dispatch("point_at_screen", {"region": "question"}, context))
        self.assertEqual(result["error"], "tool_not_allowed_for_turn")


# ── the stream: a mark before the first word, on every path ─────────────────

LESSON_BUNDLE = {"current": {**CURRENT, "informationToBot": "מסך על מסה",
                             "hint_ladder": {}}, "profile": {}, "portrait": {}, "locale": "he"}


def _drive(*, trigger=None, support_mode=None, user_message=None, pregen=None,
           pointer_version=2, plan_calls=None):
    """(streamed, pointer_requests, persisted) from one run_coach_stream pass,
    recording the pointer list's state at the FIRST yielded chunk."""
    persisted: dict = {}
    pointer_requests: list = []
    at_first_chunk: list = []

    async def fake_stream(messages, usage_context):
        yield "תשובה חיה."

    async def fake_bundle(*a, **k):
        return copy.deepcopy(LESSON_BUNDLE)

    async def fake_append_turn(*a, **k):
        persisted.update(k)

    def fake_pregen(kind, *a):
        text = (pregen or {}).get(kind)
        return {"text": text, "fingerprint": "f", "kind": kind} if text else None

    async def plan(messages, context, *a, **k):
        if plan_calls is not None:
            plan_calls.append(context.allowed_tools)
        return messages

    async def async_none(*a, **k):
        return None

    async def async_false(*a, **k):
        return False

    async def async_list(*a, **k):
        return []

    async def async_dict(*a, **k):
        return {}

    async def safe(*a, **k):
        return "safe"

    async def greeting(*a, **k):
        return "היי!"

    def passthrough(text, lang):
        return mock.Mock(text=text)

    async def run():
        chunks = []
        async for piece in coach.run_coach_stream(
            "test-learner", user_message=user_message, language="he", session_id="s1",
            trigger=trigger, support_mode=support_mode,
            surface_context={"screen": "learning_lesson", "component_id": "comp-1"},
            pointer_requests=pointer_requests, pointer_version=pointer_version,
        ):
            if not chunks:
                at_first_chunk.append(list(pointer_requests))
            chunks.append(piece)
        return "".join(chunks)

    from app.agents import tutor_decision

    catalog = {"objects": copy.deepcopy(V8_OBJECTS), "layout": {}}
    with mock.patch.object(coach, "_stream_coach_model", fake_stream), \
         mock.patch.object(coach, "build_coach_bundle", fake_bundle), \
         mock.patch.object(coach, "welcome_greeting", greeting), \
         mock.patch.object(coach, "_tool_calling_enabled", lambda: True), \
         mock.patch.object(coach, "_plan_coach_tools", plan), \
         mock.patch.object(coach.safety, "classify_disclosure", safe), \
         mock.patch.object(coach.safety, "screen_input", passthrough), \
         mock.patch.object(coach.safety, "screen_output", passthrough), \
         mock.patch.object(content_intelligence, "screen_objects", lambda *a: catalog), \
         mock.patch.object(content_intelligence, "pregen_text", fake_pregen), \
         mock.patch.object(content_intelligence, "arrival_question_id", lambda *a: "q1"), \
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
    return streamed, (at_first_chunk[0] if at_first_chunk else None), persisted


class TheMarkComesFirst(unittest.TestCase):
    def test_a_pregen_arrival_marks_the_question_before_its_text(self):
        streamed, first, persisted = _drive(
            trigger="question_intro", pregen={"question_intro": "שאלה מחכה לכם."})
        self.assertEqual(streamed, "שאלה מחכה לכם.")
        self.assertEqual(first[0]["object_id"], "stem:q1")
        self.assertEqual(persisted["assistant_meta"]["pointer"]["object_id"], "stem:q1")

    def test_live_nudges_support_and_typed_turns_mark_too(self):
        for kwargs, expected in (
            ({"trigger": "idle"}, "stem:q1"),
            ({"support_mode": "hint"}, "img:32fe1e32"),
            ({"user_message": "מה רואים בתמונה?"}, "img:32fe1e32"),
        ):
            _, first, persisted = _drive(**kwargs)
            self.assertEqual(first[0]["object_id"], expected, kwargs)
            self.assertEqual(persisted["assistant_meta"]["pointer"]["object_id"], expected)

    def test_the_welcome_is_unmarked(self):
        _, first, persisted = _drive(trigger="lesson_welcome")
        self.assertEqual(first, [])
        self.assertNotIn("pointer", persisted.get("assistant_meta") or {})

    def test_shadow_decides_but_sends_nothing(self):
        with mock.patch.dict(os.environ, {"COACH_FOCUS_MARKS_ENABLED": "shadow"}):
            _, first, _ = _drive(trigger="idle")
        self.assertEqual(first, [])

    def test_a_plain_lesson_turn_skips_the_planning_call(self):
        calls: list = []
        with mock.patch.dict(os.environ, {"COACH_LESSON_PLANNING": "gated"}):
            _drive(user_message="מה זה מסה?", plan_calls=calls)
            self.assertEqual(calls, [])
            _drive(user_message="אפשר לקרוא למורה?", plan_calls=calls)
        self.assertEqual(calls, [frozenset({"suggest_teacher_help"})])


class EveryRouteFlushesTheMarkFirst(unittest.TestCase):
    def _frames(self, endpoint, request):
        from app.routes import agent as routes

        async def fake_run(*args, **kwargs):
            kwargs["pointer_requests"].append({"region": "question", "breakpoints": [],
                                               "question_key": "c|i|q", "v": 2})
            yield "שלום."
            yield " עוד."

        async def collect():
            with mock.patch.object(routes, "run_coach_stream", fake_run), \
                 mock.patch.object(routes.lrs_reporter, "report_conversation_interacted",
                                   mock.AsyncMock()), \
                 mock.patch.object(routes.coach_debug_trace, "record", mock.AsyncMock()):
                response = await endpoint(request, session={"sub": "learner"})
                return [chunk async for chunk in response.body_iterator]

        frames = asyncio.run(collect())
        return [json.loads(f[6:]) for f in frames
                if f.startswith("data: {")]

    def test_proactive_sends_disclosure_then_pointer_then_text(self):
        from app.routes import agent as routes
        frames = self._frames(routes.coach_proactive, routes.CoachProactiveRequest(
            trigger="partial", pointer_version=2))
        keys = [next(iter(f)) for f in frames]
        self.assertEqual(keys[:3], ["disclosure", "pointer", "text"])
        self.assertEqual(keys.count("pointer"), 1)


if __name__ == "__main__":
    unittest.main()
