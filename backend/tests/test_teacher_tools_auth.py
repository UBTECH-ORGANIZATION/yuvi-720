"""Phase 6 — the tool registry's authorization boundary.

The threat model is a *model*, not a user. The teacher is authenticated and
authorized; the risk is that an LLM — confused, or steered by text a student
typed into their own chat — emits `get_student_overview(learner_id="someone
else's kid")`. Every test here is that shape.

The property being asserted: **the model's argument is a claim, never an
authorization**. Scope comes from sets resolved server-side before the model
ran, plus a live DB re-check.
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
    actor_id="teacher-a", actor_type="teacher",
    endpoint="/api/teacher/assistant", feature="feature_6_teacher_view",
    operation="teacher_assistant.round_0", source="teacher_assistant",
)

MINE = "kid-mine"
THEIRS = "kid-theirs"
MY_GROUP = "group-mine"
THEIR_GROUP = "group-theirs"


def context(**overrides) -> TeacherToolContext:
    base = dict(
        teacher_id="teacher-a", language="he",
        allowed_group_ids=frozenset({MY_GROUP}),
        allowed_learner_ids=frozenset({MINE}),
        is_admin=False, usage_context=USAGE,
    )
    base.update(overrides)
    return TeacherToolContext(**base)


class _AuditSpy:
    """Captures audit rows without touching a database."""

    def __init__(self):
        self.rows: list[dict] = []

    async def insert_one(self, document):
        self.rows.append(document)


class ToolAuthorizationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self.audit = _AuditSpy()
        self._patch = patch("app.brain.repository._get_collection_named",
                            return_value=self.audit)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    # ── the core property ────────────────────────────────────────────────────

    async def test_out_of_scope_learner_is_refused(self):
        # The DB would say yes — but the server-resolved set says no, and that
        # set is what the model cannot influence.
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": THEIRS}, context()
            )
        self.assertEqual(result.get("error"), "not_authorized")

    async def test_refusal_happens_before_any_data_read(self):
        """A refused call must not touch the learner's brain at all."""
        insights = AsyncMock()
        with patch("app.services.insights.student_insights", insights), \
             patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            await registry.dispatch("get_student_overview", {"learner_id": THEIRS}, context())
        insights.assert_not_awaited()

    async def test_a_revoked_link_denies_even_though_the_set_still_allows(self):
        """Gate 4: the in-memory set is a cache; the DB is the authority."""
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": MINE}, context()
            )
        self.assertEqual(result.get("error"), "not_authorized")

    async def test_out_of_scope_group_is_refused(self):
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)):
            result = await registry.dispatch(
                "get_group_snapshot", {"group_id": THEIR_GROUP}, context()
            )
        self.assertEqual(result.get("error"), "not_authorized")

    async def test_an_invented_learner_id_fails_closed(self):
        """Not a plausible fiction — a refusal."""
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            result = await registry.dispatch(
                "get_student_mastery", {"learner_id": "kid-that-never-existed"}, context()
            )
        self.assertEqual(result.get("error"), "not_authorized")

    async def test_refusal_does_not_reveal_whether_the_student_exists(self):
        """Same answer for out-of-scope and non-existent — the difference leaks roster."""
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            real = await registry.dispatch(
                "get_student_overview", {"learner_id": THEIRS}, context())
            fake = await registry.dispatch(
                "get_student_overview", {"learner_id": "no-such-kid"}, context())
        self.assertEqual(real, fake)

    async def test_admin_bypasses_the_set_but_not_the_db(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"math": {}}, "struggle_items": []})):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": THEIRS}, context(is_admin=True)
            )
        self.assertIsNone(result.get("error"))

    # ── audit ────────────────────────────────────────────────────────────────

    async def test_a_refusal_writes_an_audit_row_marked_unauthorized(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            await registry.dispatch("get_student_overview", {"learner_id": THEIRS}, context())
        self.assertTrue(self.audit.rows)
        row = self.audit.rows[-1]
        self.assertFalse(row["authorized"])
        self.assertEqual(row["tool"], "get_student_overview")

    async def test_the_audit_records_argument_keys_but_never_values(self):
        """An audit log accumulating learner ids becomes its own privacy problem."""
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            await registry.dispatch("get_student_overview", {"learner_id": THEIRS}, context())
        row = self.audit.rows[-1]
        self.assertEqual(row["argument_keys"], ["learner_id"])
        self.assertNotIn(THEIRS, repr(row))

    # ── failure handling ─────────────────────────────────────────────────────

    async def test_unknown_tool_is_handled_not_raised(self):
        result = await registry.dispatch("delete_everything", {}, context())
        self.assertEqual(result.get("error"), "unknown_tool")

    async def test_a_handler_exception_becomes_a_result(self):
        """A crashing tool must not take the teacher's whole answer down."""
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(side_effect=RuntimeError("boom"))):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": MINE}, context())
        self.assertEqual(result.get("error"), "tool_failed")

    async def test_missing_required_argument_is_rejected(self):
        result = await registry.dispatch("get_student_overview", {}, context())
        self.assertTrue(str(result.get("error")).startswith("missing_required_argument"))

    async def test_wrong_argument_type_is_rejected(self):
        result = await registry.dispatch(
            "get_group_engagement", {"group_id": MY_GROUP, "days": "seven"}, context())
        self.assertTrue(str(result.get("error")).startswith("invalid_argument_type"))

    # ── budget ───────────────────────────────────────────────────────────────

    async def test_the_call_budget_caps_the_loop(self):
        ctx = context()
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {"m": {}}, "struggle_items": []})):
            for _ in range(teacher_tools.MAX_TOOL_CALLS):
                await registry.dispatch("get_student_overview", {"learner_id": MINE}, ctx)
            over = await registry.dispatch("get_student_overview", {"learner_id": MINE}, ctx)
        self.assertEqual(over.get("error"), "tool_budget_exhausted")

    # ── no writes ────────────────────────────────────────────────────────────

    def test_no_tool_in_the_registry_writes(self):
        """v1 is read-only: the assistant drafts, the teacher clicks."""
        forbidden = ("create", "assign", "approve", "delete", "update", "set_", "grant", "send")
        offenders = [
            tool.name for tool in registry.all_tools()
            if any(tool.name.startswith(prefix) for prefix in forbidden)
        ]
        self.assertEqual(offenders, [])


class NoPiiInToolResultsTests(unittest.IsolatedAsyncioTestCase):
    """The model must never receive a student's name."""

    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_student_overview_strips_display_name(self):
        payload = {
            "learner_id": MINE, "display_name": "רון", "progress": {"math": {"percent": 40}},
            "struggle_items": [{"label": "שברים", "display_name": "רון"}],
        }
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights", AsyncMock(return_value=payload)):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": MINE}, context())

        serialized = repr(result)
        self.assertNotIn("display_name", serialized)
        self.assertNotIn("רון", serialized, "a learner name reached the model")
        self.assertIn("progress", result["data"])

    async def test_group_snapshot_strips_names_at_every_depth(self):
        payload = {
            "students": [{"learner_id": MINE, "display_name": "רון"}],
            "attention": [{"learner_id": MINE, "display_name": "רון", "kind": "inactive"}],
        }
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch("app.services.insights.group_insights", AsyncMock(return_value=payload)):
            result = await registry.dispatch(
                "get_group_snapshot", {"group_id": MY_GROUP}, context())

        self.assertNotIn("רון", repr(result))

    async def test_gaps_do_not_hand_the_model_a_roster_slice(self):
        payload = [{
            "objective_id": "obj.frac", "struggling_count": 5, "with_evidence": 10,
            "learner_ids": [MINE, "kid-2", "kid-3"],
        }]
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=payload)):
            result = await registry.dispatch(
                "get_group_learning_gaps", {"group_id": MY_GROUP}, context())

        self.assertNotIn("learner_ids", result["data"][0])
        self.assertEqual(result["data"][0]["struggling_count"], 5)


class ExplicitEmptinessTests(unittest.IsolatedAsyncioTestCase):
    """Anti-hallucination layer 3: no data must never read as zero."""

    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_a_student_with_no_activity_returns_a_reason_not_a_zero(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=True)), \
             patch("app.services.insights.student_insights",
                   AsyncMock(return_value={"progress": {}, "struggle_items": []})):
            result = await registry.dispatch(
                "get_student_overview", {"learner_id": MINE}, context())

        self.assertIsNone(result["data"])
        self.assertEqual(result["reason"], "learner_has_no_activity")

    async def test_no_gaps_says_why(self):
        with patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)), \
             patch("app.services.group_analytics.learning_gaps", AsyncMock(return_value=[])):
            result = await registry.dispatch(
                "get_group_learning_gaps", {"group_id": MY_GROUP}, context())

        self.assertIsNone(result["data"])
        self.assertTrue(result["reason"])


class MetricDefinitionsTests(unittest.TestCase):
    """`explain_metric` is read from the live constants, so it cannot drift."""

    def test_inactivity_matches_the_live_constant(self):
        from app.services import insights, teacher_help_kb

        result = teacher_help_kb.explain_metric("inactivity")
        self.assertEqual(result["data"]["threshold_days"], insights.INACTIVITY_DAYS)

    def test_streak_matches_the_live_constant(self):
        from app.services import insights, teacher_help_kb

        result = teacher_help_kb.explain_metric("low_success_streak")
        self.assertEqual(result["data"]["threshold_attempts"], insights.LOW_SUCCESS_STREAK)

    def test_gap_threshold_matches_the_live_constant(self):
        from app.services import group_analytics, teacher_help_kb

        result = teacher_help_kb.explain_metric("learning_gap")
        self.assertEqual(result["data"]["threshold_share"], group_analytics.GAP_THRESHOLD)

    def test_the_five_moe_categories_are_listed(self):
        from app.services import teacher_help_kb

        categories = teacher_help_kb.explain_metric("recommendation_categories")["data"]["categories"]
        self.assertEqual(
            sorted(categories),
            sorted(["reinforce", "extra_practice", "deepen", "enrich", "refer_intervention"]),
        )

    def test_an_unknown_metric_lists_the_real_ones(self):
        from app.services import teacher_help_kb

        result = teacher_help_kb.explain_metric("vibes")
        self.assertIsNone(result["data"])
        self.assertIn("inactivity", result["available_metrics"])


class NavigationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        teacher_tools.install()
        self._patch = patch("app.brain.repository._get_collection_named", return_value=None)
        self._patch.start()

    def tearDown(self):
        self._patch.stop()

    async def test_navigate_offers_a_button_rather_than_redirecting(self):
        result = await registry.dispatch("navigate", {"screen": "home"}, context())
        self.assertEqual(result["data"]["action"], "offer_button")
        self.assertEqual(result["data"]["route"], "/teacher")

    async def test_navigate_rejects_a_model_authored_route(self):
        result = await registry.dispatch(
            "navigate", {"screen": "/etc/passwd"}, context())
        self.assertTrue(result.get("error") or result.get("reason"))

    async def test_navigating_to_a_student_is_scope_checked(self):
        with patch("app.brain.org.teacher_can_access_learner", AsyncMock(return_value=False)):
            result = await registry.dispatch(
                "navigate", {"screen": "student", "learner_id": THEIRS}, context())
        self.assertEqual(result.get("error"), "not_authorized")


if __name__ == "__main__":
    unittest.main()
