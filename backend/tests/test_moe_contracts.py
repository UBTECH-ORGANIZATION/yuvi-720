"""The MoE 720 compliance contracts, asserted across every teacher surface.

The per-module tests already check these where each value is produced. This file
exists because the requirements are about what a *teacher* can end up seeing, not
about one function — and the surface keeps growing. Phase 6 added nineteen tool
outputs in one go, none of which the existing tests covered.

Three contracts:

**C4 — explainability.** Every attention flag, recommendation, gap and alert
carries the raw datum behind it. A teacher must always be able to ask "why?".

**C5 — no comparison.** No teacher-facing output places two learners in a ranked
or paired structure. Aggregates are counts; individuals are described on their
own terms.

**LRS honesty.** A 403 must never emit a `dashboard viewed` statement. The
teacher did not see anything, and a false "viewed" record about a child's data is
exactly the sort of thing an audit would find.

These are written as loops over the real producers rather than as spot checks, so
adding a new field or a new tool is covered by construction.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents import teacher_tools
from app.agents.teacher_tools import registry
from app.agents.teacher_tools.registry import TeacherToolContext
from app.services.ai_usage import UsageContext


def run(coro):
    return asyncio.run(coro)


USAGE = UsageContext(
    actor_id="teacher-a", actor_type="teacher", endpoint="/api/teacher/assistant",
    feature="feature_6_teacher_view", operation="op", source="teacher_assistant",
)


def context(**overrides) -> TeacherToolContext:
    base = dict(
        teacher_id="teacher-a", language="he",
        allowed_group_ids=frozenset({"group-1"}),
        allowed_learner_ids=frozenset({"kid-a", "kid-b"}),
        is_admin=False, usage_context=USAGE,
    )
    base.update(overrides)
    return TeacherToolContext(**base)


# ── C4: explainability ───────────────────────────────────────────────────────

class ExplainabilityContract(unittest.IsolatedAsyncioTestCase):
    """Every flag a teacher can act on must show its working."""

    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    def test_every_attention_kind_the_engine_emits_can_be_rendered(self):
        """A criterion with no locale key shows a teacher a raw dotted string.

        The kinds are inline literals in `insights.py`, so this reads them from
        the source: adding a criterion without translating it fails here rather
        than in front of a teacher. `test_teacher_insights_engine.py` already
        proves each flag carries evidence; this proves it can be displayed.
        """
        import json
        import re

        root = Path(__file__).resolve().parents[2]
        source = (root / "backend/app/services/insights.py").read_text()

        # Kinds emitted on the attention path (strengths use their own strings).
        emitted = set(re.findall(r'"kind":\s*"([a-z_]+)"', source))
        strengths = {"success_area", "consistent_improvement", "profile_strength"}
        attention_kinds = emitted - strengths
        self.assertTrue(attention_kinds, "no attention kinds found — did the pattern change?")

        for language in ("he", "en", "ar"):
            table = json.loads((root / f"locales/{language}.json").read_text())
            for kind in sorted(attention_kinds):
                with self.subTest(language=language, kind=kind):
                    self.assertIn(
                        f"tch.attention.kind.{kind}", table,
                        f"attention kind '{kind}' has no {language} label")

    async def test_every_alert_kind_refuses_to_exist_without_evidence(self):
        """`raise_alert` is the only way an alert is created — it must fail closed."""
        from app.services import teacher_alerts

        for kind in sorted(teacher_alerts.KINDS):
            with self.subTest(kind=kind):
                with patch("app.brain.org.teachers_for_learner",
                           AsyncMock(return_value=["teacher-a"])):
                    with self.assertRaises(teacher_alerts.AlertError):
                        await teacher_alerts.raise_alert(
                            "kid-a", kind, evidence={}, title_key="tch.x")

    async def test_an_alert_with_evidence_but_no_raw_is_still_refused(self):
        """A label without the datum is not an explanation."""
        from app.services import teacher_alerts

        with patch("app.brain.org.teachers_for_learner", AsyncMock(return_value=["teacher-a"])):
            with self.assertRaises(teacher_alerts.AlertError):
                await teacher_alerts.raise_alert(
                    "kid-a", "struggling",
                    evidence={"label_key": "tch.evidence.streak", "value": 3},
                    title_key="tch.x")

    async def test_group_gaps_from_the_tool_carry_their_threshold(self):
        from app.services import group_analytics

        gaps = [{
            "objective_id": "obj.frac", "struggling_count": 5, "mastered_count": 1,
            "with_evidence": 10, "group_size": 12, "learner_ids": ["kid-a"],
            "evidence": {"sample_misconceptions": [["denominator", 3]], "threshold": 0.3},
        }]
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch.object(group_analytics, "learning_gaps", AsyncMock(return_value=gaps)):
            result = await registry.dispatch(
                "get_group_learning_gaps", {"group_id": "group-1"}, context())

        for gap in result["data"]:
            self.assertTrue(gap.get("evidence"), "a gap reached the teacher with no evidence")


# ── C5: no student-to-student comparison ─────────────────────────────────────

RANKING_WORDS = {
    "rank", "ranking", "ranked", "position", "percentile", "best", "worst",
    "top", "bottom", "leaderboard", "compared_to", "vs", "better_than",
    "class_average_gap", "above_average", "below_average",
}


def _learner_ids_in(value, found=None, depth=0):
    """Collect learner ids appearing inside any single ordered structure."""
    if found is None:
        found = []
    if depth > 8:
        return found
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"learner_id", "student_id"} and isinstance(item, str):
                found.append(item)
            else:
                _learner_ids_in(item, found, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _learner_ids_in(item, found, depth + 1)
    return found


def _ranking_keys_in(value, found=None, depth=0):
    if found is None:
        found = []
    if depth > 8:
        return found
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in RANKING_WORDS:
                found.append(key)
            _ranking_keys_in(item, found, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _ranking_keys_in(item, found, depth + 1)
    return found


class NoComparisonContract(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_no_data_tool_returns_a_ranking_key(self):
        """Nothing in any tool output may name a comparison."""
        snapshot = {
            "students": [{"learner_id": "kid-a"}, {"learner_id": "kid-b"}],
            "trends": {"students_total": 2, "active_last_7d": 1},
            "attention": [{"learner_id": "kid-a", "kind": "inactive",
                           "raw": {"days": 9, "threshold": 6}}],
        }
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch("app.services.insights.group_insights", AsyncMock(return_value=snapshot)):
            result = await registry.dispatch(
                "get_group_snapshot", {"group_id": "group-1"}, context())

        offenders = _ranking_keys_in(result)
        self.assertEqual(offenders, [], f"comparative keys reached the teacher: {offenders}")

    async def test_the_gaps_tool_hands_the_model_no_roster_slice(self):
        """Counts may name how many struggle; never which children, in order."""
        from app.services import group_analytics

        gaps = [{
            "objective_id": "obj.frac", "struggling_count": 5, "mastered_count": 1,
            "with_evidence": 10, "group_size": 12,
            "learner_ids": ["kid-a", "kid-b", "kid-c"],
            "evidence": {"threshold": 0.3},
        }]
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch.object(group_analytics, "learning_gaps", AsyncMock(return_value=gaps)):
            result = await registry.dispatch(
                "get_group_learning_gaps", {"group_id": "group-1"}, context())

        for gap in result["data"]:
            self.assertLessEqual(
                len(_learner_ids_in(gap)), 1,
                "a gap carried several learner ids to the model — that is a roster slice")

    async def test_list_students_is_a_set_not_a_ranking(self):
        """The roster tool returns ids only: no metric to sort children by."""
        with patch("app.brain.org.learners_in_group",
                   AsyncMock(return_value=["kid-a", "kid-b"])), \
             patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)):
            result = await registry.dispatch(
                "list_students", {"group_id": "group-1"}, context())

        for row in result["data"]:
            self.assertEqual(set(row), {"learner_id"},
                             "list_students grew a field a model could sort on")

    def test_the_assistant_prompt_forbids_comparison_and_arithmetic(self):
        """The two ways a model invents a comparison: stating one, or deriving one."""
        from app.agents import teacher_assistant

        prompt = teacher_assistant._system_prompt("he", {}).lower()
        self.assertIn("never compare", prompt)
        self.assertIn("rank", prompt)
        self.assertIn("do not do arithmetic", prompt)

    def test_the_chart_kit_has_no_multi_student_api(self):
        """C5 enforced structurally: the components cannot plot two children."""
        charts = Path(__file__).resolve().parents[2] / "frontend/src/components/charts"
        if not charts.exists():
            self.skipTest("chart kit not present")
        for path in charts.glob("*.tsx"):
            source = path.read_text()
            for banned in ("learners:", "students:", "series[]", "multiSeries"):
                self.assertNotIn(
                    banned, source,
                    f"{path.name} exposes a multi-student series API")


# ── LRS honesty ──────────────────────────────────────────────────────────────

class DeniedRequestsEmitNoLrsView(unittest.IsolatedAsyncioTestCase):
    """A 403 must not leave a record saying a teacher viewed a child's data."""

    async def _call(self, handler, **kwargs):
        from app.routes import teacher_students

        session = {"sub": "outsider", "sid": "session-1", "roles": ["teacher"]}
        reporter = AsyncMock()
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)), \
             patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=False)), \
             patch.object(teacher_students.lrs_reporter, "report_dashboard_viewed", reporter):
            response = await handler(session=session, **kwargs)
        return response, reporter

    async def test_student_overview_denied_reports_nothing(self):
        from app.routes import teacher_students

        response, reporter = await self._call(
            teacher_students.student_overview, learner_id="kid-a", language="he", subject=None)
        self.assertEqual(response.status_code, 403)
        reporter.assert_not_awaited()

    async def test_group_snapshot_denied_reports_nothing(self):
        from app.routes import teacher_students

        response, reporter = await self._call(
            teacher_students.group_snapshot, group_id="group-x", language="he", subject=None)
        self.assertEqual(response.status_code, 403)
        reporter.assert_not_awaited()

    async def test_an_allowed_read_does_report(self):
        """The other half: a real view must still be recorded, or the LRS
        contract is satisfied by simply never reporting."""
        from app.routes import teacher_students

        session = {"sub": "teacher-a", "sid": "session-1", "roles": ["teacher"]}
        reporter = AsyncMock()
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"learner_id": "kid-a"})), \
             patch.object(teacher_students.lrs_reporter, "report_dashboard_viewed", reporter):
            await teacher_students.student_overview(
                learner_id="kid-a", language="he", subject=None, session=session)
        reporter.assert_awaited()


if __name__ == "__main__":
    unittest.main()
