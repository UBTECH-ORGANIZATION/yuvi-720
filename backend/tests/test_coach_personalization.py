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

        self.assertEqual(bundle["profile"]["interests"], ["כדורגל"])
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

    async def test_bundle_resolves_provider_item_metadata_and_timing_evidence(self) -> None:
        scoped_view = {
            "identity": {"locale": "en"},
            "profile": {},
            "goals": [],
            "current_state": {
                "unit_id": "provider-unit",
                "component_id": "provider-component",
                "resume_token": {"step": 1},
            },
        }
        provider_unit = {"id": "provider-unit", "title": "Vertical angles", "objective_id": "angles"}
        provider_component = {
            "id": "provider-component",
            "information_to_bot": "Compare opposite angles at one intersection.",
        }
        recent = [{
            "verb": "answered",
            "launch": "provider-component",
            "object_id": "provider-item#q2",
            "question_id": "q2",
            "result": {"success": False},
            "timing": {"elapsed_since_previous_seconds": 181.0, "quality": "elapsed_between_events"},
        }]
        with (
            patch("app.brain.context_engine.view_for", new=AsyncMock(return_value=scoped_view)),
            patch("app.brain.curriculum.get_component", return_value=None),
            patch(
                "app.services.content_provider.resolve_component",
                new=AsyncMock(return_value=(provider_unit, provider_component)),
            ),
            patch("app.services.events.get_recent_events", new=AsyncMock(return_value=recent)),
        ):
            bundle = await build_coach_bundle("learner-pseudonym", {"screen": "learning_lesson"})

        self.assertEqual(bundle["current"]["objective_title"], "Vertical angles")
        self.assertIn("opposite angles", bundle["current"]["informationToBot"])
        self.assertEqual(bundle["current"]["recent_events"][0]["question_id"], "q2")
        rendered = _render_context(bundle)
        self.assertIn("elapsed_seconds=181.0", rendered)
        self.assertIn("timing_quality=elapsed_between_events", rendered)

    def test_coach_scope_declares_every_brain_field_used_by_bundle(self) -> None:
        reads = set(AGENT_VIEWS["coach"]["read"])
        expected = {
            "identity.locale", "profile.interests",
            "profile.characteristics", "profile.learning_style",
            "profile.preferences", "profile.environment", "strengths",
            "challenges", "strategies", "goals", "current_state",
            "teacher_directives",
        }
        self.assertTrue(expected.issubset(reads))
        # B-4: activeness IS projected server-side, but only to derive verbal
        # coaching hints — the raw 0-100 scores must never reach a prompt.
        self.assertIn("profile.activeness", reads)
        self.assertIn("mastery", reads)
        self.assertIn("student_description", reads)
        self.assertNotIn("identity.display_name", reads)

    def test_activeness_scores_never_rendered_into_prompt(self) -> None:
        from app.brain.context_engine import _activeness_hints
        hints = _activeness_hints(
            {"self_regulation": 23, "motivation_relevance": 31, "growth_mindset": 80}, "he"
        )
        self.assertEqual(len(hints), 2)
        for hint in hints:
            self.assertNotRegex(hint, r"\d")   # verbal guidance only, no numbers


if __name__ == "__main__":
    unittest.main()