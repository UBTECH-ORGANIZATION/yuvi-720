"""Three learners, one unit, three different journeys.

The ministry reviews the platform on 13/8/2026 by walking a struggling, a middle
and an excellent persona through the one live Kata unit and checking that
"תהליך הלמידה מותאם למאפייני התלמיד". Before the path engine they would have
seen three identical routes, because every surface walked `order` linearly.

The fixture is frozen from the live catalog (`methodica-science-mass-measure-01`)
so these assertions are about real provider metadata, not a convenient invention:
component ‑02 is the only optional one (`isRequired: false`) and it is also the
only one carrying `recommendedAfterFail`, and ‑05 is the unit's assessment.
"""

from __future__ import annotations

import json
import unittest
from copy import deepcopy
from pathlib import Path

from app.services import learning_path

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "unit_mass_measure.json").read_text(encoding="utf-8")
)
UNIT_ID = FIXTURE["id"]
C1, C2, C3, C4, C5 = (f"{UNIT_ID}-0{n}" for n in range(1, 6))


def completion(component_id: str, *, success: bool = True, scaled: float | None = None,
               event_id: str = "") -> dict:
    """A COMPONENT-level xAPI `completed`, the only kind that settles a node."""
    return {
        "verb": "completed",
        "launch": component_id,
        "object_id": component_id,
        "unit_id": UNIT_ID,
        "_id": event_id or f"evt-{component_id}",
        "result": {"success": success, "score_scaled": scaled},
    }


def selected(category: str, response: str) -> dict:
    return {"verb": "selected", "launch": C2, "unit_id": UNIT_ID,
            "selection_category": category, "response": response}


def brain_for(**mastery) -> dict:
    return {
        "mastery": {FIXTURE["objective_id"]: mastery},
        "current_state": {},
        "behavior_signals": mastery.pop("_signals", []) if "_signals" in mastery else [],
    }


STRUGGLING = {
    "score_ewma": 0.28, "confidence": 0.30, "consecutive_successes": 0,
    "failures": 3, "level": "basic",
}
MIDDLE = {
    "score_ewma": 0.62, "confidence": 0.35, "consecutive_successes": 1,
    "failures": 1, "level": "basic",
}
EXCELLENT = {
    "score_ewma": 0.91, "confidence": 0.78, "consecutive_successes": 4,
    "failures": 0, "level": "intermediate", "achieved": True,
}


def plan(mastery: dict, events: list[dict], *, signals: list[str] | None = None,
         pointer: str | None = None) -> dict:
    brain = {
        "mastery": {FIXTURE["objective_id"]: dict(mastery)},
        "behavior_signals": [{"type": s} for s in (signals or [])],
        "current_state": {"unit_id": UNIT_ID, "component_id": pointer} if pointer else {},
    }
    return learning_path.project(deepcopy(FIXTURE), brain, events)


def on_path_ids(projected: dict) -> list[str]:
    return [n["component_id"] for n in projected["components"] if n["on_path"]]


def node(projected: dict, component_id: str, visit: int = 1) -> dict:
    return next(n for n in projected["components"]
                if n["component_id"] == component_id and n["visit"] == visit)


class ThreePersonasTests(unittest.TestCase):
    """The 13/8 acceptance contract: three profiles, three visibly different paths."""

    def setUp(self) -> None:
        self.struggling = plan(
            STRUGGLING,
            [completion(C1, scaled=0.5), completion(C2, success=False, scaled=0.64)],
            signals=["wheel_spinning"],
        )
        self.middle = plan(MIDDLE, [completion(C1, scaled=0.7)])
        self.excellent = plan(EXCELLENT, [completion(C1, scaled=0.95)])

    def test_the_three_paths_are_different_lengths(self) -> None:
        totals = [p["steps_total"] for p in (self.struggling, self.middle, self.excellent)]
        self.assertEqual(totals, [6, 5, 4])

    def test_the_three_routes_are_pairwise_different(self) -> None:
        routes = [tuple(on_path_ids(p)) for p in (self.struggling, self.middle, self.excellent)]
        self.assertEqual(len(set(routes)), 3, routes)

    def test_struggling_gets_the_providers_repair_round(self) -> None:
        """‑02 failed at 0.64 and our profile agrees, so `recommendedAfterFail`
        puts ‑01 back on the path as a second visit — and that is what comes next."""
        self.assertEqual(node(self.struggling, C2)["outcome"], "failed")
        repair = node(self.struggling, C1, visit=2)
        self.assertTrue(repair["on_path"])
        self.assertEqual(repair["progress_reason"]["code"], "recovery_after_fail")
        self.assertEqual(self.struggling["next_component_id"], C1)
        self.assertEqual(self.struggling["next_path_node_id"], f"{C1}#2")
        self.assertEqual(on_path_ids(self.struggling), [C1, C2, C1, C3, C4, C5])

    def test_excellent_skips_the_optional_stage(self) -> None:
        skipped = node(self.excellent, C2)
        self.assertFalse(skipped["on_path"])
        self.assertEqual(skipped["progress_state"], "skipped")
        self.assertEqual(skipped["progress_reason"]["code"], "optional_skipped")
        self.assertEqual(self.excellent["next_component_id"], C3)

    def test_middle_keeps_the_optional_stage(self) -> None:
        kept = node(self.middle, C2)
        self.assertTrue(kept["on_path"])
        self.assertEqual(kept["progress_reason"]["code"], "optional_kept")

    def test_path_index_is_contiguous_and_ordinals_are_server_owned(self) -> None:
        for projected in (self.struggling, self.middle, self.excellent):
            indexes = [n["path_index"] for n in projected["components"] if n["on_path"]]
            self.assertEqual(indexes, list(range(len(indexes))))
            self.assertTrue(all(n["path_index"] is None
                                for n in projected["components"] if not n["on_path"]))

    def test_no_mastery_level_reaches_the_learner_payload(self) -> None:
        """§2 — 'רמות השליטה אינן מוצגות ללומד'. The words must not survive
        serialization of what we send to a learner."""
        from app.services.learning_progress import strip_internal
        for projected in (self.struggling, self.middle, self.excellent):
            payload = json.dumps(strip_internal(projected), ensure_ascii=False)
            for word in ("basic", "intermediate", "advanced"):
                self.assertNotIn(word, payload, f"{word} leaked into the learner payload")

    def test_progress_is_reported_as_a_ratio_not_a_count_the_learner_must_read(self) -> None:
        self.assertEqual(self.struggling["steps_completed"], 2)
        self.assertAlmostEqual(self.struggling["progress_ratio"], 2 / 6, places=3)
        self.assertEqual(self.excellent["unit_state"], "in_progress")


class RemediationJudgementTests(unittest.TestCase):
    """`success` is the provider's call; whether we act on it is ours."""

    def test_a_strong_learner_failing_at_0_8_is_not_sent_back(self) -> None:
        """This unit's content reports `success: false` at 0.8. Routing a
        confident learner back through easier material on that basis would
        punish a good result."""
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     completion(C2, success=False, scaled=0.8)])
        self.assertIsNone(next((n for n in projected["components"]
                                if n["component_id"] == C1 and n["visit"] == 2), None))
        self.assertEqual(projected["next_component_id"], C3)

    def test_a_weak_learner_failing_at_0_8_is_sent_back(self) -> None:
        projected = plan(STRUGGLING, [completion(C1, scaled=0.4),
                                      completion(C2, success=False, scaled=0.8)],
                         signals=["wheel_spinning"])
        self.assertEqual(node(projected, C1, visit=2)["progress_reason"]["code"],
                         "recovery_after_fail")

    def test_a_repair_round_cannot_repeat_forever(self) -> None:
        """A provider re-reporting `success: false` must not grow the path without
        bound — one repair per failing component."""
        events = [completion(C1, scaled=0.4),
                  completion(C2, success=False, scaled=0.3, event_id="f1"),
                  completion(C1, scaled=0.45, event_id="r1"),
                  completion(C2, success=False, scaled=0.35, event_id="f2")]
        projected = plan(STRUGGLING, events)
        visits = [n["visit"] for n in projected["components"] if n["component_id"] == C1]
        self.assertLessEqual(max(visits), learning_path.MAX_VISITS)


class LearnerAgencyTests(unittest.TestCase):
    """720 §1 פעלנות — the learner's own word outranks their profile."""

    def test_i_did_not_understand_blocks_the_skip(self) -> None:
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     selected("is-understood", "false")])
        self.assertTrue(node(projected, C2)["on_path"])
        self.assertEqual(node(projected, C2)["progress_reason"]["code"], "optional_kept")

    def test_asking_for_more_practice_blocks_the_skip(self) -> None:
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     selected("practice-decision", "true")])
        self.assertTrue(node(projected, C2)["on_path"])

    def test_our_own_affordance_carries_the_same_weight(self) -> None:
        """The "אני רוצה עוד תרגול" button in the completion dialog records a
        `path_choice`; it must feed the same rule as the provider's report."""
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     {"verb": "path_choice", "unit_id": UNIT_ID,
                                      "launch": C2, "response": "more_practice"}])
        self.assertTrue(node(projected, C2)["on_path"])


class StabilityTests(unittest.TestCase):
    """Nothing is persisted, so the plan has to be stable by construction."""

    def test_the_same_input_twice_gives_an_identical_plan(self) -> None:
        events = [completion(C1, scaled=0.5), completion(C2, success=False, scaled=0.64)]
        first = plan(STRUGGLING, events)
        second = plan(STRUGGLING, events)
        self.assertEqual(json.dumps(first, sort_keys=True, default=str),
                         json.dumps(second, sort_keys=True, default=str))

    def test_improving_mastery_never_retro_skips_finished_work(self) -> None:
        """The frozen prefix: a stage with evidence is materialised from events,
        so a learner who improves mid-unit does not watch their history renumber."""
        events = [completion(C1, scaled=0.5), completion(C2, scaled=0.9)]
        after = plan(EXCELLENT, events)
        self.assertTrue(node(after, C2)["on_path"])
        self.assertEqual(on_path_ids(after)[:2], [C1, C2])

    def test_a_settled_failure_is_reopened_not_erased(self) -> None:
        projected = plan(STRUGGLING, [completion(C1, scaled=0.5),
                                      completion(C2, success=False, scaled=0.64)])
        failed = node(projected, C2)
        self.assertEqual(failed["progress_state"], "available")
        self.assertNotEqual(failed["progress_state"], "locked")


class AssessmentGateTests(unittest.TestCase):
    """§3.3 — the assessment is withheld until there is practice behind it, and
    passing it ends the unit."""

    def test_the_assessment_is_gated_for_a_learner_with_no_practice_behind_them(self) -> None:
        projected = plan(STRUGGLING, [completion(C1, scaled=0.3)])
        gate = node(projected, C5)
        self.assertEqual(gate["progress_state"], "locked")
        self.assertEqual(gate["progress_reason"]["code"], "assessment_gated")
        self.assertTrue(gate["on_path"], "a gated assessment is still part of the path")

    def test_passing_the_assessment_ends_the_unit(self) -> None:
        events = [completion(C1, scaled=0.9), completion(C2, scaled=0.9),
                  completion(C3, scaled=0.9), completion(C4, scaled=0.9),
                  completion(C5, scaled=1.0)]
        projected = plan(EXCELLENT, events)
        self.assertEqual(projected["unit_state"], "completed")
        self.assertIsNone(projected["next_component_id"])

    def test_a_passed_assessment_cuts_the_rest_of_the_unit_short(self) -> None:
        """Synthetic: an assessment in the middle of a unit. Passing it means the
        learner does not owe the remaining stages (§3.3)."""
        unit = deepcopy(FIXTURE)
        for component in unit["components"]:
            component["is_assessment"] = component["id"] == C3
        brain = {"mastery": {unit["objective_id"]: dict(EXCELLENT)}, "current_state": {}}
        projected = learning_path.project(
            unit, brain,
            [completion(C1, scaled=0.9), completion(C3, scaled=1.0)],
        )
        self.assertEqual(projected["unit_state"], "completed")
        for later in (C4, C5):
            self.assertEqual(node(projected, later)["progress_state"], "skipped")
            self.assertEqual(node(projected, later)["progress_reason"]["code"],
                             "unit_completed_by_assessment")


class EquivalentsTests(unittest.TestCase):
    """§3.1 — same-`order` components are interchangeable; pick by learner fit."""

    def _unit_with_equivalents(self) -> dict:
        unit = deepcopy(FIXTURE)
        easy = deepcopy(unit["components"][0])
        easy.update({"id": f"{C1}-easy", "relative_difficulty": 1, "mastery_level": "basic"})
        hard = deepcopy(unit["components"][0])
        hard.update({"id": f"{C1}-hard", "relative_difficulty": 5, "mastery_level": "advanced"})
        unit["components"] = [easy, hard] + unit["components"][1:]
        return unit

    def test_the_band_picks_the_rung_and_the_others_stay_open(self) -> None:
        unit = self._unit_with_equivalents()
        for mastery, expected in ((STRUGGLING, f"{C1}-easy"), (EXCELLENT, f"{C1}-hard")):
            brain = {"mastery": {unit["objective_id"]: dict(mastery)}, "current_state": {}}
            projected = learning_path.project(deepcopy(unit), brain, [])
            chosen = [n for n in projected["components"] if n["on_path"]][0]
            self.assertEqual(chosen["component_id"], expected)
            other = node(projected, f"{C1}-hard" if expected.endswith("easy") else f"{C1}-easy")
            self.assertFalse(other["on_path"])
            self.assertEqual(other["progress_state"], "available",
                             "an alternative must stay launchable, or it 409s")

    def test_it_still_works_when_the_provider_omits_masteryLevel(self) -> None:
        """`masteryLevel` is not mandatory in תשפ"ז — the choice must fall through
        to `relativeDifficulty` alone."""
        unit = self._unit_with_equivalents()
        for component in unit["components"]:
            component.pop("mastery_level", None)
        brain = {"mastery": {unit["objective_id"]: dict(STRUGGLING)}, "current_state": {}}
        projected = learning_path.project(unit, brain, [])
        self.assertEqual([n for n in projected["components"] if n["on_path"]][0]["component_id"],
                         f"{C1}-easy")


class FallbackTests(unittest.TestCase):
    """A planning bug must never block a learner."""

    def test_a_unit_with_no_order_falls_back_to_the_linear_walk(self) -> None:
        unit = deepcopy(FIXTURE)
        for component in unit["components"]:
            component.pop("order", None)
        projected = learning_path.project(unit, {"mastery": {}, "current_state": {}}, [])
        self.assertEqual(projected["path_strategy"], "linear_fallback")
        self.assertEqual(projected["steps_total"], 5)

    def test_a_closed_single_component_unit_is_left_to_the_provider(self) -> None:
        """§3.2 — the platform never sequences inside a closed unit."""
        unit = deepcopy(FIXTURE)
        unit["components"] = unit["components"][:1]
        projected = learning_path.project(unit, {"mastery": {}, "current_state": {}}, [])
        self.assertEqual(projected["path_strategy"], "linear_fallback")

    def test_a_planner_exception_falls_back_instead_of_raising(self) -> None:
        original = learning_path.plan_unit_path
        learning_path.plan_unit_path = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        try:
            projected = learning_path.project(deepcopy(FIXTURE), {"mastery": {}}, [])
        finally:
            learning_path.plan_unit_path = original
        self.assertEqual(projected["path_strategy"], "linear_fallback")


class BrainPointerTests(unittest.TestCase):
    """The second engine dies here: `current_state.component_id` is a hint."""

    def test_a_pointer_inside_the_plan_is_honoured(self) -> None:
        projected = plan(MIDDLE, [completion(C1, scaled=0.7)], pointer=C2)
        self.assertEqual(node(projected, C2)["progress_state"], "current")

    def test_a_pointer_that_runs_ahead_of_the_plan_is_ignored(self) -> None:
        """`pedagogical` used to write this field and the roadmap painted it as
        `current`, so the two could disagree on screen."""
        projected = plan(MIDDLE, [completion(C1, scaled=0.7)], pointer=C5)
        self.assertEqual(node(projected, C2)["progress_state"], "current")
        self.assertEqual(projected["next_component_id"], C2)


if __name__ == "__main__":
    unittest.main()
