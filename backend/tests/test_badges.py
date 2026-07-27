"""Badge projection (badges.project_badges).

Badges fall out of the brain: mastered/total → state + ring, mastery `level` →
tier, all-subjects-earned → the world capstone. Synthetic catalog + mastery so
the logic is exercised without the (near-empty) live Kata catalog.
"""
from __future__ import annotations

import unittest
from contextlib import ExitStack
from unittest.mock import patch

from app.services import badges


def obj(oid, order=1, prereqs=None, subject="science"):
    return {"id": oid, "order": order, "prerequisites": prereqs or [],
            "title": oid, "subject": subject, "topic": ""}


def mastered(level="advanced"):
    return {"achieved": True, "level": level, "review_due": "2099-01-01",
            "last_evidence_at": "2026-07-20T00:00:00+00:00"}


def touched():
    return {"last_evidence_at": "2026-07-20T00:00:00+00:00"}


def with_catalog(objs_by_subject):
    """Patch both the planner's bound `objectives_for` and the catalog module
    accessors the projection reads, to a synthetic spine."""
    def fake_objs(subject):
        return objs_by_subject.get(subject, [])

    stack = ExitStack()
    stack.enter_context(patch("app.services.planner.objectives_for", side_effect=fake_objs))
    stack.enter_context(patch("app.services.badges.kata_catalog.objectives_for", side_effect=fake_objs))
    stack.enter_context(patch("app.services.badges.kata_catalog.localized_objective_title",
                              side_effect=lambda oid, locale="he": f"title:{oid}"))
    return stack


def by_subject(result):
    return {b["subject"]: b for b in result}


class BadgeProjectionTests(unittest.TestCase):
    def test_all_mastered_advanced_earns_gold_and_world(self) -> None:
        objs = {"math": [obj("m1", subject="math")], "science": [obj("s1", subject="science")]}
        brain = {"mastery": {"m1": mastered("advanced"), "s1": mastered("advanced")}}
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("math", "science")))
        self.assertEqual(out["science"]["state"], "earned")
        self.assertEqual(out["science"]["tier"], "gold")
        self.assertTrue(out["science"]["earned"])
        # world capstone earned once every subject coin is earned
        self.assertEqual(out["world"]["state"], "earned")
        self.assertTrue(out["world"]["earned"])

    def test_intermediate_depth_caps_tier_at_silver(self) -> None:
        objs = {"science": [obj("s1"), obj("s2", 2, ["s1"])]}
        brain = {"mastery": {"s1": mastered("advanced"), "s2": mastered("intermediate")}}
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("science",)))
        self.assertEqual(out["science"]["state"], "earned")
        self.assertEqual(out["science"]["tier"], "silver")

    def test_partial_progress_is_inprogress_with_ring(self) -> None:
        objs = {"science": [obj("s1"), obj("s2", 2, ["s1"])]}
        brain = {"mastery": {"s1": mastered("advanced")}}  # 1 of 2
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("science",)))
        self.assertEqual(out["science"]["state"], "inprogress")
        self.assertFalse(out["science"]["earned"])
        self.assertAlmostEqual(out["science"]["progress"], 0.5, places=3)
        self.assertEqual(out["world"]["state"], "inprogress")

    def test_no_evidence_is_locked(self) -> None:
        objs = {"science": [obj("s1")]}
        brain = {"mastery": {}}
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("science",)))
        self.assertEqual(out["science"]["state"], "locked")
        self.assertEqual(out["science"]["progress"], 0.0)

    def test_started_but_none_mastered_is_inprogress(self) -> None:
        objs = {"science": [obj("s1"), obj("s2", 2, ["s1"])]}
        brain = {"mastery": {"s1": touched()}}  # evidence, no mastery yet
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("science",)))
        self.assertEqual(out["science"]["state"], "inprogress")
        self.assertEqual(out["science"]["progress"], 0.0)

    def test_milestones_coming_and_howto(self) -> None:
        objs = {"science": [obj("s1")]}
        brain = {"mastery": {"s1": mastered()}}  # one goal mastered, no streak
        with with_catalog(objs):
            out = badges.project_badges(brain, subjects=("science",), locale="en")
        cats = {b["category"] for b in out}
        self.assertEqual(cats, {"subject", "world", "milestone", "coming"})
        # every badge teaches how to earn it
        self.assertTrue(all((b.get("howToEarn") or "").strip() for b in out))
        byt = {b["title"]: b for b in out}
        # First Steps earns on the first mastered goal; harder ones stay unearned
        self.assertEqual(byt["First Steps"]["state"], "earned")
        self.assertEqual(byt["On Fire"]["state"], "locked")           # no streak
        self.assertNotEqual(byt["Sharpshooter"]["state"], "earned")   # needs 3 passes, has 1
        # return-over-days milestones need event history we didn't pass
        self.assertEqual(byt["Dedicated"]["state"], "locked")
        self.assertEqual(byt["Streak"]["state"], "locked")
        # each milestone has its own colour + a background motif
        milestones = [b for b in out if b["category"] == "milestone"]
        self.assertTrue(all(b.get("motif") for b in milestones))
        self.assertEqual(len({b["subject"] for b in milestones}), len(milestones))
        # subjects not in Kata show as locked "coming soon"
        coming = {b["title"] for b in out if b["category"] == "coming"}
        self.assertEqual(coming, {"Word Weaver", "Cosmic Explorer", "Maker Spark"})

    def test_return_over_days_milestones(self) -> None:
        objs = {"science": [obj("s1")]}
        brain = {"mastery": {}}
        # five consecutive active days
        events = [{"occurred_at": f"2026-07-{11 + d}T10:00:00Z"} for d in range(5)]
        with with_catalog(objs):
            out = {b["title"]: b for b in badges.project_badges(
                brain, subjects=("science",), locale="en", events=events)}
        self.assertEqual(out["Dedicated"]["state"], "earned")   # 5 distinct days ≥ 5
        self.assertEqual(out["Streak"]["state"], "earned")      # 5 in a row ≥ 3

    def test_scattered_days_earn_dedicated_but_not_streak(self) -> None:
        objs = {"science": [obj("s1")]}
        brain = {"mastery": {}}
        # five days, but never two in a row
        events = [{"occurred_at": f"2026-07-{d}T09:00:00Z"} for d in ("01", "03", "05", "07", "09")]
        with with_catalog(objs):
            out = {b["title"]: b for b in badges.project_badges(
                brain, subjects=("science",), locale="en", events=events)}
        self.assertEqual(out["Dedicated"]["state"], "earned")      # 5 distinct days
        self.assertEqual(out["Streak"]["state"], "inprogress")     # longest run is 1 of 3

    def test_hard_milestones_need_real_thresholds(self) -> None:
        # three goals mastered, two through ≥2 failures, one with an 8-streak
        objs = {"science": [obj("s1"), obj("s2", 2, ["s1"]), obj("s3", 3, ["s2"])]}
        brain = {"mastery": {
            "s1": {**mastered("advanced"), "failures": 3},                          # comeback #1
            "s2": {**mastered("advanced"), "failures": 2, "consecutive_successes": 8},  # comeback #2 + on_fire
            "s3": {**mastered("advanced")},                                          # third pass → sharpshooter
        }}
        with with_catalog(objs):
            out = {b["title"]: b for b in badges.project_badges(brain, subjects=("science",), locale="en")}
        self.assertEqual(out["On Fire"]["state"], "earned")       # streak 8 ≥ 8
        self.assertEqual(out["Comeback Kid"]["state"], "earned")  # 2 recoveries ≥ 2
        self.assertEqual(out["Sharpshooter"]["state"], "earned")  # 3 passes ≥ 3

    def test_one_comeback_is_not_enough(self) -> None:
        objs = {"science": [obj("s1"), obj("s2", 2, ["s1"])]}
        brain = {"mastery": {
            "s1": {**mastered("advanced"), "failures": 2},   # single recovery
            "s2": {"last_evidence_at": "2026-07-20T00:00:00+00:00", "consecutive_successes": 5},  # 5 < 8
        }}
        with with_catalog(objs):
            out = {b["title"]: b for b in badges.project_badges(brain, subjects=("science",), locale="en")}
        self.assertEqual(out["Comeback Kid"]["state"], "inprogress")  # 1 of 2
        self.assertEqual(out["On Fire"]["state"], "inprogress")       # 5 of 8

    def test_empty_subject_is_skipped(self) -> None:
        objs = {"science": [], "math": [obj("m1", subject="math")]}
        brain = {"mastery": {"m1": mastered()}}
        with with_catalog(objs):
            out = by_subject(badges.project_badges(brain, subjects=("math", "science")))
        self.assertNotIn("science", out)
        self.assertIn("math", out)


if __name__ == "__main__":
    unittest.main()
