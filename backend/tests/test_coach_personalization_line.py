"""The coach adapts the FORM of help to the learner's known style — but only
when the profile actually carries signal. Tests the gate + locale coverage of
the personalization line (prompt-quality itself is judged in the E2E read)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents import coach  # noqa: E402


class PersonalizationGateTests(unittest.TestCase):
    def test_detects_profile_signal(self) -> None:
        self.assertTrue(coach._has_personalization({"profile": {"interests": ["football"]}}))
        self.assertTrue(coach._has_personalization({"profile": {"learning_style": "visual"}}))
        self.assertTrue(coach._has_personalization({"portrait": {"preferences": ["step by step"]}}))
        self.assertTrue(coach._has_personalization({"student_description": "loves stories"}))

    def test_cold_start_has_no_signal(self) -> None:
        self.assertFalse(coach._has_personalization({}))
        self.assertFalse(coach._has_personalization({"profile": {}, "portrait": {}}))
        self.assertFalse(coach._has_personalization(
            {"profile": {"interests": [], "preferences": []}, "student_description": ""}
        ))

    def test_line_covers_every_supported_language(self) -> None:
        for lang in ("he", "ar", "en"):
            self.assertTrue(coach.PERSONALIZATION_STYLE.get(lang, "").strip())

    def test_guidance_triggers_are_the_help_moments(self) -> None:
        self.assertEqual(
            coach._PERSONALIZATION_TRIGGERS,
            {"idle", "mistake", "slow_progress", "misconception", "wheel_spinning"},
        )
        # Warmth-only nudges must NOT force the personalization line.
        self.assertNotIn("success", coach._PERSONALIZATION_TRIGGERS)
        self.assertNotIn("question_intro", coach._PERSONALIZATION_TRIGGERS)


if __name__ == "__main__":
    unittest.main()
