"""Cross-subject focus selection (planner.next_focus).

Global spaced-review beats new material in any subject; new material goes to the
most-behind subject, tie-broken by least-recently-practiced.
"""
from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services import planner


def obj(oid, order=1, prereqs=None, subject="math"):
    return {"id": oid, "order": order, "prerequisites": prereqs or [],
            "title": oid, "subject": subject, "topic": ""}


def with_catalog(objs_by_subject):
    def fake(subject):
        return objs_by_subject.get(subject, [])
    return patch("app.services.planner.objectives_for", side_effect=fake)


class CrossSubjectFocusTests(unittest.TestCase):
    def test_global_review_beats_new_material_in_another_subject(self) -> None:
        # math has fresh new material; science has a skill due for review → review wins.
        objs = {"math": [obj("m1", subject="math")],
                "science": [obj("s1", subject="science")]}
        brain = {"mastery": {"s1": {"achieved": "2026-01-01", "needs_review": True,
                                     "review_due": "2026-01-02", "subject": "science"}}}
        with with_catalog(objs):
            focus = planner.next_focus(brain, ("math", "science"))
        self.assertEqual(focus["mode"], "review")
        self.assertEqual((focus["subject"], focus["objective_id"]), ("science", "s1"))

    def test_new_material_goes_to_most_behind_subject(self) -> None:
        # No review due. math 0/1 mastered (ratio 0), science 1/2 (ratio .5) → math.
        objs = {"math": [obj("m1", subject="math")],
                "science": [obj("s1", 1, subject="science"), obj("s2", 2, ["s1"], "science")]}
        brain = {"mastery": {"s1": {"achieved": "2026-01-01", "review_due": "2027-01-01",
                                     "subject": "science"}}}
        with with_catalog(objs):
            focus = planner.next_focus(brain, ("math", "science"))
        self.assertEqual(focus["mode"], "new")
        self.assertEqual(focus["subject"], "math")

    def test_tie_ratio_breaks_to_least_recently_practiced(self) -> None:
        # Both subjects 1/2 mastered (ratio .5); science practiced longer ago → science.
        objs = {"math": [obj("m1", 1, subject="math"), obj("m2", 2, ["m1"], "math")],
                "science": [obj("s1", 1, subject="science"), obj("s2", 2, ["s1"], "science")]}
        brain = {"mastery": {
            "m1": {"achieved": "2026-01-01", "review_due": "2027-01-01",
                   "last_evidence_at": "2026-07-23T10:00:00+00:00", "subject": "math"},
            "s1": {"achieved": "2026-01-01", "review_due": "2027-01-01",
                   "last_evidence_at": "2026-07-01T10:00:00+00:00", "subject": "science"},
        }}
        with with_catalog(objs):
            focus = planner.next_focus(brain, ("math", "science"))
        self.assertEqual(focus["mode"], "new")
        self.assertEqual(focus["subject"], "science")  # older last activity

    def test_all_mastered_returns_complete(self) -> None:
        objs = {"math": [obj("m1", subject="math")], "science": []}
        brain = {"mastery": {"m1": {"achieved": "2026-01-01", "review_due": "2027-01-01",
                                     "subject": "math"}}}
        with with_catalog(objs):
            focus = planner.next_focus(brain, ("math", "science"))
        self.assertEqual(focus["mode"], "complete")
        self.assertIsNone(focus["subject"])


class FocusRoadmapTests(unittest.TestCase):
    """`focus_roadmap` is `next_focus` played forward over simulated mastery —
    it must walk the same road the live planner would, and touch nothing."""

    def test_the_road_begins_where_the_live_focus_points(self) -> None:
        objs = {"math": [obj("m1", subject="math")],
                "science": [obj("s1", subject="science")]}
        brain = {"mastery": {}}
        with with_catalog(objs):
            live = planner.next_focus(brain, ("math", "science"))
            road = planner.focus_roadmap(brain, subjects=("math", "science"))
        self.assertEqual((road[0]["subject"], road[0]["objective_id"], road[0]["mode"]),
                         (live["subject"], live["objective_id"], live["mode"]))

    def test_a_review_step_is_walked_and_the_road_moves_on_to_new_material(self) -> None:
        objs = {"math": [obj("m1", subject="math")],
                "science": [obj("s1", subject="science")]}
        brain = {"mastery": {"s1": {"achieved": "2026-01-01", "needs_review": True,
                                    "review_due": "2026-01-02", "subject": "science"}}}
        with with_catalog(objs):
            road = planner.focus_roadmap(brain, subjects=("math", "science"))
        self.assertEqual([step["mode"] for step in road], ["review", "new"])
        self.assertEqual(road[0]["objective_id"], "s1")
        self.assertEqual(road[1]["objective_id"], "m1")

    def test_the_road_switches_subjects_as_completions_change_who_is_behind(self) -> None:
        # Both subjects have two objectives, nothing mastered: after m1 is
        # simulated complete, math is 1/2 and science 0/2 — science's turn.
        objs = {"math": [obj("m1", 1, subject="math"), obj("m2", 2, ["m1"], "math")],
                "science": [obj("s1", 1, subject="science"), obj("s2", 2, ["s1"], "science")]}
        with with_catalog(objs):
            road = planner.focus_roadmap({"mastery": {}}, subjects=("math", "science"))
        self.assertEqual([step["objective_id"] for step in road],
                         ["m1", "s1", "m2", "s2"])
        self.assertEqual({step["subject"] for step in road}, {"math", "science"})

    def test_a_finished_learner_gets_one_honest_complete_step(self) -> None:
        objs = {"math": [obj("m1", subject="math")]}
        brain = {"mastery": {"m1": {"achieved": "2026-01-01",
                                    "review_due": "2999-01-01", "subject": "math"}}}
        with with_catalog(objs):
            road = planner.focus_roadmap(brain, subjects=("math",))
        self.assertEqual(road, [{"subject": None, "objective_id": None, "mode": "complete"}])

    def test_the_simulation_never_touches_the_real_brain(self) -> None:
        objs = {"math": [obj("m1", subject="math"), obj("m2", 2, ["m1"], "math")]}
        brain = {"mastery": {"m1": {"achieved": False, "attempts": 2, "subject": "math"}}}
        import copy
        before = copy.deepcopy(brain)
        with with_catalog(objs):
            planner.focus_roadmap(brain, subjects=("math",))
        self.assertEqual(brain, before)


if __name__ == "__main__":
    unittest.main()
