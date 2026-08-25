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


def _band(brain=None, *, attention=None, feeling=None, status="active", progress=None):
    return teacher_bands.base_band(
        brain or {},
        attention_all=attention or [],
        today_feeling=feeling,
        status=status,
        objectives_progress=progress,
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
