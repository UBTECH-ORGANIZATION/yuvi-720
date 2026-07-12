"""Coach Context regression tests: adaptation without PII or raw scores."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.agents.coach import _render_context
from app.brain.context_engine import AGENT_VIEWS, build_coach_bundle


class CoachPersonalizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_bundle_uses_scoped_non_identifying_adaptation_signals(self) -> None:
        scoped_view = {
            "identity": {"locale": "he"},
            "profile": {
                "interests": ["כדורגל"],
                "hobbies": ["ציור"],
                "characteristics": ["אוהב/ת לנסות לבד"],
                "learning_style": "הסבר חזותי בצעדים קצרים",
                "preferences": ["משוב מיידי"],
                "environment": "סביבה שקטה",
            },
            "strengths": [{"label": "סקרנות"}],
            "challenges": [{"label": "לשמור על ריכוז"}],
            "strategies": [
                {"note": "דוגמה חזותית לפני הנוסחה", "confidence": 0.8},
                {"note": "לא להשתמש", "confidence": 0.2},
            ],
            "goals": [{"text": "לתרגל זוויות", "visible_to_learner": True}],
            "current_state": {
                "component_id": "YuviDori-math-angles-0001-lesson",
                "resume_token": {"step": 2},
                "pace": "on_track",
            },
            "teacher_directives": [{
                "text": "לתת דוגמה חזותית",
                "scope": "objective:math-angles",
                "expires_at": None,
            }],
        }
        recent = [{"verb": "answered", "result": {"success": False}, "misconception": "זוויות מתחלפות"}]
        with (
            patch("app.brain.context_engine.view_for", new=AsyncMock(return_value=scoped_view)),
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=recent)),
            patch("app.services.content_catalog.information_to_bot", return_value="להבחין בין סוגי זוויות"),
        ):
            bundle = await build_coach_bundle(
                "learner-pseudonym", {"screen": "student_dashboard"}
            )

        self.assertEqual(bundle["profile"]["interests"], ["כדורגל", "ציור"])
        self.assertEqual(bundle["strategies"], ["דוגמה חזותית לפני הנוסחה"])
        self.assertEqual(bundle["teacher_guidance"], ["לתת דוגמה חזותית"])
        rendered = _render_context(bundle)
        for expected in ("משוב מיידי", "סקרנות", "לשמור על ריכוז", "זוויות מתחלפות"):
            self.assertIn(expected, rendered)
        self.assertIn("current_screen: student_dashboard", rendered)
        self.assertIn("open_learning_task: resume_available", rendered)
        self.assertIn("סוגי זוויות והגדרות", rendered)
        self.assertNotIn("activeness", rendered)
        self.assertNotIn("display_name", rendered)
        self.assertNotIn("0.8", rendered)

    async def test_bundle_rejects_unbounded_screen_context(self) -> None:
        scoped_view = {
            "identity": {"locale": "en"},
            "profile": {},
            "goals": [],
            "current_state": {},
        }
        with (
            patch("app.brain.context_engine.view_for", new=AsyncMock(return_value=scoped_view)),
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=[])),
        ):
            bundle = await build_coach_bundle(
                "learner-pseudonym", {"screen": "<script>arbitrary page text</script>"}
            )

        self.assertEqual(bundle["surface"]["screen"], "unknown")
        self.assertEqual(bundle["surface"]["visible_areas"], [])

    def test_coach_scope_declares_every_brain_field_used_by_bundle(self) -> None:
        reads = set(AGENT_VIEWS["coach"]["read"])
        expected = {
            "identity.locale", "profile.interests", "profile.hobbies",
            "profile.characteristics", "profile.learning_style",
            "profile.preferences", "profile.environment", "strengths",
            "challenges", "strategies", "goals", "current_state",
            "teacher_directives",
        }
        self.assertTrue(expected.issubset(reads))
        self.assertNotIn("profile.activeness", reads)
        self.assertNotIn("identity.display_name", reads)


if __name__ == "__main__":
    unittest.main()