"""Adaptive within-unit component picker (720 §3.2) tests.

Uses a synthetic multi-difficulty objective (staging has only one objective /
five components, so the live catalog can't exercise sequencing). Asserts the
mastery-level path, same-`order` equivalent selection, difficulty match,
assessment-readiness gate, skip-ahead, and closed-unit no-pick.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import content_catalog

OBJ = "MOE.SCI.G7.CHEM.DEMO.OBJ"


def comp(cid, order, *, difficulty=3, level="basic", purpose="practice",
         assessment=False, required=True):
    return {
        "id": cid, "unit_id": "unit-demo", "objective_id": OBJ, "subject": "science",
        "order": order, "relative_difficulty": difficulty, "mastery_level": level,
        "purpose": purpose, "is_assessment": assessment, "is_required": required,
        "languages": ["he"], "recommended_after_fail": [], "information_by_item": {},
    }


# A unit: order1 intro; order2 has TWO equivalents (easy + hard); order3 practice;
# order4 the assessment.
UNIT = [
    comp("intro", 1, difficulty=1, level="basic", purpose="instruction"),
    comp("prac-easy", 2, difficulty=2, level="basic", purpose="practice"),
    comp("prac-hard", 2, difficulty=4, level="intermediate", purpose="practice"),
    comp("prac-more", 3, difficulty=3, level="intermediate", purpose="practice"),
    comp("assess", 4, difficulty=5, level="advanced", purpose="both", assessment=True),
]


def pick(entry, *, completed=frozenset(), signals=None):
    with patch("app.services.content_catalog.kata_catalog.components_for", return_value=UNIT):
        return content_catalog.select_component(
            OBJ, mastery_entry=entry, completed_ids=completed, signals=signals or {}, locale="he",
        )


class ComponentPickerTests(unittest.TestCase):
    def test_fresh_learner_starts_at_the_intro(self) -> None:
        c = pick({})
        self.assertEqual(c["id"], "intro")

    def test_struggling_learner_gets_the_easy_equivalent_at_the_stage(self) -> None:
        # intro done; order-2 stage has an easy + a hard equivalent → easy wins.
        c = pick({"score_ewma": 0.3, "failures": 2, "consecutive_successes": 0},
                 completed={"intro"})
        self.assertEqual(c["id"], "prac-easy")
        self.assertEqual(c["_band"], "struggling")

    def test_confident_learner_gets_hard_equivalent_and_skips_intro(self) -> None:
        # Confident + intro NOT completed → skip-ahead drops the instruction intro,
        # and at the order-2 stage the harder equivalent is chosen.
        c = pick({"score_ewma": 0.85, "confidence": 0.7, "consecutive_successes": 3,
                  "level": "intermediate"})
        self.assertEqual(c["id"], "prac-hard")
        self.assertEqual(c["_band"], "confident")

    def test_assessment_gated_until_ready(self) -> None:
        # Only the assessment remains, learner NOT ready (no streak/score) → the
        # gate still returns it (can't withhold forever) but flags practice-first
        # when practice exists. Here practice is done, so it surfaces the assessment.
        c = pick({"score_ewma": 0.3, "consecutive_successes": 0},
                 completed={"intro", "prac-easy", "prac-hard", "prac-more"})
        self.assertEqual(c["id"], "assess")

    def test_assessment_withheld_while_practice_remains_and_not_ready(self) -> None:
        # Not ready, but a practice component is still available → the gate routes
        # to practice, never the assessment.
        c = pick({"score_ewma": 0.35, "consecutive_successes": 0},
                 completed={"intro", "prac-easy", "prac-hard"})
        self.assertEqual(c["id"], "prac-more")
        self.assertFalse(c["is_assessment"])

    def test_ready_learner_may_reach_assessment_over_remaining_practice(self) -> None:
        # Ready (streak≥2) with practice remaining: the assessment shares no stage
        # with prac-more (order 3 vs 4), so the earliest stage (practice) is taken —
        # readiness *allows* the assessment but order still sequences first.
        c = pick({"consecutive_successes": 3, "score_ewma": 0.8, "confidence": 0.6},
                 completed={"intro", "prac-easy", "prac-hard"})
        self.assertIn(c["id"], {"prac-more"})  # still walks order before the test

    def test_all_complete_returns_none(self) -> None:
        c = pick({"achieved": True},
                 completed={"intro", "prac-easy", "prac-hard", "prac-more", "assess"})
        self.assertIsNone(c)

    def test_closed_unit_single_component_returns_it(self) -> None:
        single = [comp("only", 1, purpose="both")]
        with patch("app.services.content_catalog.kata_catalog.components_for", return_value=single):
            c = content_catalog.select_component(OBJ, mastery_entry={}, locale="he")
        self.assertEqual(c["id"], "only")

    def test_signals_helpers(self) -> None:
        brain = {
            "current_state": {"pace": "behind"},
            "behavior_signals": [{"type": "answer_cycling"}, {"type": "wheel_spinning"}],
        }
        sig = content_catalog.learner_signals(brain)
        self.assertTrue(sig["answer_cycling"] and sig["wheel_spinning"])
        self.assertEqual(sig["pace"], "behind")
        done = content_catalog.completed_component_ids([
            {"verb": "completed", "launch": "a", "result": {"success": True}},
            {"verb": "completed", "launch": "b", "result": {"success": False}},  # failed → not done
            {"verb": "answered", "launch": "c"},
        ])
        self.assertEqual(done, {"a"})


if __name__ == "__main__":
    unittest.main()
