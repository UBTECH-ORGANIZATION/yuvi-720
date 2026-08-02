"""Every kind of learner we can describe, walked through the live unit.

`test_learning_path.py` pins the three personas the ministry will run on 13/8.
This file is the wider net: the learners who are not one of those three, and the
states a real classroom produces — a rapid guesser, a learner who came back after
a month, one who says they did not understand, one who fails the assessment, one
whose provider metadata is half-filled, one on a locale the unit does not serve.

The rule under all of it: a learner is only ever routed on EVIDENCE. Nothing here
asserts a number the learner would see, because they are shown none (720 §2, §3.4).
"""

from __future__ import annotations

import json
import unittest
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.services import learning_path
from app.services.learning_progress import strip_internal

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "unit_mass_measure.json").read_text(encoding="utf-8")
)
UNIT_ID = FIXTURE["id"]
OBJECTIVE_ID = FIXTURE["objective_id"]
C1, C2, C3, C4, C5 = (f"{UNIT_ID}-0{n}" for n in range(1, 6))


def completion(component_id: str, *, success: bool = True, scaled: float | None = None,
               event_id: str = "") -> dict:
    return {
        "verb": "completed", "launch": component_id, "object_id": component_id,
        "unit_id": UNIT_ID, "_id": event_id or f"evt-{component_id}",
        "result": {"success": success, "score_scaled": scaled},
    }


def screen_completion(component_id: str, screen: str) -> dict:
    """A PER-SCREEN `completed`. Kata emits these constantly; treating one as a
    component verdict would inject repair rounds mid-lesson."""
    return {
        "verb": "completed", "launch": component_id,
        "object_id": f"{component_id}-{screen}", "sub_item_id": f"{component_id}-{screen}",
        "unit_id": UNIT_ID, "_id": f"evt-screen-{component_id}-{screen}",
        "result": {"success": False, "score_scaled": 0.1},
    }


def plan(mastery: dict, events: list[dict], *, signals: list[str] | None = None,
         locale: str = "he", unit: dict | None = None, brain_extra: dict | None = None) -> dict:
    brain = {
        "mastery": {OBJECTIVE_ID: dict(mastery)},
        "behavior_signals": [{"type": s} for s in (signals or [])],
        "current_state": {},
        **(brain_extra or {}),
    }
    return learning_path.project(deepcopy(unit or FIXTURE), brain, events, locale=locale)


def route(projected: dict) -> list[str]:
    return [n["component_id"] for n in projected["components"] if n["on_path"]]


def node(projected: dict, component_id: str, visit: int = 1) -> dict:
    return next(n for n in projected["components"]
                if n["component_id"] == component_id and n["visit"] == visit)


FRESH: dict = {}
STRUGGLING = {"score_ewma": 0.28, "confidence": 0.30, "consecutive_successes": 0,
              "failures": 3, "level": "basic"}
MIDDLE = {"score_ewma": 0.62, "confidence": 0.35, "consecutive_successes": 1,
          "failures": 1, "level": "basic"}
EXCELLENT = {"score_ewma": 0.91, "confidence": 0.78, "consecutive_successes": 4,
             "failures": 0, "level": "intermediate", "achieved": True}


class FreshLearnerTests(unittest.TestCase):
    """Nobody starts mid-path."""

    def test_a_learner_with_no_evidence_starts_at_the_first_station(self) -> None:
        projected = plan(FRESH, [])
        self.assertEqual(projected["next_component_id"], C1)
        self.assertEqual(projected["unit_state"], "not_started")
        self.assertEqual(projected["progress_ratio"], 0.0)

    def test_a_fresh_learner_keeps_the_optional_stage(self) -> None:
        """Skipping work for someone we know nothing about is a guess, not
        adaptation."""
        self.assertIn(C2, route(plan(FRESH, [])))

    def test_a_fresh_learner_cannot_walk_into_the_assessment(self) -> None:
        self.assertEqual(node(plan(FRESH, []), C5)["progress_state"], "locked")


class BehaviourSignalTests(unittest.TestCase):
    """Signals are global, so they differentiate from the very first component."""

    def test_a_rapid_guesser_is_read_as_struggling_even_with_no_mastery_yet(self) -> None:
        projected = plan(FRESH, [], signals=["rapid_guessing"])
        self.assertIn(C2, route(projected), "a struggling learner keeps the extra practice")

    def test_a_wheel_spinner_gets_the_repair_round_at_a_score_that_would_pass(self) -> None:
        projected = plan(FRESH, [completion(C1, scaled=0.5),
                                 completion(C2, success=False, scaled=0.85)],
                         signals=["wheel_spinning"])
        self.assertEqual(node(projected, C1, visit=2)["progress_reason"]["code"],
                         "recovery_after_fail")

    def test_answer_cycling_counts_the_same_as_the_other_struggle_signals(self) -> None:
        self.assertEqual(learning_path.band_for({}, {"answer_cycling": True}), "struggling")


class ReturningLearnerTests(unittest.TestCase):
    """Coming back is its own state — not a fresh start and not a continuation."""

    def _lapsed(self) -> dict:
        return {**EXCELLENT, "review_due": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}

    def test_a_lapsed_skill_gets_a_revisit_once_the_unit_is_walked(self) -> None:
        """Spaced review is for a learner with nothing new left — and it revisits
        the LAST station they settled, not the first."""
        events = [completion(C1, scaled=0.9), completion(C2, scaled=0.9),
                  completion(C3, scaled=0.9), completion(C4, scaled=0.9),
                  completion(C5, success=False, scaled=0.5)]
        projected = plan(self._lapsed(), events)
        revisit = node(projected, C5, visit=2)
        self.assertEqual(revisit["progress_reason"]["code"], "review_revisit")

    def test_a_lapsed_learner_mid_unit_is_sent_FORWARD_not_back(self) -> None:
        """Live regression (learner `gal`, 30/07): one component-level failure at
        0.64 set `needs_review` on a goal already `achieved` by streak, and the
        revisit rewound them to station 1 of a unit they were part-way through —
        so "continue learning" reopened the lesson they had just done. A lapsed
        flag is not a reason to lose someone's place."""
        projected = plan(self._lapsed(), [completion(C1, success=False, scaled=0.64)])
        self.assertEqual(projected["next_component_id"], C2)
        self.assertIsNone(next((n for n in projected["components"]
                                if n["component_id"] == C1 and n["visit"] == 2), None))

    def test_a_learner_due_for_review_does_not_get_work_skipped(self) -> None:
        """Their record says they were strong; the review window says we should
        check rather than assume."""
        projected = plan(self._lapsed(), [completion(C1, scaled=0.9)])
        self.assertIn(C2, route(projected))

    def test_needs_review_after_a_late_failure_blocks_the_skip_too(self) -> None:
        projected = plan({**EXCELLENT, "needs_review": True}, [completion(C1, scaled=0.9)])
        self.assertIn(C2, route(projected))
        self.assertTrue(node(projected, C2)["on_path"])

    def test_a_revisit_is_never_inserted_twice(self) -> None:
        events = [completion(C1, scaled=0.9, event_id="a"), completion(C1, scaled=0.9, event_id="b")]
        projected = plan(self._lapsed(), events)
        visits = [n["visit"] for n in projected["components"] if n["component_id"] == C1]
        self.assertLessEqual(max(visits), learning_path.MAX_VISITS)


class SelfReportTests(unittest.TestCase):
    """720 §1 — the learner's own word about their learning outranks our profile."""

    def _selected(self, category: str, response: str) -> dict:
        return {"verb": "selected", "launch": C1, "unit_id": UNIT_ID,
                "selection_category": category, "response": response}

    def test_saying_they_understood_does_not_by_itself_skip_anything(self) -> None:
        """Agency cuts one way: it can ADD work, never remove work they have not
        shown they can skip."""
        projected = plan(MIDDLE, [completion(C1, scaled=0.7),
                                  self._selected("is-understood", "true")])
        self.assertIn(C2, route(projected))

    def test_asking_to_repeat_keeps_the_optional_stage(self) -> None:
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     self._selected("is-repeat", "true")])
        self.assertIn(C2, route(projected))

    def test_a_camelCase_category_is_read_the_same_as_the_hyphenated_one(self) -> None:
        """Providers send both spellings; a routing rule must not depend on which."""
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     self._selected("isUnderstood", "false")])
        self.assertIn(C2, route(projected))

    def test_a_learning_type_choice_is_not_mistaken_for_a_self_report(self) -> None:
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95),
                                     self._selected("learning-type", "video")])
        self.assertNotIn(C2, route(projected), "a representation choice says nothing about mastery")


class EvidenceHygieneTests(unittest.TestCase):
    """What must NOT be read as a component verdict."""

    def test_a_per_screen_completed_never_injects_a_repair_round(self) -> None:
        projected = plan(STRUGGLING, [completion(C1, scaled=0.5),
                                      screen_completion(C2, "001")])
        self.assertIsNone(next((n for n in projected["components"]
                                if n["component_id"] == C1 and n["visit"] == 2), None))

    def test_a_per_screen_completed_does_not_settle_the_component(self) -> None:
        projected = plan(FRESH, [screen_completion(C1, "001")])
        self.assertEqual(node(projected, C1)["outcome"], None)
        self.assertEqual(projected["next_component_id"], C1)

    def test_an_event_for_a_component_outside_the_unit_is_ignored(self) -> None:
        projected = plan(FRESH, [completion("some-other-unit-01", scaled=0.9)])
        self.assertEqual(projected["next_component_id"], C1)

    def test_a_completion_with_no_score_still_settles_the_station(self) -> None:
        """A closed component may report only that it finished (§3.2)."""
        projected = plan(FRESH, [completion(C1, scaled=None)])
        self.assertEqual(node(projected, C1)["outcome"], "passed")


class AssessmentTests(unittest.TestCase):
    def test_failing_the_assessment_does_not_end_the_unit(self) -> None:
        events = [completion(C1, scaled=0.6), completion(C2, scaled=0.6),
                  completion(C3, scaled=0.6), completion(C4, scaled=0.6),
                  completion(C5, success=False, scaled=0.3)]
        projected = plan(MIDDLE, events)
        self.assertNotEqual(projected["unit_state"], "completed")
        self.assertEqual(node(projected, C5)["outcome"], "failed",
                         "the failure is a fact and stays on the record")
        # They are standing on the thing they did not pass, and it is open — the
        # launch gate refuses only `locked`. Reporting the unit complete here (as
        # it did before) told a learner they had finished by failing.
        self.assertEqual(node(projected, C5)["progress_state"], "current")
        self.assertEqual(projected["next_component_id"], C5)

    def test_the_gate_opens_when_the_assessment_is_all_that_is_left(self) -> None:
        """Withholding it forever would strand a learner with nothing to do."""
        events = [completion(C1, scaled=0.5), completion(C2, scaled=0.5),
                  completion(C3, scaled=0.5), completion(C4, scaled=0.5)]
        projected = plan(STRUGGLING, events)
        self.assertEqual(projected["next_component_id"], C5)
        self.assertEqual(node(projected, C5)["progress_state"], "current")

    def test_a_ready_learner_still_walks_the_order_to_reach_it(self) -> None:
        projected = plan(EXCELLENT, [completion(C1, scaled=0.95)])
        self.assertNotEqual(projected["next_component_id"], C5)


class ContentShapeTests(unittest.TestCase):
    """Provider metadata is not always complete, and must never crash a learner."""

    def test_a_locale_the_unit_does_not_serve_yields_an_empty_route(self) -> None:
        """This unit is Hebrew-only. An Arabic learner must get NO route rather
        than Hebrew content relabelled — the catalog filters by language upstream,
        and the planner must not quietly undo that."""
        projected = plan(FRESH, [], locale="ar")
        self.assertEqual(projected["steps_total"], 0)
        self.assertIsNone(projected["next_component_id"])

    def test_a_unit_with_no_required_components_at_all_still_routes(self) -> None:
        unit = deepcopy(FIXTURE)
        for component in unit["components"]:
            component["is_required"] = False
        projected = plan(EXCELLENT, [], unit=unit)
        self.assertIsNotNone(projected["next_component_id"],
                            "a learner must never be left with nowhere to go")

    def test_a_recommended_after_fail_pointing_outside_the_unit_is_ignored(self) -> None:
        unit = deepcopy(FIXTURE)
        unit["components"][1]["recommended_after_fail"] = ["not-a-real-component"]
        projected = plan(STRUGGLING, [completion(C1, scaled=0.5),
                                      completion(C2, success=False, scaled=0.4)], unit=unit)
        self.assertEqual(projected["steps_total"], 5, "no phantom station is invented")

    def test_a_unit_with_no_components_returns_an_empty_plan_not_an_error(self) -> None:
        unit = deepcopy(FIXTURE)
        unit["components"] = []
        projected = plan(FRESH, [], unit=unit)
        self.assertEqual(projected["steps_total"], 0)
        self.assertIsNone(projected["next_component_id"])

    def test_a_unit_with_no_learning_goal_still_plans(self) -> None:
        """A §3.4 sub-topic summary has no goal, so there is no mastery entry to
        read — it must still open."""
        unit = deepcopy(FIXTURE)
        unit["objective_id"] = None
        projected = plan(FRESH, [], unit=unit)
        self.assertIsNotNone(projected["next_component_id"])


class SubjectPriorTests(unittest.TestCase):
    """A learner arriving at a brand-new goal with a record behind them."""

    def _brain_with_history(self, **entry) -> dict:
        return {
            "mastery": {
                "MOE.SCI.G7.OTHER.GOAL": {"subject": "science", "achieved": True, **entry},
                OBJECTIVE_ID: {},
            },
            "behavior_signals": [], "current_state": {},
        }

    def test_a_strong_record_elsewhere_in_the_subject_skips_the_optional_stage(self) -> None:
        brain = self._brain_with_history(score_ewma=0.93, confidence=0.85)
        projected = learning_path.project(deepcopy(FIXTURE), brain, [])
        self.assertEqual(node(projected, C2)["progress_reason"]["code"], "optional_skipped")

    def test_one_failure_in_the_new_goal_overrides_the_prior_immediately(self) -> None:
        brain = self._brain_with_history(score_ewma=0.93, confidence=0.85)
        projected = learning_path.project(
            deepcopy(FIXTURE), brain, [completion(C1, success=False, scaled=0.3)])
        self.assertIn(C2, route(projected))

    def test_a_record_in_a_DIFFERENT_subject_grants_nothing(self) -> None:
        brain = {
            "mastery": {"MOE.MATH.G7.GOAL": {"subject": "math", "achieved": True,
                                             "score_ewma": 0.95, "confidence": 0.9}},
            "behavior_signals": [], "current_state": {},
        }
        projected = learning_path.project(deepcopy(FIXTURE), brain, [])
        self.assertIn(C2, route(projected))

    def test_an_unfinished_goal_elsewhere_is_not_a_record(self) -> None:
        brain = self._brain_with_history(score_ewma=0.93, confidence=0.85)
        brain["mastery"]["MOE.SCI.G7.OTHER.GOAL"]["achieved"] = False
        projected = learning_path.project(deepcopy(FIXTURE), brain, [])
        self.assertIn(C2, route(projected))


class InvariantTests(unittest.TestCase):
    """Properties that must hold for EVERY learner, whatever their profile."""

    def _every_learner(self):
        histories = [
            [],
            [completion(C1, scaled=0.5)],
            [completion(C1, scaled=0.5), completion(C2, success=False, scaled=0.4)],
            [completion(C1, scaled=0.9), completion(C2, scaled=0.9), completion(C3, scaled=0.9)],
            [completion(C1, scaled=0.9), completion(C2, scaled=0.9), completion(C3, scaled=0.9),
             completion(C4, scaled=0.9), completion(C5, scaled=1.0)],
        ]
        for mastery in (FRESH, STRUGGLING, MIDDLE, EXCELLENT):
            for signals in ([], ["wheel_spinning"], ["rapid_guessing"]):
                for events in histories:
                    yield mastery, signals, events, plan(mastery, events, signals=signals)

    def test_path_index_is_always_contiguous_unique_and_ascending(self) -> None:
        for _mastery, _signals, _events, projected in self._every_learner():
            indexes = [n["path_index"] for n in projected["components"] if n["on_path"]]
            self.assertEqual(indexes, list(range(len(indexes))))

    def test_path_node_ids_are_always_unique(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            ids = [n["path_node_id"] for n in projected["components"]]
            self.assertEqual(len(ids), len(set(ids)))

    def test_there_is_never_more_than_one_current_station(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            current = [n for n in projected["components"] if n["progress_state"] == "current"]
            self.assertLessEqual(len(current), 1)

    def test_the_next_step_is_always_reachable_and_never_locked(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            next_id = projected["next_path_node_id"]
            if next_id is None:
                self.assertEqual(projected["unit_state"], "completed")
                continue
            target = next(n for n in projected["components"] if n["path_node_id"] == next_id)
            self.assertEqual(target["progress_state"], "current")

    def test_an_off_path_node_is_never_locked(self) -> None:
        """Off-path work is an extra, and an extra that 409s is a dead link."""
        for _m, _s, _e, projected in self._every_learner():
            for node_ in projected["components"]:
                if not node_["on_path"]:
                    self.assertNotEqual(node_["progress_state"], "locked")

    def test_progress_ratio_always_matches_the_counts(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            total = projected["steps_total"]
            if not total:
                continue
            self.assertAlmostEqual(projected["progress_ratio"],
                                   projected["steps_completed"] / total, places=3)
            self.assertLessEqual(projected["steps_completed"], total)

    def test_no_learner_is_ever_shown_a_mastery_level(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            payload = json.dumps(strip_internal(projected), ensure_ascii=False)
            for word in ("basic", "intermediate", "advanced", "score_ewma", "confidence"):
                self.assertNotIn(word, payload)

    def test_the_plan_is_always_deterministic(self) -> None:
        for mastery, signals, events, first in self._every_learner():
            second = plan(mastery, events, signals=signals)
            self.assertEqual(json.dumps(first, sort_keys=True, default=str),
                             json.dumps(second, sort_keys=True, default=str))

    def test_every_settled_station_keeps_its_evidence(self) -> None:
        for _m, _s, _e, projected in self._every_learner():
            for node_ in projected["components"]:
                if node_["outcome"] is not None:
                    self.assertTrue(node_["progress_reason"]["evidence"].get("event_id"),
                                    "a settled station must cite the event that settled it")


class ExplainabilityTests(unittest.TestCase):
    """The teacher gets the evidence; the learner gets a reason code."""

    def test_the_teacher_view_cites_real_values(self) -> None:
        projected = plan(STRUGGLING, [completion(C1, scaled=0.5),
                                      completion(C2, success=False, scaled=0.64)])
        evidence = node(projected, C2)["progress_reason"]["evidence"]
        self.assertEqual(evidence["scaled"], 0.64)
        self.assertTrue(evidence["event_id"])

    def test_the_learner_view_keeps_the_code_and_drops_the_evidence(self) -> None:
        projected = strip_internal(plan(STRUGGLING, [completion(C1, scaled=0.5)]))
        for node_ in projected["components"]:
            self.assertIn("code", node_["progress_reason"])
            self.assertNotIn("evidence", node_["progress_reason"])

    def test_every_reason_code_has_learner_facing_copy(self) -> None:
        """A code with no translation renders as a raw key on a child's screen."""
        locales = Path(__file__).resolve().parents[2] / "locales" / "he.json"
        copy = json.loads(locales.read_text(encoding="utf-8"))
        seen = set()
        for _m, _s, _e, projected in InvariantTests()._every_learner():
            for node_ in projected["components"]:
                seen.add(node_["progress_reason"]["code"])
        for code in seen:
            if code in ("xapi_completed", "xapi_failed", "equivalent_alternative",
                        "awaiting_prior_completion"):
                continue  # states, not "what happens next" messages
            self.assertIn(f"learning.path.next.{code}", copy,
                          f"reason `{code}` reaches the learner with no Hebrew copy")


if __name__ == "__main__":
    unittest.main()
