"""The class calendar: which day a thing lands on, and what is allowed on it.

A calendar is a grid of days, so nearly every bug in one is a day bug. These
pin the three that matter: an all-day event must never slide across a timezone
boundary, a late-evening UTC deadline belongs to the *school's* tomorrow, and a
narrowed calendar must not hide the class-wide item that also applies.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import school_calendar as cal


GROUP = {"group_id": "g1", "teacher_id": "t1"}


class WhichDay(unittest.TestCase):

    def test_an_all_day_date_never_moves(self):
        # The whole point of all-day: the 18th is the 18th in every timezone.
        self.assertEqual(cal.day_of("2026-08-18"), "2026-08-18")
        self.assertTrue(cal.is_day_shaped("2026-08-18"))

    def test_a_late_utc_stamp_belongs_to_the_school_tomorrow(self):
        # 22:30 UTC is 01:30 the next day in Israel — the class sees it as
        # tomorrow's work, and the column it sits in has to agree.
        self.assertEqual(cal.day_of("2026-08-18T22:30:00+00:00"), "2026-08-19")

    def test_a_morning_stamp_stays_on_its_own_day(self):
        self.assertEqual(cal.day_of("2026-08-18T06:00:00+00:00"), "2026-08-18")

    def test_an_offset_stamp_is_read_as_written(self):
        self.assertEqual(cal.day_of("2026-08-21T09:00:00+03:00"), "2026-08-21")

    def test_nonsense_has_no_day_rather_than_a_wrong_one(self):
        for bad in ("", None, "not-a-date", "2026-13-45"):
            self.assertIsNone(cal.day_of(bad))

    def test_a_reversed_range_is_read_in_the_order_meant(self):
        self.assertEqual(cal.normalize_range("2026-08-31", "2026-08-01"),
                         ("2026-08-01", "2026-08-31"))

    def test_no_range_defaults_to_a_whole_month(self):
        start, end = cal.normalize_range(None, None)
        self.assertTrue(start.endswith("-01"))
        self.assertLess(start, end)


class WhatMayBeScheduled(unittest.TestCase):

    def _build(self, **overrides):
        data = {"title": "מבחן", "kind": "test", "all_day": True,
                "start_at": "2026-08-20",
                "targets": [{"kind": "group", "id": "g1"}]}
        data.update(overrides)
        return cal.build_event(data, **GROUP)

    def test_a_valid_all_day_event_is_stored_day_shaped(self):
        event = self._build()
        self.assertEqual(event["start_at"], "2026-08-20")
        self.assertTrue(event["all_day"])
        self.assertEqual(event["targets"], [{"kind": "group", "id": "g1"}])

    def test_an_all_day_event_may_not_carry_a_timestamp(self):
        # Storing an instant is exactly what makes an all-day event slide.
        with self.assertRaises(cal.CalendarError):
            self._build(start_at="2026-08-20T22:30:00+00:00")

    def test_a_timed_event_may_not_be_a_bare_date(self):
        with self.assertRaises(cal.CalendarError):
            self._build(all_day=False, start_at="2026-08-20")

    def test_the_refusals_are_stable_codes(self):
        for overrides, code in (
            ({"title": "  "}, "title_required"),
            ({"kind": "party"}, "bad_kind"),
            ({"end_at": "2026-08-19"}, "end_before_start"),
            ({"targets": []}, "targets_required"),
            ({"targets": [{"kind": "planet", "id": "x"}]}, "bad_targets"),
            ({"targets": "everyone"}, "bad_targets"),
        ):
            with self.assertRaises(cal.CalendarError) as caught:
                self._build(**overrides)
            self.assertEqual(str(caught.exception), code)

    def test_duplicate_targets_collapse(self):
        event = self._build(targets=[{"kind": "group", "id": "g1"},
                                     {"kind": "group", "id": "g1"}])
        self.assertEqual(len(event["targets"]), 1)


class TheLearnerProjectionCanReadWhatWeWrite(unittest.TestCase):
    """The contract with `services/calendar_events.py`.

    That module answers "what is on MY calendar" for a learner off this very
    collection, and it reads three fields by names this side would not
    otherwise use. They were written in parallel, and the mismatch is silent:
    an event missing `creator_id` is skipped, an all-day event without `date`
    resolves to no day and is skipped, and a `deleted` row with no `active`
    flag stays visible to the class forever. Nothing fails loudly — the
    students simply never see it.
    """

    def _build(self, **overrides):
        data = {"title": "מבחן", "kind": "test", "all_day": True,
                "start_at": "2026-08-20",
                "targets": [{"kind": "group", "id": "g1"}]}
        data.update(overrides)
        return cal.build_event(data, **GROUP)

    def test_targets_are_resolvable_by_the_learner_side(self):
        # It calls `resolve_one(creator_id, target)` and skips the event when
        # `creator_id` is empty — which would hide every teacher event.
        event = self._build()
        self.assertEqual(event["creator_id"], GROUP["teacher_id"])

    def test_an_all_day_event_carries_the_day_the_learner_side_reads(self):
        event = self._build()
        self.assertEqual(event["date"], "2026-08-20")
        self.assertEqual(event["start_at"], "2026-08-20")

    def test_a_timed_event_has_no_day_field_to_be_misread(self):
        event = self._build(all_day=False, start_at="2026-08-21T09:00:00+03:00")
        self.assertIsNone(event["date"])

    def test_a_new_event_is_active(self):
        self.assertIs(self._build()["active"], True)

    def test_the_timezone_is_left_for_the_school_to_decide(self):
        # The learner side resolves the group's own school zone; stamping this
        # process's global default would override a more accurate answer.
        self.assertNotIn("timezone", self._build())


class TheFold(unittest.TestCase):
    """Four sources, one list — and only what falls inside the window."""

    RANGE = ("2026-08-01", "2026-08-31")

    def test_events_outside_the_window_are_left_out(self):
        events = [
            {"_id": "a", "title": "in", "kind": "test", "all_day": True,
             "start_at": "2026-08-20"},
            {"_id": "b", "title": "out", "kind": "test", "all_day": True,
             "start_at": "2026-09-02"},
        ]
        items = cal.events_to_items(events, *self.RANGE)
        self.assertEqual([item["id"] for item in items], ["a"])
        self.assertEqual(items[0]["source"], "event")

    def test_a_launch_keeps_the_roster_it_froze(self):
        # A launch is a historical fact: these are the children who got it,
        # not whoever is in the class today.
        launches = [{"_id": "tsk-1:1", "task_id": "tsk-1", "due_at": "2026-08-12",
                     "learner_ids": ["a", "b"], "targets": [{"kind": "group", "id": "g1"}]}]
        items = cal.launches_to_items(launches, {"tsk-1": "דף עבודה"},
                                      {"tsk-1": "math"}, *self.RANGE)
        self.assertEqual(items[0]["title"], "דף עבודה")
        self.assertEqual(items[0]["learner_ids"], ["a", "b"])
        self.assertEqual(items[0]["subject"], "math")

    def test_an_undated_launch_is_not_invented_onto_a_day(self):
        launches = [{"_id": "tsk-1:1", "task_id": "tsk-1", "due_at": None}]
        self.assertEqual(cal.launches_to_items(launches, {}, {}, *self.RANGE), [])

    def test_a_conversation_yields_its_meeting_and_each_goal_deadline(self):
        conversations = [{
            "id": "ment_1", "date": "2026-08-05", "meeting_stage": "מפגש",
            "goals": [{"id": "goal_1", "title": "יעד", "deadline": "2026-08-19"},
                      {"id": "goal_2", "title": "מאוחר", "deadline": "2026-09-30"}],
        }]
        items = cal.conversations_to_items("kid", conversations, *self.RANGE)
        self.assertEqual(sorted(item["source"] for item in items), ["goal", "meeting"])
        for item in items:
            self.assertEqual(item["learner_id"], "kid")

    def test_all_day_items_sort_above_timed_ones_in_their_day(self):
        items = cal.sort_items([
            {"day": "2026-08-20", "all_day": False, "at": "2026-08-20T09:00:00+00:00", "title": "b"},
            {"day": "2026-08-20", "all_day": True, "at": None, "title": "a"},
            {"day": "2026-08-19", "all_day": False, "at": "2026-08-19T09:00:00+00:00", "title": "c"},
        ])
        self.assertEqual([item["title"] for item in items], ["c", "a", "b"])


class NarrowingTheView(unittest.TestCase):

    ITEMS = [
        {"id": "class-test", "learner_ids": [], "targets": [{"kind": "group", "id": "g1"}]},
        {"id": "kid-goal", "learner_ids": ["kid"], "targets": []},
        {"id": "other-goal", "learner_ids": ["someone-else"], "targets": []},
    ]

    def test_no_scope_shows_everything(self):
        self.assertEqual(len(cal.filter_for_learners(self.ITEMS, None)), 3)

    def test_a_class_wide_item_survives_a_narrowed_view(self):
        # "The whole class has a test on Tuesday" is true for these six
        # children too; dropping it would make the narrowed calendar lie.
        kept = {item["id"] for item in cal.filter_for_learners(self.ITEMS, {"kid"})}
        self.assertEqual(kept, {"class-test", "kid-goal"})


if __name__ == "__main__":
    unittest.main()
