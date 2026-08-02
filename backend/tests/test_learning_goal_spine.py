"""The learning goal (יעד למידה) — identity, order, and what is NOT a goal.

Kata publishes the ministry's curriculum registry at `GET /catalog/objectives`:
96 goals, each with its pedagogical description, translations, an `order` scoped
within its sub-topic, and the hierarchy above it (curriculum → subject area →
topic → sub-topic). We used to ignore all of it and invent an order from
prerequisite depth — invisible while one goal was live, wrong the moment a
second one lands.
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import kata_catalog, kata_client

GOAL_1 = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-PRACTICE"
GOAL_2 = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL.MASS-VS-WEIGHT"
SUBTOPIC = "MOE.SCI.G7.CHEM.BODY-MAT-PROP.MASS-VOL"


def registry_row(goal_id: str, order: int) -> dict:
    """Shaped exactly like a live `/catalog/objectives` item."""
    return kata_client.normalize_objective({
        "id": goal_id,
        "title": "התלמידים ימדדו מסה…",
        "titleTranslations": {"he": "התלמידים ימדדו מסה…"},
        "order": order,
        "curriculum": {"id": "MOE.SCI.G7", "titleTranslations": {"he": "מדעים לכיתה ז׳"}},
        "subjectArea": {"id": "MOE.SCI.G7.CHEM", "title": "כימיה"},
        "topic": {"id": "MOE.SCI.G7.CHEM.BODY-MAT-PROP", "title": "גופים, חומרים ותכונותיהם"},
        "subtopic": {"id": SUBTOPIC, "title": "מסה ונפח של גופים"},
    })


def unit(unit_id: str, goal_id: str | None, *, prerequisites: list[str] | None = None) -> dict:
    return kata_client.normalize_unit({
        "id": unit_id,
        "title": "יחידה",
        "subTopic": SUBTOPIC,
        "learningObjective": goal_id,
        "prerequisiteLearningObjective": prerequisites or [],
        "components": [{"id": f"{unit_id}-01", "order": 1, "languages": ["Hebrew"]}],
    })


class GoalIdentityTests(unittest.TestCase):
    def test_a_unit_declares_its_goal_by_the_ministry_code(self) -> None:
        self.assertEqual(unit("u1", GOAL_1)["objective_id"], GOAL_1)
        self.assertFalse(unit("u1", GOAL_1)["is_summary"])

    def test_a_summary_unit_has_no_goal_and_never_invents_one(self) -> None:
        """§3.4 — the per-sub-topic summary is deliberately not tied to a goal.
        Falling back to the unit id used to mint a phantom goal that could never
        be achieved and that the planner would offer forever."""
        summary = unit("u-summary", None)
        self.assertIsNone(summary["objective_id"])
        self.assertTrue(summary["is_summary"])

    def test_a_summary_unit_stays_launchable_but_off_the_spine(self) -> None:
        snapshot = kata_catalog._build_snapshot(
            [unit("u1", GOAL_1), unit("u-summary", None)],
            [registry_row(GOAL_1, 1)],
        )
        self.assertEqual(list(snapshot["objectives"]), [GOAL_1])
        self.assertIn("u-summary-01", snapshot["components"])
        self.assertTrue(snapshot["components"]["u-summary-01"]["is_summary"])


class GoalOrderTests(unittest.TestCase):
    def test_the_registry_order_wins_over_our_invented_one(self) -> None:
        """Alphabetically MASS-PRACTICE precedes MASS-VS-WEIGHT, so this only
        proves anything because the registry says the opposite."""
        snapshot = kata_catalog._build_snapshot(
            [unit("u1", GOAL_1), unit("u2", GOAL_2)],
            [registry_row(GOAL_1, 2), registry_row(GOAL_2, 1)],
        )
        self.assertEqual(snapshot["by_subject"]["science"], [GOAL_2, GOAL_1])

    def test_the_goal_carries_the_hierarchy_the_ui_labels_with(self) -> None:
        snapshot = kata_catalog._build_snapshot([unit("u1", GOAL_1)], [registry_row(GOAL_1, 1)])
        goal = snapshot["objectives"][GOAL_1]
        self.assertEqual(goal["title"], "מסה ונפח של גופים")
        self.assertEqual(goal["topic_title"], "גופים, חומרים ותכונותיהם")
        self.assertEqual(goal["curriculum_title"], "מדעים לכיתה ז׳")
        self.assertIn("ימדדו מסה", goal["description"])

    def test_a_missing_registry_falls_back_to_unit_metadata(self) -> None:
        """The registry is metadata — losing it must not lose the catalog."""
        snapshot = kata_catalog._build_snapshot([unit("u1", GOAL_1)], [])
        self.assertEqual(snapshot["objectives"][GOAL_1]["title"], "יחידה")
        self.assertEqual(snapshot["by_subject"]["science"], [GOAL_1])


class GoalGateTests(unittest.IsolatedAsyncioTestCase):
    """§3 — "לא ניתן לבצע יעד לפני שביצעו את היעד הקודם לו"."""

    async def _launch(self, mastery: dict) -> None:
        from app.services import learning_sessions
        with patch("app.brain.repository.get_brain",
                   AsyncMock(return_value={"mastery": mastery})):
            await learning_sessions._assert_objective_reachable(
                "L", unit("u2", GOAL_2, prerequisites=[GOAL_1]),
            )

    async def test_a_goal_is_refused_while_its_prerequisite_is_unachieved(self) -> None:
        with self.assertRaises(kata_client.KataError) as caught:
            await self._launch({GOAL_1: {"achieved": False}})
        self.assertEqual(caught.exception.status_code, 409)

    async def test_the_same_goal_opens_once_the_prerequisite_is_achieved(self) -> None:
        await self._launch({GOAL_1: {"achieved": True}})

    async def test_a_goal_with_no_declared_prerequisites_gates_nothing(self) -> None:
        from app.services import learning_sessions
        await learning_sessions._assert_objective_reachable("L", unit("u1", GOAL_1))


class SubjectPriorTests(unittest.TestCase):
    """A brand-new goal used to start every learner neutral."""

    def _brain(self, **rows) -> dict:
        return {"mastery": rows}

    def test_a_strong_record_in_the_subject_carries_into_a_fresh_goal(self) -> None:
        from app.services import learning_path
        prior = learning_path.subject_prior(
            self._brain(**{GOAL_1: {"subject": "science", "achieved": True,
                                    "score_ewma": 0.9, "confidence": 0.8}}),
            "science", GOAL_2,
        )
        self.assertEqual(learning_path.band_for(prior), "confident")

    def test_a_weak_record_grants_no_prior_at_all(self) -> None:
        from app.services import learning_path
        prior = learning_path.subject_prior(
            self._brain(**{GOAL_1: {"subject": "science", "achieved": True,
                                    "score_ewma": 0.5, "confidence": 0.4}}),
            "science", GOAL_2,
        )
        self.assertEqual(prior, {})

    def test_a_prior_never_stands_in_for_the_assessment(self) -> None:
        """Reputation may shape optional work and difficulty. Facing the test of
        a goal has to be earned inside that goal."""
        from app.services import learning_path
        prior = learning_path.subject_prior(
            self._brain(**{GOAL_1: {"subject": "science", "achieved": True,
                                    "score_ewma": 0.95, "confidence": 0.9}}),
            "science", GOAL_2,
        )
        self.assertEqual(prior["level"], "basic")
        self.assertEqual(prior["consecutive_successes"], 0)

    def test_a_lapsed_skill_in_the_subject_cancels_the_prior(self) -> None:
        from app.services import learning_path
        prior = learning_path.subject_prior(
            self._brain(**{GOAL_1: {"subject": "science", "achieved": True, "needs_review": True,
                                    "score_ewma": 0.9, "confidence": 0.8}}),
            "science", GOAL_2,
        )
        self.assertEqual(prior, {})


if __name__ == "__main__":
    unittest.main()
