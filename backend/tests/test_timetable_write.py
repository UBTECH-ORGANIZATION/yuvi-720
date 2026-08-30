"""#242 write side: validated rules, natural-key exceptions, editable days off,
and the teacher expansion that feeds the class calendar."""

from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import school_calendar, timetable


class BuildSlotTest(unittest.TestCase):
    BASE = {"subject": "מתמטיקה", "weekday": 0, "start_time": "09:00",
            "end_time": "09:45", "valid_from": "2026-09-01"}

    def _build(self, **over):
        return timetable.build_slot({**self.BASE, **over},
                                    group_id="g1", school_id="s1", teacher_id="t1")

    def test_a_valid_rule_is_a_rule_not_events(self):
        slot = self._build(room="חדר 3", valid_to="2027-06-30")
        self.assertEqual(slot["weekday"], 0)
        self.assertEqual(slot["start_time"], "09:00")
        self.assertEqual(slot["group_id"], "g1")
        self.assertEqual(slot["school_id"], "s1")
        self.assertTrue(slot["active"])
        # A rule carries no dated occurrences — expansion is read-side only.
        self.assertNotIn("occurrences", slot)

    def test_every_broken_field_refuses_with_its_own_code(self):
        cases = [
            ({"subject": " "}, "subject_required"),
            ({"weekday": 7}, "bad_weekday"),
            ({"weekday": "sunday"}, "bad_weekday"),
            ({"start_time": "9 בבוקר"}, "bad_start"),
            ({"end_time": "08:00"}, "end_before_start"),
            ({"valid_from": "מחר"}, "bad_valid_from"),
            ({"valid_to": "2026-08-01"}, "valid_to_before_from"),
        ]
        for over, code in cases:
            with self.subTest(code=code):
                with self.assertRaises(timetable.TimetableError) as caught:
                    self._build(**over)
                self.assertEqual(str(caught.exception), code)


class BuildExceptionTest(unittest.TestCase):
    SLOT = {"_id": "tts-1", "group_id": "g1"}

    def test_a_cancellation_needs_nothing_but_its_date(self):
        exception = timetable.build_exception(
            self.SLOT, "2026-09-06", {"kind": "cancelled"}, teacher_id="t1")
        self.assertEqual(exception["kind"], "cancelled")
        # The natural key: a second edit of the same occurrence replaces the
        # first instead of stacking overrides.
        self.assertEqual(exception["_id"], "tts-1:2026-09-06")
        self.assertEqual(exception["occurrence_id"], "tts-1:2026-09-06")

    def test_a_move_with_no_target_is_refused(self):
        with self.assertRaises(timetable.TimetableError) as caught:
            timetable.build_exception(
                self.SLOT, "2026-09-06", {"kind": "moved"}, teacher_id="t1")
        self.assertEqual(str(caught.exception), "move_needs_target")

    def test_a_move_can_change_the_day_the_hours_or_both(self):
        by_day = timetable.build_exception(
            self.SLOT, "2026-09-06", {"kind": "moved", "date": "2026-09-08"},
            teacher_id="t1")
        self.assertEqual(by_day["date"], "2026-09-08")
        by_time = timetable.build_exception(
            self.SLOT, "2026-09-06",
            {"kind": "moved", "start_time": "11:00", "end_time": "11:45"},
            teacher_id="t1")
        self.assertEqual(by_time["start_time"], "11:00")

    def test_moved_hours_still_have_to_make_sense(self):
        with self.assertRaises(timetable.TimetableError):
            timetable.build_exception(
                self.SLOT, "2026-09-06",
                {"kind": "moved", "start_time": "11:00", "end_time": "10:00"},
                teacher_id="t1")


class BuildSchoolDayTest(unittest.TestCase):
    def test_a_holiday_is_a_dated_labelled_row(self):
        row = timetable.build_school_day(
            {"date": "2026-09-23", "kind": "holiday", "label": "יום כיפור"},
            school_id="s1", teacher_id="t1")
        self.assertEqual(row["_id"], "s1:2026-09-23")
        self.assertEqual(row["kind"], "holiday")

    def test_a_label_is_required_a_bare_date_says_nothing(self):
        with self.assertRaises(timetable.TimetableError) as caught:
            timetable.build_school_day(
                {"date": "2026-09-23", "kind": "holiday", "label": ""},
                school_id="s1", teacher_id="t1")
        self.assertEqual(str(caught.exception), "label_required")

    def test_a_half_day_says_when_it_closes(self):
        with self.assertRaises(timetable.TimetableError):
            timetable.build_school_day(
                {"date": "2026-09-22", "kind": "half_day", "label": "ערב חג"},
                school_id="s1", teacher_id="t1")
        row = timetable.build_school_day(
            {"date": "2026-09-22", "kind": "half_day", "label": "ערב חג",
             "closed_from": "12:00"},
            school_id="s1", teacher_id="t1")
        self.assertEqual(row["closed_from"], "12:00")


def _slot(**over):
    base = {"subject": "מתמטיקה", "weekday": 0, "start_time": "09:00",
            "end_time": "09:45", "valid_from": "2026-09-01"}
    slot = timetable.build_slot({**base, **over},
                                group_id="g1", school_id="s1", teacher_id="t1")
    slot["_id"] = over.get("_id", "tts-fixed")
    return slot


class GroupExpansionTest(unittest.IsolatedAsyncioTestCase):
    """`list_for_group` is the teacher's read — the same expansion the learner
    gets, annotated with the ids the manager needs to act on one occurrence."""

    async def _expand(self, slots, exceptions=(), school_days=(), *,
                      start=date(2026, 9, 6), end=date(2026, 9, 26)):
        async def _read(name):
            return {timetable.SLOTS: list(slots),
                    timetable.EXCEPTIONS: list(exceptions),
                    timetable.SCHOOL_DAYS: list(school_days)}[name]

        with patch.object(timetable, "_read_collection", side_effect=_read), \
             patch.object(timetable.org, "list_schools",
                          AsyncMock(return_value=[{"_id": "s1"}])):
            return await timetable.list_for_group("g1", start, end)

    async def test_one_rule_appears_every_matching_week_with_no_stored_rows(self):
        rows = await self._expand([_slot()])
        # Sundays 6, 13, 20 in range (2026-09-06 is a Sunday).
        self.assertEqual([row["local_date"] for row in rows],
                         ["2026-09-06", "2026-09-13", "2026-09-20"])
        self.assertTrue(all(row["slot_id"] == "tts-fixed" for row in rows))

    async def test_cancelling_one_week_leaves_the_others_alone(self):
        exception = timetable.build_exception(
            {"_id": "tts-fixed"}, "2026-09-13", {"kind": "cancelled"},
            teacher_id="t1")
        rows = await self._expand([_slot()], [exception])
        by_day = {row["local_date"]: row["status"] for row in rows}
        self.assertEqual(by_day["2026-09-13"], "cancelled")
        self.assertEqual(by_day["2026-09-06"], "upcoming")

    async def test_a_holiday_suppresses_the_occurrence(self):
        holiday = timetable.build_school_day(
            {"date": "2026-09-13", "kind": "holiday", "label": "חג"},
            school_id="s1", teacher_id="t1")
        rows = await self._expand([_slot()], school_days=[holiday])
        self.assertEqual([row["local_date"] for row in rows],
                         ["2026-09-06", "2026-09-20"])

    async def test_valid_to_ends_the_rule_without_touching_history(self):
        rows = await self._expand([_slot(valid_to="2026-09-14")])
        self.assertEqual([row["local_date"] for row in rows],
                         ["2026-09-06", "2026-09-13"])

    async def test_a_subgroup_rule_carries_its_subgroup_on_every_occurrence(self):
        rows = await self._expand([_slot(subgroup_id="sg-9", subject_key="math")])
        self.assertTrue(all(row["subgroup_id"] == "sg-9" for row in rows))
        self.assertTrue(all(row["subject_key"] == "math" for row in rows))


class LessonsAsItemsTest(unittest.TestCase):
    """The calendar fold: a class-wide lesson survives a sub-group scope, a
    sub-group lesson reaches only its members — the same rule as every item."""

    OCCURRENCES = [
        {"id": "tts-a:2026-09-06", "local_date": "2026-09-06", "title": "מתמטיקה",
         "start_at": "2026-09-06T06:00:00+00:00", "end_at": "2026-09-06T06:45:00+00:00",
         "status": "upcoming", "slot_id": "tts-a", "subgroup_id": None,
         "subject_key": "math"},
        {"id": "tts-b:2026-09-06", "local_date": "2026-09-06", "title": "מדעים לקבוצה",
         "start_at": "2026-09-06T07:00:00+00:00", "end_at": "2026-09-06T07:45:00+00:00",
         "status": "upcoming", "slot_id": "tts-b", "subgroup_id": "sg-1",
         "subject_key": "science"},
    ]

    def _items(self):
        return school_calendar.lessons_to_items(
            self.OCCURRENCES, {"sg-1": ["kid-a", "kid-b"]},
            "2026-09-01", "2026-09-30")

    def test_occurrences_become_calendar_items(self):
        items = self._items()
        self.assertEqual([item["kind"] for item in items], ["lesson", "lesson"])
        self.assertEqual(items[0]["meta"]["slot_id"], "tts-a")
        self.assertEqual(items[0]["subject"], "math")

    def test_scoping_keeps_the_class_lesson_and_narrows_the_subgroup_one(self):
        kept = school_calendar.filter_for_learners(self._items(), {"kid-z"})
        self.assertEqual([item["id"] for item in kept], ["tts-a:2026-09-06"])
        both = school_calendar.filter_for_learners(self._items(), {"kid-a"})
        self.assertEqual(len(both), 2)


if __name__ == "__main__":
    unittest.main()


class NationalDaysTest(unittest.IsolatedAsyncioTestCase):
    """The published national calendar: applies to every school with no hand
    entry, loses to a school's own rule for the same date, and a day someone
    deliberately retired stays retired across boots."""

    async def test_a_national_day_suppresses_lessons_in_any_school(self):
        national = {"_id": ":2026-09-13", "school_id": "", "date": "2026-09-13",
                    "kind": "holiday", "label": "ראש השנה", "active": True}

        async def _read(name):
            return {timetable.SLOTS: [_slot()],
                    timetable.EXCEPTIONS: [],
                    timetable.SCHOOL_DAYS: [national]}[name]

        with patch.object(timetable, "_read_collection", side_effect=_read), \
             patch.object(timetable.org, "list_schools",
                          AsyncMock(return_value=[{"_id": "s1"}])):
            rows = await timetable.list_for_group(
                "g1", date(2026, 9, 6), date(2026, 9, 20))
        self.assertEqual([row["local_date"] for row in rows],
                         ["2026-09-06", "2026-09-20"])

    async def test_holidays_for_prefers_the_school_row(self):
        national = {"_id": ":2026-09-13", "school_id": "", "date": "2026-09-13",
                    "kind": "holiday", "label": "ראש השנה", "active": True}
        school = {"_id": "s1:2026-09-13", "school_id": "s1", "date": "2026-09-13",
                  "kind": "half_day", "label": "יום מקוצר", "active": True,
                  "closed_from": "11:00"}

        async def _read(name):
            return [national, school] if name == timetable.SCHOOL_DAYS else []

        with patch.object(timetable, "_read_collection", side_effect=_read):
            rows = await timetable.holidays_for(
                {"s1"}, date(2026, 9, 1), date(2026, 9, 30))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["school_id"], "s1")

    def test_the_published_ranges_expand_to_per_date_rows(self):
        rows = timetable.national_rows()
        by_date = {row["date"]: row for row in rows}
        # Pesach is a 16-day range in the luach — 16 rows, not one.
        pesach = [row for row in rows if row["label"] == "פסח"]
        self.assertEqual(len(pesach), 16)
        self.assertEqual(by_date["2027-05-11"]["kind"], "half_day")
        self.assertEqual(by_date["2027-05-11"]["closed_from"], "12:00")
        self.assertTrue(all(row["school_id"] == "" for row in rows))

    async def test_seeding_is_insert_if_absent_and_respects_retirement(self):
        import tempfile
        from pathlib import Path as _Path

        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(timetable, "_FALLBACK_DIR", _Path(tmp)), \
                 patch.object(timetable, "_get_collection_named",
                              return_value=None):
                first = await timetable.ensure_national_days()
                self.assertGreater(first, 100)
                # A retired day must stay retired on the next boot.
                rows = timetable._read_fallback(timetable.SCHOOL_DAYS)
                target = next(row for row in rows if row["_id"] == ":2026-09-11")
                target["active"] = False
                timetable._write_fallback(timetable.SCHOOL_DAYS, rows)
                second = await timetable.ensure_national_days()
                self.assertEqual(second, 0)
                held = timetable._read_fallback(timetable.SCHOOL_DAYS)
                row = next(r for r in held if r["_id"] == ":2026-09-11")
                self.assertFalse(row["active"])
