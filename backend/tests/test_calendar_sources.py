"""Read-only #241/#242 calendar sources: targeting, recurrence and exceptions."""

from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import calendar_events, timetable


class TargetedEventsTest(unittest.IsolatedAsyncioTestCase):
    async def test_event_targets_are_resolved_live_and_other_learner_is_excluded(self):
        events = [{
            "_id": "event-1", "creator_id": "teacher-1", "title": "Class day",
            "all_day": True, "date": "2026-08-18", "active": True,
            "targets": [{"kind": "subgroup", "id": "sg-1"}],
        }]
        with patch.object(calendar_events, "_read_events", AsyncMock(return_value=events)), \
             patch.object(calendar_events.assign, "resolve_one",
                         AsyncMock(return_value=["kid-a"])) as resolving, \
               patch.object(calendar_events.org, "list_schools", AsyncMock(return_value=[])):
            own = await calendar_events.list_for_learner(
                "kid-a", date(2026, 8, 16), date(2026, 8, 22),
            )
            other = await calendar_events.list_for_learner(
                "kid-b", date(2026, 8, 16), date(2026, 8, 22),
            )
        self.assertEqual([row["id"] for row in own], ["event-1"])
        self.assertEqual(other, [])
        self.assertEqual(resolving.await_args_list[0].args, (
            "teacher-1", {"kind": "subgroup", "id": "sg-1"},
        ))

    async def test_learner_subgroup_and_group_targets_share_the_assignment_resolver(self):
        events = [{
            "_id": f"event-{kind}", "creator_id": "teacher-1", "title": kind,
            "all_day": True, "date": "2026-08-18", "active": True,
            "targets": [{"kind": kind, "id": f"{kind}-1"}],
        } for kind in ("learner", "subgroup", "group")]
        resolving = AsyncMock(return_value=["kid-a"])
        with patch.object(calendar_events, "_read_events", AsyncMock(return_value=events)), \
             patch.object(calendar_events.assign, "resolve_one", resolving), \
             patch.object(calendar_events.org, "list_schools", AsyncMock(return_value=[])):
            rows = await calendar_events.list_for_learner(
                "kid-a", date(2026, 8, 16), date(2026, 8, 22),
            )
        self.assertEqual(len(rows), 3)
        self.assertEqual(
            [call.args[1]["kind"] for call in resolving.await_args_list],
            ["learner", "subgroup", "group"],
        )

    def test_timed_event_is_filtered_by_school_local_date(self):
        self.assertEqual(
            calendar_events._event_date("2026-08-16T22:30:00Z", "Asia/Jerusalem"),
            date(2026, 8, 17),
        )

    async def test_legacy_personal_event_is_visible_only_to_its_owner(self):
        events = [{
            "_id": "legacy-1", "event_id": "legacy-1", "owner_id": "kid-a",
            "title": "Personal", "date": "2026-08-18", "time": "09:30",
        }]
        with patch.object(calendar_events, "_read_events", AsyncMock(return_value=events)), \
             patch.object(calendar_events.org, "list_schools", AsyncMock(return_value=[])):
            own = await calendar_events.list_for_learner(
                "kid-a", date(2026, 8, 16), date(2026, 8, 22),
            )
            other = await calendar_events.list_for_learner(
                "kid-b", date(2026, 8, 16), date(2026, 8, 22),
            )
        self.assertEqual([row["id"] for row in own], ["legacy-1"])
        self.assertEqual(other, [])


class TimetableExpansionTest(unittest.TestCase):
    def _slot(self, **changes):
        return {
            "_id": "slot-1", "group_id": "g1", "school_id": "school-1",
            "subject": "Math", "weekday": 0, "start_time": "09:00",
            "end_time": "09:45", "valid_from": "2026-01-01",
            "valid_to": "2026-12-31", **changes,
        }

    def test_expands_sunday_wall_clock_and_crosses_dst_without_moving_local_time(self):
        rows = timetable.expand_slots(
            [self._slot()], [], [], date(2026, 3, 22), date(2026, 3, 29),
            zone_name_by_school={"school-1": "Asia/Jerusalem"},
        )
        self.assertEqual([row["id"] for row in rows], [
            "slot-1:2026-03-22", "slot-1:2026-03-29",
        ])
        self.assertTrue(rows[0]["start_at"].endswith("07:00:00+00:00"))
        self.assertTrue(rows[1]["start_at"].endswith("06:00:00+00:00"))

    def test_holiday_and_half_day_suppress_only_the_lesson_occurrence(self):
        rows = timetable.expand_slots(
            [self._slot(), self._slot(_id="slot-early", start_time="08:00", end_time="08:40")],
            [], [{
                "school_id": "school-1", "date": "2026-08-16",
                "kind": "half_day", "closed_from": "08:30",
            }], date(2026, 8, 16), date(2026, 8, 16),
        )
        self.assertEqual([row["id"] for row in rows], ["slot-early:2026-08-16"])

    def test_cancelled_stays_visible_and_substitution_changes_subject(self):
        slots = [self._slot(), self._slot(_id="slot-2")]
        exceptions = [
            {"occurrence_id": "slot-1:2026-08-16", "kind": "cancelled"},
            {"occurrence_id": "slot-2:2026-08-16", "kind": "substituted",
             "subject": "Science", "teacher_name": "Dana"},
        ]
        rows = timetable.expand_slots(
            slots, exceptions, [], date(2026, 8, 16), date(2026, 8, 16),
        )
        self.assertEqual(rows[0]["status"], "cancelled")
        self.assertEqual(rows[1]["subject"], "Science")
        self.assertEqual(rows[1]["teacher_name"], "Dana")

    def test_moved_lesson_landing_on_holiday_is_suppressed(self):
        rows = timetable.expand_slots(
            [self._slot()], [{
                "occurrence_id": "slot-1:2026-08-16", "kind": "moved",
                "date": "2026-08-17", "start_time": "10:00", "end_time": "10:45",
            }], [{
                "school_id": "school-1", "date": "2026-08-17", "kind": "holiday",
            }], date(2026, 8, 16), date(2026, 8, 17),
        )
        self.assertEqual(rows, [])


class LearnerTimetableScopeTest(unittest.IsolatedAsyncioTestCase):
    async def _rows_for(self, learner_id: str, *, exceptions=None):
        collections = {
            timetable.SLOTS: [{
                "_id": "slot-1", "group_id": "g1", "school_id": "school-1",
                "subgroup_id": "sg-1", "subject": "Math", "weekday": 0,
                "start_time": "09:00", "end_time": "09:45",
                "valid_from": "2026-01-01", "valid_to": "2026-12-31",
            }],
            timetable.EXCEPTIONS: exceptions or [], timetable.SCHOOL_DAYS: [],
        }
        with patch.object(timetable.org, "groups_for_learner", AsyncMock(return_value=["g1"])), \
             patch.object(timetable, "_read_collection",
                          AsyncMock(side_effect=lambda name: collections[name])), \
             patch.object(timetable.org_repository, "get_subgroup", AsyncMock(return_value={
                 "_id": "sg-1", "group_id": "g1", "learner_ids": ["kid-a"], "active": True,
             })), \
             patch.object(timetable.org, "list_schools", AsyncMock(return_value=[{
                 "_id": "school-1", "timezone": "Asia/Jerusalem",
             }])):
            return await timetable.list_for_learner(
                learner_id, date(2026, 8, 16), date(2026, 8, 22),
            )

    async def test_subgroup_member_sees_lesson_and_classmate_does_not(self):
        self.assertEqual(len(await self._rows_for("kid-a")), 1)
        self.assertEqual(await self._rows_for("kid-b"), [])

    async def test_lesson_moved_into_range_appears_on_its_final_date(self):
        rows = await self._rows_for("kid-a", exceptions=[{
            "occurrence_id": "slot-1:2026-07-05", "kind": "moved",
            "date": "2026-08-18", "start_time": "10:00", "end_time": "10:45",
        }])
        self.assertIn("2026-08-18", [row["local_date"] for row in rows])


if __name__ == "__main__":
    unittest.main()