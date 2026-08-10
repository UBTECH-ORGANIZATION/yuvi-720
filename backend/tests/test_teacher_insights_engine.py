"""Phase 2 — the F6 insights engine contracts.

Three things are asserted here that the MoE spec makes non-negotiable:

1. **Explainability.** Every flag and every recommendation carries the raw datum
   that produced it. A teacher must always be able to ask "why?".
2. **The five categories.** Recommendations are tagged with the pedagogical
   category the spec names, not free text.
3. **No student-to-student comparison.** Group output is counts, never a ranked
   or paired list of children.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import group_analytics, insights


def run(coro):
    return asyncio.run(coro)


OBJECTIVES = {
    "math": [{"id": "obj.frac"}, {"id": "obj.linear"}, {"id": "obj.ratio"}],
}


def _mastery(**entries):
    """Mastery keyed the way the brain stores it (dots → middle dot)."""
    from app.brain.mastery import mastery_key
    return {mastery_key(key): value for key, value in entries.items()}


def _hours_ago(hours: int) -> str:
    """A stamp relative to the run, so a fixture cannot rot as the calendar moves."""
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _brain(**overrides):
    base = {
        "identity": {"display_name": "Test Kid"},
        "progress": {}, "goals": [], "strengths": [], "challenges": [],
        "wellbeing_flags": [], "reflections_recent": [], "mastery": {},
    }
    base.update(overrides)
    return base


class _CatalogPatch:
    """Pin the catalog so the assertions don't depend on live content."""

    def __enter__(self):
        self._patches = [
            patch("app.services.kata_catalog.subjects", return_value=list(OBJECTIVES)),
            patch("app.services.kata_catalog.objectives_for",
                  side_effect=lambda subject: OBJECTIVES.get(subject, [])),
            patch("app.services.kata_catalog.localized_objective_title",
                  side_effect=lambda oid, locale="he": f"title:{oid}"),
            patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock(return_value=None)),
        ]
        for item in self._patches:
            item.start()
        return self

    def __exit__(self, *exc):
        for item in self._patches:
            item.stop()


class ObjectivesProgressTest(unittest.TestCase):
    def test_counts_against_the_catalog_not_only_what_was_seen(self):
        with _CatalogPatch():
            brain = _brain(mastery=_mastery(
                **{"obj.frac": {"achieved": True, "attempts": 4},
                   "obj.linear": {"achieved": False, "attempts": 2, "needs_review": True}}
            ))
            progress = insights.objectives_progress(brain)
        math = progress["math"]
        self.assertEqual(math["objectives_total"], 3)      # from the catalog
        self.assertEqual(math["objectives_mastered"], 1)
        self.assertEqual(math["objectives_in_progress"], 1)
        self.assertEqual(math["objectives_needs_review"], 1)
        self.assertEqual(math["not_started"], 1)           # never attempted
        self.assertEqual(math["percent"], 33)

    def test_subject_filter_narrows_the_result(self):
        with _CatalogPatch():
            progress = insights.objectives_progress(_brain(), subject="science")
        self.assertEqual(progress, {})


class RecommendationTest(unittest.TestCase):
    def _insights(self, brain, recent):
        with _CatalogPatch(), \
             patch("app.brain.repository.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_recent_events", new=AsyncMock(return_value=recent)), \
             patch("app.services.insights.plan_next", return_value={}):
            return run(insights.student_insights("kid", "he"))

    def test_every_recommendation_has_a_category_and_a_because(self):
        view = self._insights(_brain(strengths=[{"label": "persistence"}]), [])
        self.assertTrue(view["recommendations"])
        valid = {
            insights.CATEGORY_REINFORCE, insights.CATEGORY_EXTRA_PRACTICE,
            insights.CATEGORY_DEEPEN, insights.CATEGORY_ENRICH, insights.CATEGORY_REFER,
        }
        for recommendation in view["recommendations"]:
            self.assertIn(recommendation["category"], valid)
            self.assertTrue(recommendation["category_label"])
            self.assertTrue(recommendation["text"])
            self.assertIn("because", recommendation)
            self.assertIn("signal", recommendation["because"])

    def test_recommendation_count_stays_within_the_spec_range(self):
        view = self._insights(_brain(strengths=[{"label": "x"}]), [])
        self.assertGreaterEqual(len(view["recommendations"]), 1)
        self.assertLessEqual(len(view["recommendations"]), 5)

    def test_consecutive_failures_produce_practice_and_reinforcement(self):
        recent = [
            {"verb": "answered", "result": {"success": False}, "objective_id": "obj.frac",
             "stored_at": "2026-08-03T10:00:00+00:00", "effortful": True, "_id": f"e{i}"}
            for i in range(3)
        ]
        view = self._insights(_brain(), recent)
        categories = {r["category"] for r in view["recommendations"]}
        self.assertIn(insights.CATEGORY_EXTRA_PRACTICE, categories)
        self.assertIn(insights.CATEGORY_REINFORCE, categories)
        practice = next(r for r in view["recommendations"]
                        if r["category"] == insights.CATEGORY_EXTRA_PRACTICE)
        self.assertEqual(practice["because"]["signal"], "trailing_fail_streak")
        self.assertEqual(practice["because"]["value"], 3)

    def test_high_mastery_produces_a_deepen_recommendation(self):
        brain = _brain(mastery=_mastery(**{
            "obj.frac": {"achieved": True, "attempts": 3},
            "obj.linear": {"achieved": True, "attempts": 3},
            "obj.ratio": {"achieved": True, "attempts": 3},
        }))
        view = self._insights(brain, [])
        categories = {r["category"] for r in view["recommendations"]}
        self.assertIn(insights.CATEGORY_DEEPEN, categories)

    def test_struggle_items_carry_raw_counters(self):
        brain = _brain(
            challenges=[{"label": "fractions", "objective_id": "obj.frac"}],
            mastery=_mastery(**{"obj.frac": {
                "subject": "math", "attempts": 6, "successes": 1, "failures": 5,
                "score_ewma": 0.2, "level": "basic", "misconceptions": [],
            }}),
        )
        view = self._insights(brain, [])
        item = view["struggle_items"][0]
        self.assertEqual(item["raw_evidence"]["attempts"], 6)
        self.assertEqual(item["raw_evidence"]["failures"], 5)

    def test_subject_filter_excludes_other_subjects_struggles(self):
        brain = _brain(
            challenges=[{"label": "fractions", "objective_id": "obj.frac"}],
            mastery=_mastery(**{"obj.frac": {"subject": "math", "attempts": 3}}),
        )
        with _CatalogPatch(), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_recent_events", new=AsyncMock(return_value=[])), \
             patch("app.services.insights.plan_next", return_value={}):
            view = run(insights.student_insights("kid", "he", subject="science"))
        self.assertEqual(view["struggle_items"], [])
        self.assertEqual(view["subject_filter"], "science")

    def test_subject_filter_drops_items_whose_subject_is_unknown(self):
        """A filtered view must not leak unattributed rows into every subject.

        Regression: mastery entries without a `subject` used to pass the filter,
        so asking for one subject returned everything.
        """
        brain = _brain(
            challenges=[{"label": "mystery", "objective_id": "obj.unknown"}],
            mastery=_mastery(**{"obj.unknown": {"attempts": 3}}),   # no subject
        )
        with _CatalogPatch(), \
             patch("app.services.kata_catalog.get_objective", return_value=None), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_recent_events", new=AsyncMock(return_value=[])), \
             patch("app.services.insights.plan_next", return_value={}):
            filtered = run(insights.student_insights("kid", "he", subject="math"))
            unfiltered = run(insights.student_insights("kid", "he"))
        self.assertEqual(filtered["struggle_items"], [])       # excluded when filtering
        self.assertEqual(len(unfiltered["struggle_items"]), 1)  # still visible unfiltered

    def test_subject_resolves_from_the_catalog_when_mastery_lacks_it(self):
        brain = _brain(
            challenges=[{"label": "fractions", "objective_id": "obj.frac"}],
            mastery=_mastery(**{"obj.frac": {"attempts": 3}}),   # no subject stored
        )
        with _CatalogPatch(), \
             patch("app.services.kata_catalog.get_objective",
                   return_value={"id": "obj.frac", "subject": "math"}), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_recent_events", new=AsyncMock(return_value=[])), \
             patch("app.services.insights.plan_next", return_value={}):
            view = run(insights.student_insights("kid", "he", subject="math"))
        self.assertEqual(len(view["struggle_items"]), 1)
        self.assertEqual(view["struggle_items"][0]["subject"], "math")

    def test_primary_attention_flag_carries_raw_evidence_for_every_kind(self):
        """F6: a flag without its datum is a flag a teacher cannot check.

        Regression — `wellbeing`, `inactivity` and `low_success` shipped only a
        sentence, so the "why?" disclosure in the UI had nothing to open.
        """
        cases = {
            "wellbeing": _brain(wellbeing_flags=[
                {"evidence": "shared distress", "at": "2026-08-01T00:00:00+00:00",
                 "source": "coach", "resolved": False},
            ]),
            "low_success": _brain(),
            "inactivity": _brain(),
        }
        events = {
            "wellbeing": [],
            # Dated relative to now, not pinned: hard-coded stamps drifted past
            # INACTIVITY_DAYS as the calendar caught up, and an inactivity flag
            # then outranked the low-success one this case exists to assert.
            "low_success": [
                {"verb": "answered", "result": {"success": False}, "objective_id": "obj.frac",
                 "stored_at": _hours_ago(2), "effortful": True, "_id": f"e{i}"}
                for i in range(3)
            ],
            # Long past INACTIVITY_DAYS.
            "inactivity": [
                {"verb": "answered", "result": {"success": True},
                 "stored_at": "2020-01-01T00:00:00+00:00", "_id": "old"},
            ],
        }
        for kind, brain in cases.items():
            with self.subTest(kind=kind):
                view = self._insights(brain, events[kind])
                flag = view["attention"]
                self.assertIsNotNone(flag, f"{kind} produced no flag")
                self.assertEqual(flag["kind"], kind)
                self.assertTrue(flag.get("raw_evidence"),
                                f"{kind} flag has no raw_evidence")

    def test_every_flag_reaching_the_teacher_is_explainable(self):
        """The contract, asserted over the whole list rather than a sample."""
        brain = _brain(
            wellbeing_flags=[{"evidence": "x", "at": "2026-08-01T00:00:00+00:00",
                              "resolved": False}],
            goals=[
                {"id": "g1", "deadline": "2020-01-01", "status": "started"},
                {"id": "g2", "needs_help": True},
            ],
        )
        view = self._insights(brain, [])
        self.assertTrue(view["attention_all"])
        for flag in view["attention_all"]:
            self.assertTrue(flag.get("evidence"), f"{flag.get('kind')} has no evidence sentence")
            self.assertTrue(flag.get("raw_evidence"), f"{flag.get('kind')} has no raw datum")

    def test_supplier_attention_criteria_all_carry_raw_evidence(self):
        brain = _brain(goals=[
            {"id": "g1", "deadline": "2020-01-01", "status": "started"},
            {"id": "g2", "needs_help": True},
        ])
        view = self._insights(brain, [])
        kinds = {flag["kind"] for flag in view["attention_all"]}
        self.assertIn("overdue_goal", kinds)
        self.assertIn("help_requested", kinds)
        for flag in view["attention_all"]:
            self.assertTrue(flag.get("raw_evidence"), f"{flag['kind']} has no raw evidence")
            self.assertTrue(flag.get("evidence"))


class RosterStatusTest(unittest.TestCase):
    """The roster is allowed three claims, and silence is not "progressing".

    A learner who has never logged in produces no events, so `days_inactive` is
    None and no attention criterion can fire. The roster read that absence as a
    clean bill of health and printed "מתקדם/ת" — on a card that said "never
    seen" beside it. `status` exists so the absence of a flag can no longer be
    reported as progress.
    """

    def _insights(self, brain, recent):
        with _CatalogPatch(), \
             patch("app.brain.repository.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=brain)), \
             patch("app.services.insights.get_recent_events", new=AsyncMock(return_value=recent)), \
             patch("app.services.insights.plan_next", return_value={}):
            return run(insights.student_insights("kid", "he"))

    def test_a_learner_with_no_events_is_never_started_not_progressing(self):
        view = self._insights(_brain(), [])
        self.assertEqual(view["status"], insights.STATUS_NOT_STARTED)
        self.assertFalse(view["activity"]["started"])
        self.assertIsNone(view["activity"]["last_event_at"])
        self.assertIsNone(view["activity"]["days_inactive"])

    def test_a_learner_with_recent_clean_activity_is_active(self):
        recent = [{
            "verb": "answered", "result": {"success": True}, "objective_id": "obj.frac",
            "stored_at": datetime.now(timezone.utc).isoformat(), "_id": "e1",
        }]
        view = self._insights(_brain(), recent)
        self.assertEqual(view["status"], insights.STATUS_ACTIVE)
        self.assertTrue(view["activity"]["started"])
        self.assertEqual(view["activity"]["days_inactive"], 0)

    def test_a_flagged_learner_is_reported_as_attention(self):
        brain = _brain(wellbeing_flags=[
            {"evidence": "x", "at": "2026-08-01T00:00:00+00:00", "resolved": False},
        ])
        view = self._insights(brain, [])
        self.assertEqual(view["status"], insights.STATUS_ATTENTION)

    def test_the_group_counts_who_never_started(self):
        started = [{
            "verb": "answered", "result": {"success": True}, "objective_id": "obj.frac",
            "stored_at": datetime.now(timezone.utc).isoformat(), "_id": "e1",
        }]
        events = {"a": started, "b": [], "c": []}
        with _CatalogPatch(), \
             patch("app.services.insights.get_group", new=AsyncMock(return_value={"_id": "g"})), \
             patch("app.services.insights.learners_in_group",
                   new=AsyncMock(return_value=["a", "b", "c"])), \
             patch("app.services.insights.get_brain", new=AsyncMock(return_value=_brain())), \
             patch("app.brain.repository.get_brain", new=AsyncMock(return_value=_brain())), \
             patch("app.services.insights.get_recent_events",
                   new=AsyncMock(side_effect=lambda lid, **kw: events[lid])), \
             patch("app.services.insights.plan_next", return_value={}):
            group = run(insights.group_insights("g", "he"))
        self.assertEqual(group["trends"]["not_started"], 2)
        statuses = {row["learner_id"]: row["status"] for row in group["students"]}
        self.assertEqual(statuses["a"], insights.STATUS_ACTIVE)
        self.assertEqual(statuses["b"], insights.STATUS_NOT_STARTED)


class GroupAnalyticsTest(unittest.TestCase):
    def _gaps(self, brains, learner_ids):
        with _CatalogPatch(), \
             patch("app.services.group_analytics.learners_in_group",
                   new=AsyncMock(return_value=learner_ids)), \
             patch("app.services.group_analytics.get_brain",
                   new=AsyncMock(side_effect=lambda lid: brains[lid])):
            return run(group_analytics.learning_gaps("g1"))

    def test_gap_reported_when_enough_of_the_group_struggles(self):
        struggling = {"subject": "math", "attempts": 5, "score_ewma": 0.2,
                      "achieved": False, "misconceptions": [{"tag": "denominator"}]}
        brains = {f"k{i}": _brain(mastery=_mastery(**{"obj.frac": dict(struggling)}))
                  for i in range(4)}
        gaps = self._gaps(brains, list(brains))
        frac = next(g for g in gaps if g["objective_id"] == "obj.frac")
        self.assertEqual(frac["kind"], "gap")
        self.assertEqual(frac["struggling_count"], 4)
        self.assertEqual(frac["struggle_share"], 1.0)
        self.assertEqual(frac["evidence"]["sample_misconceptions"][0][0], "denominator")

    def test_single_learner_is_not_a_group_pattern(self):
        brains = {
            "k1": _brain(mastery=_mastery(**{"obj.frac": {
                "subject": "math", "attempts": 5, "score_ewma": 0.1, "achieved": False}})),
            "k2": _brain(),        # no evidence at all
        }
        self.assertEqual(self._gaps(brains, list(brains)), [])

    def test_group_output_never_ranks_or_pairs_learners(self):
        """C5: no comparative structure may leave this module."""
        brains = {
            "k1": _brain(mastery=_mastery(**{"obj.frac": {
                "subject": "math", "attempts": 5, "score_ewma": 0.1, "achieved": False}})),
            "k2": _brain(mastery=_mastery(**{"obj.frac": {
                "subject": "math", "attempts": 5, "score_ewma": 0.9, "achieved": True}})),
            "k3": _brain(mastery=_mastery(**{"obj.frac": {
                "subject": "math", "attempts": 5, "score_ewma": 0.2, "achieved": False}})),
        }
        gaps = self._gaps(brains, list(brains))
        for gap in gaps:
            # Aggregates are numbers.
            self.assertIsInstance(gap["struggling_count"], int)
            self.assertIsInstance(gap["mastered_count"], int)
            # The only learner ids present are the actionable sub-group, and
            # they carry no score, rank or order-bearing payload.
            for entry in gap["learner_ids"]:
                self.assertIsInstance(entry, str)

    def test_recommendations_map_gap_shape_to_a_teaching_move(self):
        gaps = [
            {"objective_id": "o1", "subject": "math", "label": "L", "kind": "gap",
             "struggle_share": 0.8, "mastery_share": 0.0, "struggling_count": 8,
             "mastered_count": 0, "with_evidence": 10, "group_size": 10,
             "evidence": {"sample_misconceptions": []}},
            {"objective_id": "o2", "subject": "math", "label": "L2", "kind": "gap",
             "struggle_share": 0.4, "mastery_share": 0.4, "struggling_count": 4,
             "mastered_count": 4, "with_evidence": 10, "group_size": 10,
             "evidence": {"sample_misconceptions": []}},
            {"objective_id": "o3", "subject": "math", "label": "L3", "kind": "strength",
             "struggle_share": 0.0, "mastery_share": 0.9, "struggling_count": 0,
             "mastered_count": 9, "with_evidence": 10, "group_size": 10,
             "evidence": {"sample_misconceptions": []}},
        ]
        actions = [r["action"] for r in group_analytics.group_recommendations(gaps)]
        self.assertEqual(actions, ["revisit", "split_groups", "extend"])
        for recommendation in group_analytics.group_recommendations(gaps):
            self.assertIn("because", recommendation)
            self.assertTrue(recommendation["because"]["raw"])

    def test_engagement_reports_missing_timing_honestly(self):
        events = [{"stored_at": "2026-08-03T10:00:00+00:00", "timing": {}}]
        with patch("app.services.group_analytics.learners_in_group",
                   new=AsyncMock(return_value=["k1", "k2"])), \
             patch("app.services.group_analytics.get_learner_events",
                   new=AsyncMock(side_effect=lambda lid, limit=1000: events if lid == "k1" else [])):
            with patch("app.services.group_analytics.datetime") as clock:
                from datetime import datetime as real_datetime, timezone as real_tz
                clock.now.return_value = real_datetime(2026, 8, 3, 12, 0, tzinfo=real_tz.utc)
                clock.fromisoformat = real_datetime.fromisoformat
                stats = run(group_analytics.engagement("g1"))
        self.assertEqual(stats["students_total"], 2)
        self.assertEqual(stats["active_students"], 1)
        self.assertEqual(stats["active_pct"], 50)
        # No usable timing evidence → say so, never report a confident zero.
        self.assertIsNone(stats["avg_active_minutes"])
        self.assertFalse(stats["timing_available"])


if __name__ == "__main__":
    unittest.main()
