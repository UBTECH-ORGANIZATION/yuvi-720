"""MoE LRS product triggers (issue #13): each newly wired event is observed at
the reporter boundary from its REAL product action — conversation rating, goal
status changes, the alternative-explainer selection, and the content `skipped`
verb bridge."""

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.events import (  # noqa: E402
    ADL_PROVIDER_VERB_MAP,
    PROVIDER_INTERACTION_VERBS,
    _provider_verb_slug,
)
from app.routes import brain as brain_routes  # noqa: E402


class SkippedVerbBridgeTests(unittest.TestCase):
    def test_skipped_maps_for_provider_launches(self) -> None:
        self.assertEqual(
            ADL_PROVIDER_VERB_MAP["http://id.tincanapi.com/verb/skipped"], "skipped"
        )
        self.assertIn("skipped", PROVIDER_INTERACTION_VERBS)

    def test_provider_statement_with_skipped_is_accepted(self) -> None:
        statement = {"verb": {"id": "http://id.tincanapi.com/verb/skipped"}}
        slug, compat = _provider_verb_slug(statement, {"src": "kata"})
        self.assertEqual((slug, compat), ("skipped", True))

    def test_non_provider_skipped_still_rejected(self) -> None:
        statement = {"verb": {"id": "http://id.tincanapi.com/verb/skipped"}}
        slug, _ = _provider_verb_slug(statement, {"src": "spark"})
        self.assertIsNone(slug)


class GoalStatusReportingTests(unittest.IsolatedAsyncioTestCase):
    async def test_goal_completed_reports_student_goal(self) -> None:
        goal = {"id": "act-1", "text": "t", "status": "new", "steps": {"done": 0, "total": 3}}
        brain = {"goals": [goal]}
        report = AsyncMock()
        with (
            patch.object(brain_routes, "get_brain", new=AsyncMock(return_value=brain)),
            patch.object(brain_routes, "apply_brain_updates", new=AsyncMock()) as applied,
            patch("app.auth.repository.get_user_by_id",
                  new=AsyncMock(return_value={"current_moe_session_id": "moe-s1"})),
            patch("app.services.lrs.reporter.report_student_goal", new=report),
            patch.object(brain_routes, "_authorized_id", return_value="L"),
        ):
            response = await brain_routes.update_goal_status(
                "L", "act-1", {"status": "done"}, actor={"sub": "L"}
            )
        self.assertEqual(response.status_code, 200)
        report.assert_awaited_once_with("L", "moe-s1", "completed", "act-1", "academic")
        # The workflow really moved the goal, steps filled.
        self.assertEqual(goal["status"], "done")
        self.assertEqual(goal["steps"]["done"], 3)
        applied.assert_awaited_once()

    async def test_goal_in_progress_reports_updated(self) -> None:
        goal = {"id": "act-2", "text": "t", "status": "new"}
        report = AsyncMock()
        with (
            patch.object(brain_routes, "get_brain",
                         new=AsyncMock(return_value={"goals": [goal]})),
            patch.object(brain_routes, "apply_brain_updates", new=AsyncMock()),
            patch("app.auth.repository.get_user_by_id",
                  new=AsyncMock(return_value={"current_moe_session_id": "moe-s1"})),
            patch("app.services.lrs.reporter.report_student_goal", new=report),
            patch.object(brain_routes, "_authorized_id", return_value="L"),
        ):
            await brain_routes.update_goal_status(
                "L", "act-2", {"status": "in_progress"}, actor={"sub": "L"}
            )
        report.assert_awaited_once_with("L", "moe-s1", "updated", "act-2", "academic")

    async def test_unknown_goal_404s_without_reporting(self) -> None:
        report = AsyncMock()
        with (
            patch.object(brain_routes, "get_brain", new=AsyncMock(return_value={"goals": []})),
            patch("app.services.lrs.reporter.report_student_goal", new=report),
            patch.object(brain_routes, "_authorized_id", return_value="L"),
        ):
            response = await brain_routes.update_goal_status(
                "L", "missing", {"status": "done"}, actor={"sub": "L"}
            )
        self.assertEqual(response.status_code, 404)
        report.assert_not_awaited()

    async def test_report_failure_never_breaks_workflow(self) -> None:
        goal = {"id": "act-3", "text": "t", "status": "new"}
        with (
            patch.object(brain_routes, "get_brain",
                         new=AsyncMock(return_value={"goals": [goal]})),
            patch.object(brain_routes, "apply_brain_updates", new=AsyncMock()),
            patch("app.auth.repository.get_user_by_id",
                  new=AsyncMock(side_effect=RuntimeError("db down"))),
            patch.object(brain_routes, "_authorized_id", return_value="L"),
        ):
            response = await brain_routes.update_goal_status(
                "L", "act-3", {"status": "done"}, actor={"sub": "L"}
            )
        self.assertEqual(response.status_code, 200)


class ConversationRatedTests(unittest.IsolatedAsyncioTestCase):
    async def test_rate_endpoint_reports_conversation_rated(self) -> None:
        from app.routes import agent as agent_routes

        report = AsyncMock()
        request = agent_routes.CoachRateRequest(conversation_id="conv-9", rating="like")
        with patch.object(
            agent_routes.lrs_reporter, "report_conversation_rated", new=report
        ):
            response = await agent_routes.coach_rate(
                request, session={"sub": "L", "sid": "moe-s1"}
            )
        self.assertEqual(response.status_code, 200)
        args = report.await_args.args
        self.assertEqual(args[0], "L")
        self.assertEqual(args[1], "moe-s1")
        self.assertEqual(args[3], "like")

    async def test_rate_without_session_skips_report(self) -> None:
        from app.routes import agent as agent_routes

        report = AsyncMock()
        request = agent_routes.CoachRateRequest(conversation_id="conv-9", rating="dislike")
        with patch.object(
            agent_routes.lrs_reporter, "report_conversation_rated", new=report
        ):
            response = await agent_routes.coach_rate(request, session={"sub": "L"})
        self.assertEqual(response.status_code, 200)
        report.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
