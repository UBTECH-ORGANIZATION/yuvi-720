"""Student calendar aggregation, date rules, and session ownership."""

from __future__ import annotations

import json
import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.dependencies import require_learner_session
from app.routes import student_calendar as routes
from app.services import student_calendar


NOW = datetime.fromisoformat("2026-08-17T12:00:00+03:00")


class CalendarProjectionTest(unittest.IsolatedAsyncioTestCase):
    async def _upcoming(self, tasks=None, goals=None, meetings=None, limit=3):
        with patch.object(
            student_calendar.learner_tasks,
            "list_for_learner",
            AsyncMock(return_value=tasks or []),
        ), patch.object(
            student_calendar,
            "get_brain",
            AsyncMock(return_value={"goals": goals or []}),
        ), patch.object(
            student_calendar.mentoring,
            "list_conversations",
            AsyncMock(return_value=meetings or []),
        ), patch.object(
            student_calendar.calendar_events,
            "list_for_learner",
            AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.timetable,
            "list_for_learner",
            AsyncMock(return_value=[]),
        ):
            return await student_calendar.get_upcoming("kid-a", limit=limit, now=NOW)

    async def test_today_all_day_is_not_overdue(self):
        result = await self._upcoming(goals=[{
            "id": "g-today", "text": "Read", "deadline": "2026-08-17",
            "status": "open", "visible_to_learner": True,
        }])
        self.assertEqual(result.items[0].status, "upcoming")
        self.assertEqual(result.items[0].proximity, "today")

    async def test_upcoming_contains_only_today_and_is_capped(self):
        result = await self._upcoming(goals=[
            {"id": "old-1", "text": "Old one", "deadline": "2026-08-10", "status": "open"},
            {"id": "today-1", "text": "Today one", "deadline": "2026-08-17", "status": "open"},
            {"id": "today-2", "text": "Today two", "deadline": "2026-08-17", "status": "open"},
            {"id": "today-3", "text": "Today three", "deadline": "2026-08-17", "status": "open"},
            {"id": "today-4", "text": "Today four", "deadline": "2026-08-17", "status": "open"},
            {"id": "tomorrow", "text": "Tomorrow", "deadline": "2026-08-18", "status": "open"},
            {"id": "week", "text": "Week", "deadline": "2026-08-20", "status": "open"},
        ])
        self.assertEqual(len(result.items), 3)
        self.assertEqual([item.id for item in result.items], [
            "goal:today-1", "goal:today-2", "goal:today-3",
        ])
        self.assertTrue(result.has_more)

    async def test_upcoming_is_empty_when_only_later_week_items_exist(self):
        result = await self._upcoming(goals=[
            {"id": "tomorrow", "text": "Tomorrow", "deadline": "2026-08-18", "status": "open"},
            {"id": "week", "text": "Week", "deadline": "2026-08-20", "status": "open"},
        ])
        self.assertEqual(result.items, [])
        self.assertFalse(result.has_more)

    async def test_upcoming_can_return_more_than_three_for_the_scroller(self):
        result = await self._upcoming(goals=[
            {"id": f"today-{index}", "text": f"Today {index}",
             "deadline": "2026-08-17", "status": "open"}
            for index in range(5)
        ], limit=30)
        self.assertEqual(len(result.items), 5)
        self.assertFalse(result.has_more)

    async def test_week_is_sunday_through_saturday_and_keeps_completed_history(self):
        with patch.object(
            student_calendar.learner_tasks,
            "list_for_learner",
            AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar,
            "get_brain",
            AsyncMock(return_value={"goals": []}),
        ), patch.object(
            student_calendar.mentoring,
            "list_conversations",
            AsyncMock(return_value=[
                {"id": "m1", "date": "2026-08-16", "meeting_stage": "Start"},
                {"id": "m2", "date": "2026-08-22", "meeting_stage": "End"},
                {"id": "m3", "date": "2026-08-23", "meeting_stage": "Next"},
            ]),
        ), patch.object(
            student_calendar.calendar_events,
            "list_for_learner",
            AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.timetable,
            "list_for_learner",
            AsyncMock(return_value=[]),
        ):
            result = await student_calendar.get_week(
                "kid-a", date(2026, 8, 19), now=NOW,
            )
        self.assertEqual(result.week_start, date(2026, 8, 16))
        self.assertEqual(result.week_end, date(2026, 8, 22))
        self.assertEqual([item.id for item in result.items], ["meeting:m1", "meeting:m2"])
        self.assertTrue(all(item.status == "completed" for item in result.items))

    async def test_week_merges_targeted_events_and_timetable_occurrences(self):
        with patch.object(
            student_calendar.learner_tasks, "list_for_learner",
            AsyncMock(return_value=[{
                "task_id": "t1", "launch_id": "t1:1", "title": "Homework",
                "due_at": "2026-08-19", "status": "not_started", "closed": False,
            }]),
        ), patch.object(
            student_calendar, "get_brain", AsyncMock(return_value={"goals": []}),
        ), patch.object(
            student_calendar.mentoring, "list_conversations", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.calendar_events, "list_for_learner",
            AsyncMock(return_value=[{
                "id": "e1", "kind": "event", "title": "Class day",
                "start_at": "2026-08-18", "all_day": True, "status": "upcoming",
            }]),
        ) as events, patch.object(
            student_calendar.timetable, "list_for_learner",
            AsyncMock(return_value=[{
                "id": "slot-1:2026-08-19", "kind": "lesson", "title": "Math",
                "subject": "math", "start_at": "2026-08-19T06:00:00+00:00",
                "end_at": "2026-08-19T06:45:00+00:00", "all_day": False,
                "status": "cancelled",
            }]),
        ) as lessons:
            result = await student_calendar.get_week(
                "kid-a", date(2026, 8, 17), now=NOW,
            )
        self.assertEqual([item.id for item in result.items], [
            "event:e1", "task:t1:1", "lesson:slot-1:2026-08-19",
        ])
        self.assertEqual(result.items[1].status, "upcoming")
        self.assertEqual(result.items[2].status, "cancelled")
        events.assert_awaited_once_with("kid-a", date(2026, 8, 16), date(2026, 8, 22))
        lessons.assert_awaited_once_with("kid-a", date(2026, 8, 16), date(2026, 8, 22))

    async def test_period_selects_today_and_tomorrow_in_israel_time(self):
        goals = [
            {"id": "today", "text": "Today", "deadline": "2026-08-17", "status": "open"},
            {"id": "tomorrow", "text": "Tomorrow", "deadline": "2026-08-18", "status": "open"},
        ]
        with patch.object(
            student_calendar.learner_tasks, "list_for_learner", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar, "get_brain", AsyncMock(return_value={"goals": goals}),
        ), patch.object(
            student_calendar.mentoring, "list_conversations", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.calendar_events, "list_for_learner", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.timetable, "list_for_learner", AsyncMock(return_value=[]),
        ):
            today = await student_calendar.get_period("kid-a", "today", now=NOW)
            tomorrow = await student_calendar.get_period("kid-a", "tomorrow", now=NOW)

        self.assertEqual((today.start_date, today.end_date), (date(2026, 8, 17),) * 2)
        self.assertEqual([item.id for item in today.items], ["goal:today"])
        self.assertEqual((tomorrow.start_date, tomorrow.end_date), (date(2026, 8, 18),) * 2)
        self.assertEqual([item.id for item in tomorrow.items], ["goal:tomorrow"])

    async def test_next_week_is_next_sunday_through_saturday(self):
        events = AsyncMock(return_value=[
            {"id": "next", "kind": "event", "title": "Next week",
             "start_at": "2026-08-23", "status": "upcoming"},
        ])
        lessons = AsyncMock(return_value=[])
        with patch.object(
            student_calendar.learner_tasks, "list_for_learner", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar, "get_brain", AsyncMock(return_value={"goals": []}),
        ), patch.object(
            student_calendar.mentoring, "list_conversations", AsyncMock(return_value=[]),
        ), patch.object(
            student_calendar.calendar_events, "list_for_learner", events,
        ), patch.object(
            student_calendar.timetable, "list_for_learner", lessons,
        ):
            result = await student_calendar.get_period("kid-a", "next_week", now=NOW)

        self.assertEqual(result.start_date, date(2026, 8, 23))
        self.assertEqual(result.end_date, date(2026, 8, 29))
        self.assertEqual([item.id for item in result.items], ["event:next"])
        events.assert_awaited_once_with("kid-a", date(2026, 8, 23), date(2026, 8, 29))
        lessons.assert_awaited_once_with("kid-a", date(2026, 8, 23), date(2026, 8, 29))

    async def test_reminders_include_only_unfinished_tasks_and_goals_due_today_or_tomorrow(self):
        notify = AsyncMock(side_effect=[{"_id": "first"}, {"_id": "second"}])
        with patch.object(
            student_calendar.learner_tasks,
            "list_for_learner",
            AsyncMock(return_value=[{
                "task_id": "t1", "launch_id": "t1:1", "title": "Task",
                "due_at": "2026-08-17", "status": "not_started", "closed": False,
            }]),
        ), patch.object(
            student_calendar,
            "get_brain",
            AsyncMock(return_value={"goals": [
                {"id": "g1", "text": "Goal", "deadline": "2026-08-18", "status": "open"},
                {"id": "g2", "text": "Done", "deadline": "2026-08-17", "status": "done"},
                {"id": "g3", "text": "Later", "deadline": "2026-08-19", "status": "open"},
            ]}),
        ), patch.object(
            student_calendar.mentoring,
            "list_conversations",
            AsyncMock(return_value=[{"id": "m1", "date": "2026-08-17"}]),
        ), patch("app.services.notifications.notify", notify):
            created = await student_calendar.reconcile_due_reminders("kid-a", now=NOW)
        self.assertEqual(created, 2)
        self.assertEqual([call.kwargs["title_key"] for call in notify.await_args_list], [
            "notif.deadline.today", "notif.deadline.tomorrow",
        ])
        self.assertTrue(all(call.args[0] == "kid-a" for call in notify.await_args_list))
        self.assertTrue(all(call.kwargs["notification_id"].startswith("deadline_reminder:")
                            for call in notify.await_args_list))


class CalendarRouteScopingTest(unittest.TestCase):
    def test_query_learner_id_is_ignored_in_favour_of_session(self):
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[require_learner_session] = lambda: {
            "sub": "kid-a", "roles": ["learner"],
        }
        expected = student_calendar.CalendarWeek(
            week_start=date(2026, 8, 16), week_end=date(2026, 8, 22), items=[],
        )
        with patch.object(
            routes.student_calendar,
            "get_week",
            AsyncMock(return_value=expected),
        ) as get_week:
            response = TestClient(app).get(
                "/api/calendar?week=2026-08-17&learner_id=kid-b",
            )
        self.assertEqual(response.status_code, 200)
        get_week.assert_awaited_once_with("kid-a", date(2026, 8, 17))
        self.assertNotIn("kid-b", json.dumps(response.json()))
        self.assertEqual(response.headers["cache-control"], "private, no-store")

    def test_upcoming_route_allows_scroller_limit(self):
        app = FastAPI()
        app.include_router(routes.router)
        app.dependency_overrides[require_learner_session] = lambda: {
            "sub": "kid-a", "roles": ["learner"],
        }
        expected = student_calendar.CalendarUpcoming(items=[], has_more=False)
        with patch.object(
            routes.student_calendar,
            "get_upcoming",
            AsyncMock(return_value=expected),
        ) as get_upcoming:
            response = TestClient(app).get("/api/calendar/upcoming?limit=30")
        self.assertEqual(response.status_code, 200)
        get_upcoming.assert_awaited_once_with("kid-a", 30)


if __name__ == "__main__":
    unittest.main()