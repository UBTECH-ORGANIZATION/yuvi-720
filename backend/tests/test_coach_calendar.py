"""On-demand Coach calendar context: routing, privacy, and resilience."""

from __future__ import annotations

import asyncio
import copy
import json
import unittest
from datetime import date, datetime
from unittest import mock
from unittest.mock import AsyncMock, patch

from app.agents import coach, coach_calendar
from app.services.ai_usage import UsageContext
from app.services import student_calendar


def usage_context() -> UsageContext:
    return UsageContext(
        actor_id="learner-pseudonym",
        actor_type="learner",
        endpoint="/api/agent/coach/stream",
        feature="feature_3_learning_companion",
        operation="coach.calendar_intent",
        source="coach_agent",
        session_id="thread-1",
    )


class CalendarPeriodResolverTests(unittest.TestCase):
    def test_resolves_supported_periods_in_all_languages(self) -> None:
        self.assertEqual(coach_calendar.resolve_calendar_period("מה יש לי מחר?", "he"), "tomorrow")
        self.assertEqual(coach_calendar.resolve_calendar_period("ماذا لدي هذا الأسبوع؟", "ar"), "this_week")
        self.assertEqual(coach_calendar.resolve_calendar_period("What is next week?", "en"), "next_week")
        self.assertEqual(coach_calendar.resolve_calendar_period("מה ביומן שלי?", "he"), "today")
        self.assertEqual(coach_calendar.resolve_calendar_weekday("השבוע ביום חמישי", "he"), "thursday")

    def test_weekday_alone_means_its_next_occurrence(self) -> None:
        tuesday = datetime.fromisoformat("2026-08-18T12:00:00+03:00")
        thursday = datetime.fromisoformat("2026-08-20T12:00:00+03:00")
        friday = datetime.fromisoformat("2026-08-21T12:00:00+03:00")
        message = "אילו שיעורים יש לי בחמישי"
        self.assertEqual(coach_calendar.resolve_calendar_period(message, "he", now=tuesday), "this_week")
        self.assertEqual(coach_calendar.resolve_calendar_period(message, "he", now=thursday), "this_week")
        self.assertEqual(coach_calendar.resolve_calendar_period(message, "he", now=friday), "next_week")


class CalendarRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_clear_request_stays_on_deterministic_fast_path(self) -> None:
        classifier = AsyncMock()
        with patch.object(coach_calendar, "call_llm", classifier):
            route = await coach_calendar.resolve_calendar_route(
                "מה יש לי מחר?", "he", "calendar_query", [],
                usage_context=usage_context(),
            )
        self.assertEqual(route["period"], "tomorrow")
        self.assertEqual(route["source"], "deterministic")
        classifier.assert_not_awaited()

    async def test_initial_weekday_request_routes_to_nearest_weekday_without_model(self) -> None:
        classifier = AsyncMock()
        with patch.object(coach_calendar, "call_llm", classifier):
            route = await coach_calendar.resolve_calendar_route(
                "אילו שיעורים יש לי בחמישי", "he", "calendar_query", [],
                usage_context=usage_context(),
                now=datetime.fromisoformat("2026-08-18T12:00:00+03:00"),
            )
        self.assertEqual(route["period"], "this_week")
        self.assertEqual(route["weekday"], "thursday")
        classifier.assert_not_awaited()

    async def test_ambiguous_followup_uses_one_bounded_model_call(self) -> None:
        history = [{
            "role": "user", "content": "איזה שיעורים יש לי שבוע הבא?",
            "query_intent": "calendar_query", "calendar_period": "next_week",
            "calendar_route_source": "deterministic",
        }]
        classifier = AsyncMock(return_value=json.dumps({
            "intent": "calendar_query", "period": "this_week",
            "weekday": "thursday", "confidence": 0.97,
        }))
        with patch.object(coach_calendar, "call_llm", classifier):
            route = await coach_calendar.resolve_calendar_route(
                "והשבוע ביום חמישי?", "he", "learning_help", history,
                usage_context=usage_context(),
            )
        self.assertEqual(route["intent"], "calendar_query")
        self.assertEqual(route["period"], "this_week")
        self.assertEqual(route["weekday"], "thursday")
        self.assertEqual(route["source"], "llm_followup")
        classifier.assert_awaited_once()
        self.assertEqual(classifier.await_args.kwargs["model_tier"], "mini")
        self.assertTrue(classifier.await_args.kwargs["json_mode"])

    async def test_validated_followup_chain_reuses_session_without_model(self) -> None:
        history = [{
            "role": "user", "content": "והשבוע ביום חמישי?",
            "query_intent": "calendar_query", "calendar_period": "this_week",
            "calendar_weekday": "thursday", "calendar_route_source": "llm_followup",
        }]
        classifier = AsyncMock()
        with patch.object(coach_calendar, "call_llm", classifier):
            route = await coach_calendar.resolve_calendar_route(
                "וביום שישי?", "he", "learning_help", history,
                usage_context=usage_context(),
            )
        self.assertEqual(route["period"], "this_week")
        self.assertEqual(route["weekday"], "friday")
        self.assertEqual(route["source"], "session_followup")
        classifier.assert_not_awaited()

    async def test_low_confidence_requests_clarification(self) -> None:
        history = [{
            "role": "user", "content": "מה יש לי השבוע?",
            "query_intent": "calendar_query", "calendar_period": "this_week",
        }]
        classifier = AsyncMock(return_value=json.dumps({
            "intent": "unclear", "period": "unchanged",
            "weekday": None, "confidence": 0.42,
        }))
        with patch.object(coach_calendar, "call_llm", classifier):
            route = await coach_calendar.resolve_calendar_route(
                "ומה אז?", "he", "learning_help", history,
                usage_context=usage_context(),
            )
        self.assertEqual(route["intent"], "calendar_clarification")


class CalendarContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_payload_is_bounded_and_excludes_internal_fields(self) -> None:
        source_items = [
            student_calendar.CalendarItem(
                id=f"lesson:{index}",
                kind="lesson",
                title="Math child@example.com",
                subject="mathematics",
                teacher_name="Private Teacher",
                start_at=f"2026-08-23T{index % 24:02d}:00:00+00:00",
                all_day=False,
                status="upcoming",
                action_route=f"/private/{index}",
            )
            for index in range(35)
        ]
        projection = student_calendar.CalendarPeriod(
            period="next_week",
            start_date=date(2026, 8, 23),
            end_date=date(2026, 8, 29),
            items=source_items,
        )
        get_period = AsyncMock(return_value=projection)
        with patch.object(coach_calendar.student_calendar, "get_period", get_period):
            result = await coach_calendar.load_calendar_context("learner-session-id", "next_week")

        get_period.assert_awaited_once_with("learner-session-id", "next_week", now=None)
        self.assertEqual(result["status"], "available")
        self.assertEqual(len(result["items"]), coach_calendar.MAX_CONTEXT_ITEMS)
        self.assertEqual(result["total_count"], 35)
        self.assertTrue(result["has_more"])
        serialized = str(result)
        self.assertNotIn("child@example.com", serialized)
        self.assertNotIn("Private Teacher", serialized)
        self.assertNotIn("action_route", serialized)
        self.assertNotIn("lesson:0", serialized)
        self.assertNotIn("/private/", serialized)
        self.assertEqual(result["items"][0]["start_at"], "2026-08-23T03:00:00+03:00")

    async def test_empty_and_unavailable_are_distinct(self) -> None:
        empty = student_calendar.CalendarPeriod(
            period="today",
            start_date=date(2026, 8, 18),
            end_date=date(2026, 8, 18),
            items=[],
        )
        with patch.object(
            coach_calendar.student_calendar, "get_period", AsyncMock(return_value=empty),
        ):
            available = await coach_calendar.load_calendar_context("kid-a", "today")
        with patch.object(
            coach_calendar.student_calendar, "get_period", AsyncMock(side_effect=RuntimeError("secret")),
        ):
            unavailable = await coach_calendar.load_calendar_context("kid-a", "today")

        self.assertEqual(available["status"], "available")
        self.assertEqual(unavailable["status"], "unavailable")
        self.assertIn("לא מצאתי", coach_calendar.calendar_fallback(available, "he"))
        self.assertIn("לא הצלחתי", coach_calendar.calendar_fallback(unavailable, "he"))

    async def test_weekday_filter_is_applied_before_model_context(self) -> None:
        projection = student_calendar.CalendarPeriod(
            period="this_week",
            start_date=date(2026, 8, 16),
            end_date=date(2026, 8, 22),
            items=[
                student_calendar.CalendarItem(
                    id="thu", kind="lesson", title="History",
                    start_at="2026-08-20T12:00:00+03:00", all_day=False, status="upcoming",
                ),
                student_calendar.CalendarItem(
                    id="fri", kind="lesson", title="Sports",
                    start_at="2026-08-21T11:00:00+03:00", all_day=False, status="upcoming",
                ),
            ],
        )
        with patch.object(
            coach_calendar.student_calendar, "get_period", AsyncMock(return_value=projection),
        ):
            result = await coach_calendar.load_calendar_context(
                "kid-a", "this_week", "thursday",
            )
        self.assertEqual([item["title"] for item in result["items"]], ["History"])
        self.assertEqual(result["weekday"], "thursday")


class CoachCalendarIntegrationTests(unittest.TestCase):
    _BUNDLE = {
        "current": {"question": {}, "recent_events": [], "hint_ladder": {}},
        "profile": {},
        "portrait": {},
        "locale": "he",
    }

    def _run(
        self,
        intent: str,
        calendar_context: dict[str, object] | None = None,
        model_text: str = "בדקתי את היומן שלך.",
    ):
        captured_messages: list[dict[str, str]] = []
        load_context = AsyncMock(return_value=calendar_context or {})
        append_turn = AsyncMock()
        action_offers: list[dict[str, object]] = []
        debug_trace: list[dict[str, str]] = []

        async def fake_stream(messages, _usage_context):
            captured_messages.extend(messages)
            if model_text:
                yield model_text

        async def collect():
            chunks = []
            async for chunk in coach.run_coach_stream(
                "session-learner",
                user_message="מה יש לי מחר?" if intent == "calendar_query" else "תסביר לי שברים",
                language="he",
                session_id="thread-1",
                action_offers=action_offers,
                debug_trace=debug_trace,
            ):
                chunks.append(chunk)
            return "".join(chunks)

        passthrough = lambda text, _lang: mock.Mock(text=text)
        from app.agents import tutor_decision

        with patch.object(coach, "_stream_coach_model", fake_stream), \
             patch.object(coach, "build_coach_bundle", AsyncMock(return_value=copy.deepcopy(self._BUNDLE))), \
             patch.object(coach, "classify_query_intent", return_value=intent), \
             patch.object(coach.safety, "classify_disclosure", AsyncMock(return_value="safe")), \
             patch.object(coach.safety, "screen_input", side_effect=passthrough), \
             patch.object(coach.safety, "screen_output", side_effect=passthrough), \
             patch.object(coach.sessions, "conversation_needs_title", AsyncMock(return_value=False)), \
             patch.object(coach.sessions, "get_recent", AsyncMock(return_value=[])), \
             patch.object(coach.sessions, "get_conversation_memory", AsyncMock(return_value={})), \
             patch.object(coach.sessions, "append_turn", append_turn), \
             patch.object(coach_calendar, "load_calendar_context", load_context), \
             patch.object(tutor_decision, "log_decision", AsyncMock()), \
             patch.object(tutor_decision, "record_hint_level", AsyncMock()), \
             patch("app.brain.consolidator.capture_and_consolidate", AsyncMock(return_value=[])):
            output = asyncio.run(collect())
        return output, captured_messages, load_context, append_turn, action_offers, debug_trace

    def test_calendar_turn_reads_once_and_renders_ephemeral_context(self) -> None:
        context = {
            "status": "available",
            "period": "tomorrow",
            "timezone": "Asia/Jerusalem",
            "start_date": "2026-08-19",
            "end_date": "2026-08-19",
            "items": [{
                "kind": "lesson", "title": "מתמטיקה", "subject": "math",
                "start_at": "2026-08-19T09:00:00+03:00", "end_at": None,
                "all_day": False, "status": "upcoming",
            }],
            "total_count": 1,
            "has_more": False,
        }
        output, messages, load_context, append_turn, _actions, trace = self._run("calendar_query", context)

        load_context.assert_awaited_once_with("session-learner", "tomorrow", None)
        rendered = "\n".join(message["content"] for message in messages)
        self.assertIn("calendar_context_status: available", rendered)
        self.assertIn("title=מתמטיקה", rendered)
        self.assertIn("2026-08-19T09:00:00+03:00", rendered)
        self.assertIn("בדקתי", output)
        self.assertEqual(append_turn.await_args.kwargs["query_intent"], "calendar_query")
        self.assertEqual(append_turn.await_args.kwargs["calendar_period"], "tomorrow")
        self.assertEqual(append_turn.await_args.kwargs["calendar_route_source"], "deterministic")
        self.assertIn({"name": "load_calendar_context", "status": "ok", "source": "system"}, trace)

    def test_empty_calendar_turn_attaches_calendar_action(self) -> None:
        _output, _messages, _load_context, _append_turn, actions, _trace = self._run(
            "calendar_query", {"status": "available", "items": []},
        )

        self.assertEqual([action["action_id"] for action in actions], ["open_calendar"])

    def test_learning_turn_does_not_read_calendar(self) -> None:
        _output, messages, load_context, _append_turn, _actions, _trace = self._run("learning_help")

        load_context.assert_not_awaited()
        rendered = "\n".join(message["content"] for message in messages)
        self.assertNotIn("calendar_context_", rendered)

    def test_calendar_fallback_works_when_model_returns_no_text(self) -> None:
        context = {
            "status": "available",
            "period": "tomorrow",
            "timezone": "Asia/Jerusalem",
            "start_date": "2026-08-19",
            "end_date": "2026-08-19",
            "items": [{
                "kind": "lesson", "title": "מתמטיקה", "subject": "math",
                "start_at": "2026-08-19T09:00:00+03:00", "end_at": None,
                "all_day": False, "status": "upcoming",
            }],
            "total_count": 1,
            "has_more": False,
        }
        output, _messages, _load_context, _append_turn, _actions, _trace = self._run(
            "calendar_query", context, model_text="",
        )

        self.assertIn("שיעור: מתמטיקה", output)
        self.assertIn("2026-08-19 09:00", output)

    def test_clarification_route_skips_main_response_model(self) -> None:
        model_stream = mock.Mock()

        async def collect():
            chunks = []
            async for chunk in coach.run_coach_stream(
                "session-learner", user_message="ומה אז?", language="he", session_id="thread-1",
            ):
                chunks.append(chunk)
            return "".join(chunks)

        passthrough = lambda text, _lang: mock.Mock(text=text)
        from app.agents import tutor_decision

        with patch.object(coach, "_stream_coach_model", model_stream), \
             patch.object(coach, "build_coach_bundle", AsyncMock(return_value=copy.deepcopy(self._BUNDLE))), \
             patch.object(coach, "classify_query_intent", return_value="learning_help"), \
             patch.object(coach_calendar, "resolve_calendar_route", AsyncMock(return_value={
                 "intent": "calendar_clarification", "source": "llm_followup", "confidence": 0.4,
             })), \
             patch.object(coach.safety, "classify_disclosure", AsyncMock(return_value="safe")), \
             patch.object(coach.safety, "screen_input", side_effect=passthrough), \
             patch.object(coach.safety, "screen_output", side_effect=passthrough), \
             patch.object(coach.sessions, "conversation_needs_title", AsyncMock(return_value=False)), \
             patch.object(coach.sessions, "get_recent", AsyncMock(return_value=[])), \
             patch.object(coach.sessions, "get_conversation_memory", AsyncMock(return_value={})), \
             patch.object(coach.sessions, "append_turn", AsyncMock()), \
             patch.object(tutor_decision, "log_decision", AsyncMock()), \
             patch.object(tutor_decision, "record_hint_level", AsyncMock()), \
             patch("app.brain.consolidator.capture_and_consolidate", AsyncMock(return_value=[])):
            output = asyncio.run(collect())

        self.assertIn("לא הייתי בטוח", output)
        model_stream.assert_not_called()

    def test_query_intent_classifies_tasks_and_dashboard(self) -> None:
        self.assertEqual(coach.classify_query_intent("אילו משימות יש לי?", "he"), "task_query")
        self.assertEqual(coach.classify_query_intent("איך ההתקדמות שלי?", "he"), "dashboard_query")
        self.assertEqual(coach.classify_query_intent("מה יש לי בערב?", "he"), "calendar_query")
        self.assertEqual(
            coach.classify_query_intent("אני רוצה לקבוע שיעור למחר", "he"),
            "calendar_action_request",
        )


if __name__ == "__main__":
    unittest.main()