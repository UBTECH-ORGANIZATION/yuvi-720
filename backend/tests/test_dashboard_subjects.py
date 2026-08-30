"""The subjects panel's two numbers: where an objective stands, and one word
for a whole subject.

The child's bar and the teacher's row read the same objective, so `percent` has
to follow the same rule in both places. And a subject's level word summarises
many objectives at once — the interesting question is what a single outlier is
allowed to do to it.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

_OBJECTIVES = [
    {"id": "MOE.MATH.G7.A", "order": 1},
    {"id": "MOE.MATH.G7.B", "order": 2},
    {"id": "MOE.MATH.G7.C", "order": 3},
]


def _mastery(**entries):
    return {
        oid: {"subject": "math", "objective_id": oid, **fields}
        for oid, fields in entries.items()
    }


class ObjectivePercentTest(unittest.TestCase):
    def _curriculum(self, mastery, next_objective=None):
        from app.services import dashboard

        with patch.object(dashboard, "objectives_for", lambda _s: _OBJECTIVES), \
             patch.object(dashboard, "localized_objective_title",
                          lambda oid, lang=None: oid):
            return dashboard._subject_curriculum(
                {"mastery": mastery}, "math", "he", next_objective)

    def test_an_achieved_objective_is_whole_regardless_of_its_score(self):
        """Mastery is a decision, not a running average. Once it says achieved,
        a mid-70s EWMA must not draw the bar short of the end."""
        rows = self._curriculum(_mastery(**{
            "MOE.MATH.G7.A": {"achieved": True, "score_ewma": 0.74, "attempts": 5},
        }))
        self.assertEqual(rows[0]["percent"], 100)

    def test_an_unachieved_objective_never_reaches_a_hundred(self):
        """99 is the ceiling below mastery: a full bar the child has not been
        told they finished is the one reading that cannot be explained."""
        rows = self._curriculum(_mastery(**{
            "MOE.MATH.G7.A": {"achieved": False, "score_ewma": 0.999, "attempts": 4},
        }))
        self.assertEqual(rows[0]["percent"], 99)

    def test_an_untouched_objective_is_zero_not_missing(self):
        rows = self._curriculum({})
        self.assertEqual([row["percent"] for row in rows], [0, 0, 0])
        self.assertEqual([row["needsReview"] for row in rows], [False, False, False])

    def test_needs_review_survives_into_the_projection(self):
        rows = self._curriculum(_mastery(**{
            "MOE.MATH.G7.B": {"achieved": True, "needs_review": True, "attempts": 6},
        }))
        self.assertTrue(rows[1]["needsReview"])
        self.assertEqual(rows[1]["percent"], 100)


class SubjectLevelTest(unittest.TestCase):
    def _level(self, mastery):
        from app.services import dashboard
        return dashboard._subject_mastery_level(mastery, "math")

    def test_no_attempts_reads_as_starting(self):
        self.assertEqual(self._level({}), "starting")

    def test_an_objective_with_a_level_but_no_attempts_does_not_count(self):
        """A level can be seeded without the child having done anything. Only
        worked objectives are evidence."""
        self.assertEqual(self._level(_mastery(**{
            "MOE.MATH.G7.A": {"level": "advanced", "attempts": 0},
        })), "starting")

    def test_one_advanced_objective_does_not_promote_the_subject(self):
        """The whole reason this is a median: a single carried objective
        labelling the subject `מתקדם` is a claim the rest of the bars contradict.
        """
        self.assertEqual(self._level(_mastery(**{
            "MOE.MATH.G7.A": {"level": "advanced", "attempts": 9},
            "MOE.MATH.G7.B": {"level": "basic", "attempts": 3},
            "MOE.MATH.G7.C": {"level": "basic", "attempts": 2},
        })), "basic")

    def test_the_median_moves_once_most_objectives_move(self):
        self.assertEqual(self._level(_mastery(**{
            "MOE.MATH.G7.A": {"level": "advanced", "attempts": 9},
            "MOE.MATH.G7.B": {"level": "intermediate", "attempts": 6},
            "MOE.MATH.G7.C": {"level": "basic", "attempts": 2},
        })), "intermediate")

    def test_another_subjects_objectives_are_not_counted(self):
        mastery = _mastery(**{"MOE.MATH.G7.A": {"level": "basic", "attempts": 4}})
        mastery["MOE.SCI.G7.A"] = {
            "subject": "science", "level": "advanced", "attempts": 20}
        self.assertEqual(self._level(mastery), "basic")


if __name__ == "__main__":
    unittest.main()
