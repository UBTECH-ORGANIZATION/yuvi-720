"""Goal progress: the number a teacher reads must be countable and honest.

An action-tracked goal promises "the system will see this happen". These tests
pin the counting rules: only events inside the goal's window count, a retry is
an answer AFTER a miss on the same question, active days are distinct days,
and the two mirrors of Yuvi chat never double-count each other.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import goal_progress


ASSIGNED = "2026-08-10T08:00:00+00:00"
GOAL = {"deadline": "2026-08-17", "action": {"kind": "use_hint", "target": 3}}


def _activity(kind: str, at: str) -> dict:
    return {"kind": kind, "at": at}


def _answer(at: str, *, success=None, question="q1", verb="answered") -> dict:
    return {"verb": verb, "occurred_at": at, "launch": "c1", "sub_item_id": "s1",
            "question_id": question, "result": {"success": success}}


class TheActionSpecIsValidatedNotTrusted(unittest.TestCase):

    def test_unknown_kinds_and_bad_targets_become_untracked(self):
        for bad in (None, "use_hint", {"kind": "be_nice", "target": 3},
                    {"kind": "use_hint", "target": 0},
                    {"kind": "use_hint", "target": "lots"}):
            self.assertIsNone(goal_progress.normalize_action(bad))

    def test_active_days_cannot_exceed_a_week(self):
        action = goal_progress.normalize_action({"kind": "active_days", "target": 30})
        self.assertEqual(action["target"], 7)


class WhatCounts(unittest.TestCase):

    def _progress(self, goal, activity=(), events=(), yuvi=()):
        return goal_progress.progress_from_sources(
            goal, ASSIGNED, list(activity), list(events), list(yuvi))

    def test_only_the_window_counts(self):
        activity = [
            _activity("hint", "2026-08-09T10:00:00+00:00"),   # before assignment
            _activity("hint", "2026-08-12T10:00:00+00:00"),
            _activity("content_hint", "2026-08-17T21:00:00+00:00"),  # deadline day counts
            _activity("hint", "2026-08-18T10:00:00+00:00"),   # after the deadline day
        ]
        progress = self._progress(GOAL, activity=activity)
        self.assertEqual(progress["count"], 2)
        self.assertFalse(progress["met"])

    def test_met_when_the_target_is_reached(self):
        activity = [_activity("hint", f"2026-08-1{day}T10:00:00+00:00")
                    for day in (1, 2, 3)]
        progress = self._progress(GOAL, activity=activity)
        self.assertEqual(progress["count"], 3)
        self.assertTrue(progress["met"])

    def test_a_goal_without_an_action_has_no_progress(self):
        self.assertIsNone(self._progress({"deadline": "2026-08-17"}))

    def test_a_retry_is_an_answer_after_a_miss_on_the_same_question(self):
        goal = {"deadline": "2026-08-17",
                "action": {"kind": "retry_after_wrong", "target": 1}}
        events = [
            _answer("2026-08-11T10:00:00+00:00", success=False),
            _answer("2026-08-11T10:01:00+00:00", success=True),           # retry
            _answer("2026-08-11T10:02:00+00:00", success=True, question="q2"),
        ]
        progress = self._progress(goal, events=events)
        self.assertEqual(progress["count"], 1)
        self.assertTrue(progress["met"])

    def test_a_second_wrong_answer_still_counts_as_trying_again(self):
        goal = {"deadline": "2026-08-17",
                "action": {"kind": "retry_after_wrong", "target": 2}}
        events = [
            _answer("2026-08-11T10:00:00+00:00", success=False),
            _answer("2026-08-11T10:01:00+00:00", success=False),  # tried again
            _answer("2026-08-11T10:02:00+00:00", success=True),   # and again
        ]
        self.assertEqual(self._progress(goal, events=events)["count"], 2)

    def test_active_days_are_distinct_days_not_events(self):
        goal = {"deadline": "2026-08-17",
                "action": {"kind": "active_days", "target": 2}}
        events = [
            _answer("2026-08-11T10:00:00+00:00", success=True),
            _answer("2026-08-11T15:00:00+00:00", success=True),
            _answer("2026-08-13T10:00:00+00:00", success=False),
        ]
        self.assertEqual(self._progress(goal, events=events)["count"], 2)

    def test_yuvi_chat_mirrors_take_the_max_never_the_sum(self):
        # Question-scoped chat lands in BOTH learner_activity and
        # agent_messages; summing would tell the teacher the child asked twice.
        # Since #462 the raw volume lives in quality.chatted — the count
        # itself is the substantive-message count (test_goal_verification.py).
        goal = {"deadline": "2026-08-17",
                "action": {"kind": "ask_yuvi", "target": 4}}
        scoped = [_activity("yuvi_chat", "2026-08-11T10:00:00+00:00")]
        free = ["2026-08-11T10:00:00+00:00", "2026-08-12T10:00:00+00:00"]
        progress = self._progress(goal, activity=scoped, yuvi=free)
        self.assertEqual(progress["quality"]["chatted"], 2)
        self.assertEqual(progress["count"], 0)

    def test_no_deadline_counts_up_to_now(self):
        goal = {"action": {"kind": "use_hint", "target": 1}}
        recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        progress = self._progress(goal, activity=[_activity("hint", recent)])
        self.assertEqual(progress["count"], 1)


if __name__ == "__main__":
    unittest.main()
