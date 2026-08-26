"""The deterministic dashboard band (#450): fixed rules, fixed answers.

The band is a claim about a child. These tests pin the three properties that
make it trustworthy: RED always wins over GREEN evidence, silence is ORANGE
(never green, never red), and every verdict carries its reasons.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import teacher_bands  # noqa: E402


def _band(brain=None, *, attention=None, feeling=None, status="active", progress=None,
          window_days=7):
    return teacher_bands.base_band(
        brain or {},
        attention_all=attention or [],
        today_feeling=feeling,
        status=status,
        objectives_progress=progress,
        window_days=window_days,
    )


def _signals(result):
    return [reason["signal"] for reason in result["reasons"]]


class RedRules(unittest.TestCase):
    def test_each_attention_kind_maps_to_a_red_signal(self):
        for kind, signal in teacher_bands._RED_ATTENTION_KINDS.items():
            result = _band(attention=[{"kind": kind, "raw_evidence": {"n": 1}}])
            self.assertEqual(result["band"], "red", kind)
            self.assertIn(signal, _signals(result))
            self.assertEqual(result["reasons"][0]["evidence"], {"n": 1})

    def test_slow_progress_is_not_red(self):
        result = _band(attention=[{"kind": "slow_progress", "raw_evidence": {}}])
        self.assertNotEqual(result["band"], "red")

    def test_heavy_feeling_today_is_red_but_okay_is_not(self):
        heavy = _band(feeling={"valence": "upset", "feeling": "sad"})
        self.assertEqual(heavy["band"], "red")
        self.assertIn("heavy_feeling_today", _signals(heavy))
        okay = _band(feeling={"valence": "okay", "feeling": "fine"})
        self.assertNotEqual(okay["band"], "red")

    def test_answer_cycling_accepts_the_type_the_detector_stores(self):
        result = _band({"behavior_signals": [
            {"type": "rapid_answer_cycling", "at": "2026-08-23T10:00:00Z"}]})
        self.assertEqual(result["band"], "red")
        self.assertIn("answer_cycling", _signals(result))

    def test_red_beats_green_evidence(self):
        result = _band(
            {"mastery": {"obj": {"attempts": 9, "score_ewma": 0.9, "confidence": 0.9}}},
            attention=[{"kind": "inactivity", "raw_evidence": {"days": 8}}],
        )
        self.assertEqual(result["band"], "red")

    def test_blocked_message_forces_red_over_anything(self):
        green = _band({"mastery": {"obj": {
            "attempts": 9, "score_ewma": 0.9, "confidence": 0.9}}})
        self.assertEqual(green["band"], "green")
        forced = teacher_bands.apply_blocked_messages(
            green, [{"created_at": "2026-08-22T10:00:00Z", "category": "harassment"}])
        self.assertEqual(forced["band"], "red")
        self.assertEqual(forced["reasons"][0]["signal"], "blocked_message")


class GreenRules(unittest.TestCase):
    def test_high_ewma_with_confidence(self):
        result = _band({"mastery": {"obj": {
            "attempts": 6, "score_ewma": 0.8, "confidence": 0.6}}})
        self.assertEqual(result["band"], "green")
        self.assertIn("high_mastery", _signals(result))

    def test_the_level_latch_alone_is_not_green(self):
        """`level` never demotes — a peak long ago must not read green forever."""
        result = _band({"mastery": {"obj": {
            "attempts": 12, "level": "intermediate", "score_ewma": 0.3,
            "confidence": 0.4}}})
        self.assertEqual(result["band"], "orange")

    def test_level_with_current_evidence_is_green(self):
        result = _band({"mastery": {"obj": {
            "attempts": 12, "level": "intermediate", "score_ewma": 0.65,
            "confidence": 0.4, "needs_review": False}}})
        self.assertEqual(result["band"], "green")
        self.assertIn("mastery_level_confirmed", _signals(result))

    def test_success_streak_and_subject_percent(self):
        streak = _band({"mastery": {"obj": {"attempts": 4, "consecutive_successes": 3}}})
        self.assertEqual(streak["band"], "green")
        subject = _band(
            {"mastery": {"obj": {"attempts": 2, "score_ewma": 0.5}}},
            progress={"math": {"percent": 85}},
        )
        self.assertEqual(subject["band"], "green")
        self.assertIn("subject_strength", _signals(subject))

    def test_week_over_week_improvement_upgrade(self):
        flat = [{"attempts": 2, "correct": 1}] * 7
        better = [{"attempts": 2, "correct": 2}] * 7
        reason = teacher_bands.improvement_from_trends({"per_day": flat + better})
        self.assertIsNotNone(reason)
        self.assertEqual(reason["signal"], "improving_week")
        # Too little volume → no verdict either way.
        self.assertIsNone(teacher_bands.improvement_from_trends(
            {"per_day": [{"attempts": 0, "correct": 0}] * 7
             + [{"attempts": 2, "correct": 2}] * 7}))


class ThePeriodRejudgesTheBand(unittest.TestCase):
    """The dashboard's period is not a label on the same verdict — it changes it.

    A class read over a month should be more forgiving than the same class read
    over three days, because how long a child has been quiet only means
    something relative to the stretch being looked at.
    """

    def _quiet_for(self, days, *, window_days):
        return _band(
            attention=[{"kind": "inactivity", "raw_evidence": {"days_inactive": days}}],
            window_days=window_days,
        )

    def test_the_default_period_is_exactly_the_detector_cut(self):
        """The band a teacher sees on the default week must be the band they
        saw before the period control existed. The threshold is SCALED from the
        detector's own number, not replaced by the window length — replacing it
        would have quietly moved the weekly cut from six days to seven."""
        from app.services.insights import INACTIVITY_DAYS
        self.assertEqual(teacher_bands.inactivity_threshold(7), INACTIVITY_DAYS)
        self.assertEqual(self._quiet_for(INACTIVITY_DAYS, window_days=7)["band"], "red")
        self.assertNotEqual(
            self._quiet_for(INACTIVITY_DAYS - 1, window_days=7)["band"], "red")

    def test_silence_is_red_only_once_it_outlasts_the_period(self):
        # Six days quiet: a real signal on the weekly view…
        self.assertEqual(self._quiet_for(6, window_days=7)["band"], "red")
        # …and unremarkable on the monthly one, where the class is being read
        # over four times that span.
        self.assertNotEqual(self._quiet_for(6, window_days=30)["band"], "red")
        # Long enough, and it is red on every view.
        self.assertEqual(self._quiet_for(31, window_days=30)["band"], "red")
        # The scale is monotonic: a wider window is never stricter.
        thresholds = [teacher_bands.inactivity_threshold(d) for d in (1, 3, 7, 30)]
        self.assertEqual(thresholds, sorted(thresholds))

    def test_the_daily_view_does_not_paint_the_class_red_every_morning(self):
        """The floor that stops the shortest period from being useless.

        Without it, "inactive for >= 1 day" would fire for every child who has
        not logged in since midnight — the entire class red before first period,
        which is a reading of the clock, not of the children.
        """
        self.assertEqual(teacher_bands.inactivity_threshold(1), 3)
        self.assertEqual(teacher_bands.inactivity_threshold(3), 3)
        self.assertNotEqual(self._quiet_for(1, window_days=1)["band"], "red")
        self.assertNotEqual(self._quiet_for(2, window_days=1)["band"], "red")
        # Three days of silence still reaches a teacher on the daily view.
        self.assertEqual(self._quiet_for(3, window_days=1)["band"], "red")
        # And the longer periods are never pulled DOWN to the floor.
        self.assertGreater(teacher_bands.inactivity_threshold(30), 3)

    def test_the_period_never_softens_anything_but_silence(self):
        """Only the inactivity rule scales. Distress does not get more
        acceptable because a teacher widened the window."""
        for kind in teacher_bands._RED_ATTENTION_KINDS:
            if kind == "inactivity":
                continue
            result = _band(attention=[{"kind": kind, "raw_evidence": {}}], window_days=30)
            self.assertEqual(result["band"], "red", kind)

    def test_a_detector_that_reports_no_day_count_is_still_heard(self):
        # The threshold is applied to evidence, and missing evidence must fail
        # open: a flag with nothing to measure stays the red signal it was.
        result = _band(attention=[{"kind": "inactivity", "raw_evidence": {}}],
                       window_days=30)
        self.assertEqual(result["band"], "red")

    def test_improvement_splits_the_series_at_the_period(self):
        flat = [{"attempts": 2, "correct": 1}]
        better = [{"attempts": 2, "correct": 2}]
        # Three days against the three before them, on a 6-row series.
        series = flat * 3 + better * 3
        self.assertIsNotNone(
            teacher_bands.improvement_from_trends({"per_day": series}, 3))
        # The same series is too short to say anything about a week.
        self.assertIsNone(
            teacher_bands.improvement_from_trends({"per_day": series}, 7))


class OrangeRules(unittest.TestCase):
    def test_no_evidence_is_orange_with_the_honest_reason(self):
        result = _band({}, status="not_started")
        self.assertEqual(result["band"], "orange")
        self.assertEqual(_signals(result), ["insufficient_evidence"])

    def test_middling_evidence_is_orange(self):
        result = _band({"mastery": {"obj": {
            "attempts": 5, "score_ewma": 0.55, "confidence": 0.3}}})
        self.assertEqual(result["band"], "orange")


class ChangeFreshness(unittest.TestCase):
    def test_first_sighting_is_never_new(self):
        self.assertFalse(teacher_bands.is_fresh_change(
            {"changed_at": "2026-08-23T10:00:00+00:00", "previous": None}))

    def test_a_recent_real_transition_is_new_and_an_old_one_is_not(self):
        from datetime import datetime, timedelta, timezone

        recent = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
        self.assertTrue(teacher_bands.is_fresh_change(
            {"changed_at": recent, "previous": "orange"}))
        self.assertFalse(teacher_bands.is_fresh_change(
            {"changed_at": old, "previous": "orange"}))


if __name__ == "__main__":
    unittest.main()
