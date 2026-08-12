"""One learner's series: bucketing, honesty about gaps, and agreement.

The property that matters most here is the last one. These numbers sit on the
same screen as numbers computed elsewhere, and a minutes figure that disagrees
with the group screen's minutes figure by a factor of three — because one caps
idle gaps and the other does not — is worse than showing nothing.
"""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import learner_trends     # noqa: E402


def _at(days_ago: int, hour: int = 10) -> str:
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return moment.replace(hour=hour, minute=0, second=0, microsecond=0).isoformat()


def _event(days_ago: int, *, success=True, seconds=60.0, subject="math",
           verb="answered", quality="ok") -> dict:
    return {
        "verb": verb,
        "subject": subject,
        "occurred_at": _at(days_ago),
        "stored_at": _at(days_ago),
        "result": {"success": success},
        "timing": {"elapsed_since_previous_seconds": seconds, "quality": quality},
    }


class Bucketing(unittest.IsolatedAsyncioTestCase):
    async def _run(self, events, *, brain=None, days=30):
        with patch("app.services.events.get_learner_events",
                   AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(return_value=brain or {})):
            return await learner_trends.learner_trends("kid-1", days=days)

    async def test_the_window_includes_the_days_nothing_happened(self):
        # A sparkline drawn only over active days puts two points from opposite
        # ends of a month side by side and reads like two consecutive days.
        view = await self._run([_event(0), _event(10)], days=30)
        self.assertEqual(len(view["per_day"]), 30)
        self.assertEqual(view["per_day"][0]["date"], view["from"])
        self.assertEqual(view["per_day"][-1]["date"], view["to"])

    async def test_days_are_in_order_oldest_first(self):
        view = await self._run([_event(0)], days=14)
        dates = [row["date"] for row in view["per_day"]]
        self.assertEqual(dates, sorted(dates))

    async def test_attempts_and_correct_land_on_the_right_day(self):
        view = await self._run([
            _event(1, success=True), _event(1, success=False), _event(3, success=True),
        ], days=7)
        by_date = {row["date"]: row for row in view["per_day"]}
        yesterday = view["per_day"][-2]["date"]
        self.assertEqual(by_date[yesterday]["attempts"], 2)
        self.assertEqual(by_date[yesterday]["correct"], 1)
        self.assertEqual(by_date[yesterday]["success_rate"], 0.5)

    async def test_a_day_with_no_attempts_has_no_rate_rather_than_zero(self):
        view = await self._run([_event(0)], days=7)
        quiet = [row for row in view["per_day"] if row["attempts"] == 0]
        self.assertTrue(quiet)
        for row in quiet:
            self.assertIsNone(row["success_rate"])

    async def test_events_outside_the_window_are_dropped(self):
        view = await self._run([_event(0), _event(90)], days=30)
        self.assertEqual(view["totals"]["attempts"], 1)

    async def test_the_day_is_when_it_happened_not_when_we_heard(self):
        # A statement relayed late belongs to the day the child did the work.
        event = _event(0)
        event["occurred_at"] = _at(2)
        view = await self._run([event], days=7)
        by_date = {row["date"]: row["attempts"] for row in view["per_day"]}
        self.assertEqual(by_date[_at(2)[:10]], 1)
        self.assertEqual(by_date[_at(0)[:10]], 0)

    async def test_an_empty_history_is_a_full_window_of_zeros(self):
        view = await self._run([], days=30)
        self.assertEqual(len(view["per_day"]), 30)
        self.assertEqual(view["totals"]["attempts"], 0)
        self.assertIsNone(view["totals"]["success_rate"])
        self.assertEqual(view["active_days"], 0)
        self.assertEqual(view["streak"], 0)
        self.assertEqual(view["per_subject"], [])

    async def test_the_window_is_clamped(self):
        self.assertEqual((await self._run([], days=9999))["days"], learner_trends.MAX_DAYS)
        self.assertEqual((await self._run([], days=0))["days"], 1)


class MinutesAgreeWithTheGroupScreen(unittest.IsolatedAsyncioTestCase):
    async def _run(self, events):
        with patch("app.services.events.get_learner_events",
                   AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value={})):
            return await learner_trends.learner_trends("kid-1", days=7)

    async def test_a_gap_is_capped_at_the_same_ceiling(self):
        from app.services.learning_timing import PROLONGED_INTERACTION_SECONDS

        # Someone left the tab open for four hours. `group_analytics` counts
        # that as one capped interaction; so must this, or the profile and the
        # class screen disagree about the same afternoon.
        view = await self._run([_event(0, seconds=14400)])
        self.assertEqual(view["totals"]["minutes"],
                         round(PROLONGED_INTERACTION_SECONDS / 60.0, 1))

    async def test_unreliable_timing_is_not_counted(self):
        view = await self._run([_event(0, seconds=120, quality="unreliable")])
        self.assertEqual(view["totals"]["minutes"], 0)

    async def test_a_non_question_event_still_contributes_time(self):
        # Reading a screen is time spent even though it is not an attempt.
        view = await self._run([_event(0, verb="experienced", seconds=120)])
        self.assertEqual(view["totals"]["attempts"], 0)
        self.assertEqual(view["totals"]["minutes"], 2.0)


class Streaks(unittest.IsolatedAsyncioTestCase):
    async def _run(self, events):
        with patch("app.services.events.get_learner_events",
                   AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value={})):
            return await learner_trends.learner_trends("kid-1", days=30)

    async def test_counts_consecutive_days(self):
        view = await self._run([_event(0), _event(1), _event(2), _event(9)])
        self.assertEqual(view["active_days"], 4)
        self.assertEqual(view["streak"], 3)

    async def test_uses_the_badge_engine_rule_rather_than_its_own(self):
        from app.services.badges import _longest_day_streak

        days = {"2026-08-01", "2026-08-02", "2026-08-05"}
        self.assertEqual(learner_trends._streak(sorted(days)), _longest_day_streak(days))

    async def test_a_day_with_only_reading_time_still_counts_as_active(self):
        view = await self._run([_event(0, verb="experienced", seconds=120)])
        self.assertEqual(view["active_days"], 1)


class PerSubject(unittest.IsolatedAsyncioTestCase):
    async def _run(self, events):
        with patch("app.services.events.get_learner_events",
                   AsyncMock(return_value=events)), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value={})):
            return await learner_trends.learner_trends("kid-1", days=14)

    async def test_one_row_per_subject_busiest_first(self):
        view = await self._run([
            _event(0, subject="math"), _event(1, subject="math"),
            _event(2, subject="science"),
        ])
        self.assertEqual([row["subject"] for row in view["per_subject"]], ["math", "science"])
        self.assertEqual(view["per_subject"][0]["attempts"], 2)

    async def test_an_untagged_event_lands_in_other_rather_than_vanishing(self):
        event = _event(0)
        event["subject"] = None
        view = await self._run([event])
        self.assertEqual([row["subject"] for row in view["per_subject"]], ["other"])

    async def test_every_series_spans_the_whole_window(self):
        # Two subjects worked on different days must still line up on one axis.
        view = await self._run([_event(0, subject="math"), _event(5, subject="science")])
        for row in view["per_subject"]:
            self.assertEqual(len(row["series"]), 14)
            self.assertEqual([point["date"] for point in row["series"]],
                             [day["date"] for day in view["per_day"]])

    async def test_a_day_the_subject_was_not_studied_has_no_rate(self):
        view = await self._run([_event(0, subject="math")])
        quiet = [p for p in view["per_subject"][0]["series"] if p["attempts"] == 0]
        self.assertTrue(quiet)
        for point in quiet:
            self.assertIsNone(point["success_rate"])


class MasterySteps(unittest.IsolatedAsyncioTestCase):
    async def _run(self, brain, days=30):
        with patch("app.services.events.get_learner_events", AsyncMock(return_value=[])), \
             patch("app.brain.repository.get_brain", AsyncMock(return_value=brain)):
            return await learner_trends.learner_trends("kid-1", days=days)

    async def test_only_achieved_objectives_appear(self):
        view = await self._run({"mastery": {
            "MOE·MATH·A": {"achieved": True, "achieved_at": _at(2), "level": "intermediate"},
            "MOE·MATH·B": {"achieved": False, "achieved_at": _at(1)},
        }})
        self.assertEqual([step["objective_id"] for step in view["mastered_steps"]],
                         ["MOE.MATH.A"])

    async def test_the_dot_safe_key_is_restored(self):
        # Brain v2 stores `·` for `.` in mastery keys; a chart label showing the
        # middot is the storage detail leaking onto the screen.
        view = await self._run({"mastery": {
            "MOE·SCI·G7·MASS": {"achieved": True, "achieved_at": _at(1)}}})
        self.assertEqual(view["mastered_steps"][0]["objective_id"], "MOE.SCI.G7.MASS")

    async def test_an_explicit_objective_id_wins_over_the_key(self):
        view = await self._run({"mastery": {
            "whatever": {"achieved": True, "achieved_at": _at(1),
                         "objective_id": "MOE.MATH.REAL"}}})
        self.assertEqual(view["mastered_steps"][0]["objective_id"], "MOE.MATH.REAL")

    async def test_steps_are_oldest_first_so_the_staircase_climbs(self):
        view = await self._run({"mastery": {
            "A": {"achieved": True, "achieved_at": _at(1)},
            "B": {"achieved": True, "achieved_at": _at(5)},
            "C": {"achieved": True, "achieved_at": _at(3)},
        }})
        stamps = [step["at"] for step in view["mastered_steps"]]
        self.assertEqual(stamps, sorted(stamps))

    async def test_achievements_before_the_window_are_out(self):
        view = await self._run({"mastery": {
            "A": {"achieved": True, "achieved_at": _at(2)},
            "old": {"achieved": True, "achieved_at": _at(90)},
        }}, days=30)
        self.assertEqual(len(view["mastered_steps"]), 1)

    async def test_a_broken_brain_read_does_not_break_the_page(self):
        with patch("app.services.events.get_learner_events", AsyncMock(return_value=[])), \
             patch("app.brain.repository.get_brain",
                   AsyncMock(side_effect=RuntimeError("mongo is down"))):
            view = await learner_trends.learner_trends("kid-1", days=30)
        # The charts that do not depend on the brain still render.
        self.assertEqual(view["mastered_steps"], [])
        self.assertEqual(len(view["per_day"]), 30)


class TheRoute(unittest.IsolatedAsyncioTestCase):
    async def test_an_out_of_scope_teacher_is_refused_with_no_reads(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value=None)), \
             patch("app.services.learner_trends.learner_trends", AsyncMock()) as engine:
            response = await routes.student_trends(
                "kid-1", days=30, session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 403)
        engine.assert_not_awaited()

    async def test_the_normalised_id_is_what_gets_read(self):
        from app.routes import teacher_students as routes

        with patch.object(routes, "_guard_learner", AsyncMock(return_value="kid-1")), \
             patch("app.services.learner_trends.learner_trends",
                   AsyncMock(return_value={"per_day": []})) as engine:
            response = await routes.student_trends(
                " KID-1 ", days=30, session={"sub": "teacher-1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(engine.await_args.args[0], "kid-1")


if __name__ == "__main__":
    unittest.main()
