"""Teacher goal assignment and approval → sparks.

The property this file exists to protect is that the spark ledger stays true.
It is trivially easy to make approval "feel" rewarding by reporting a grant that
did not happen; a wallet that lies is worse than one that pays nothing. So:

* approving twice grants once and says `already_approved`,
* approving a goal the learner already summarized grants **zero** and says so
  with a different locale key,
* the daily cap is surfaced, not swallowed.

Everything routes through `mentoring.update_goal_progress`, the one path already
under test — a second way to grant sparks would be a second way to double-grant.
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.services import goal_approval, notifications


def _conversation(goal_overrides=None):
    return {
        "id": "conv-1",
        "learner_id": "kid",
        "author": "teacher",
        "deleted": False,
        "goals": [{
            "id": "goal-1",
            "title": "לתרגל שברים",
            "progress_stage": "chosen",
            "reward_value": 30,
            "approved_by": None,
            "approved_at": None,
            "deleted": False,
            **(goal_overrides or {}),
        }],
    }


class GoalApprovalTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        notifications.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()
        self._access = patch("app.brain.org.teacher_can_access_learner",
                             new=AsyncMock(return_value=True))
        self._access.start()

    async def asyncTearDown(self):
        self._collection.stop()
        self._access.stop()

    def _mentoring(self, record, *, granted=12, capped=False):
        """Patch the mentoring seam, returning the calls it received."""
        calls = {}

        async def progress(learner_id, conversation_id, goal_id, stage):
            calls["stage"] = stage
            calls["count"] = calls.get("count", 0) + 1
            return {"reward": {"granted": granted, "capped": capped, "wallet": {"balance": 99}}}

        return calls, (
            patch("app.services.mentoring._load_conversation",
                  new=AsyncMock(return_value=record)),
            patch("app.services.mentoring._save_conversation", new=AsyncMock()),
            patch("app.services.mentoring.update_goal_progress", new=progress),
        )

    # ── scoping ──────────────────────────────────────────────────────────────

    async def test_a_teacher_outside_the_group_cannot_approve(self):
        with patch("app.brain.org.teacher_can_access_learner",
                   new=AsyncMock(return_value=False)):
            with self.assertRaises(goal_approval.ApprovalError) as caught:
                await goal_approval.approve_goal("outsider", "kid", "conv-1", "goal-1")
        self.assertEqual(caught.exception.code, "not_authorized")

    async def test_a_teacher_outside_the_group_cannot_assign(self):
        with patch("app.brain.org.teacher_can_access_learner",
                   new=AsyncMock(return_value=False)):
            with self.assertRaises(goal_approval.ApprovalError) as caught:
                await goal_approval.assign_goal("outsider", "kid", {"title": "x"})
        self.assertEqual(caught.exception.code, "not_authorized")

    # ── approval ─────────────────────────────────────────────────────────────

    async def test_approving_grants_sparks_once_and_notifies(self):
        record = _conversation()
        calls, patches = self._mentoring(record)
        for entered in patches:
            entered.start()
        try:
            result = await goal_approval.approve_goal(
                "teacher-a", "kid", "conv-1", "goal-1", teacher_note="כל הכבוד")
        finally:
            for entered in patches:
                entered.stop()

        self.assertFalse(result["already_approved"])
        self.assertEqual(result["granted"], 12)
        self.assertEqual(calls["stage"], "summarized")
        self.assertEqual(record["goals"][0]["approved_by"], "teacher-a")
        self.assertEqual(record["goals"][0]["teacher_note"], "כל הכבוד")

        [row] = await notifications.list_for("kid")
        self.assertEqual(row["title_key"], "notif.goal.approved.withSparks")
        self.assertEqual(row["params"]["sparks"], 12)

    async def test_approving_twice_grants_once(self):
        record = _conversation()
        calls, patches = self._mentoring(record)
        for entered in patches:
            entered.start()
        try:
            await goal_approval.approve_goal("teacher-a", "kid", "conv-1", "goal-1")
            second = await goal_approval.approve_goal("teacher-a", "kid", "conv-1", "goal-1")
        finally:
            for entered in patches:
                entered.stop()

        self.assertTrue(second["already_approved"])
        self.assertEqual(second["granted"], 0)
        # The guard runs BEFORE any I/O: the reward path is not entered a second
        # time at all, rather than entered and rejected by the ledger.
        self.assertEqual(calls["count"], 1)
        self.assertEqual(len(await notifications.list_for("kid")), 1)

    async def test_a_goal_the_learner_already_summarized_grants_nothing_and_says_so(self):
        """The ledger row already exists, so there is nothing left to pay. The
        notification must not claim sparks that were not granted."""
        record = _conversation({"progress_stage": "summarized"})
        _, patches = self._mentoring(record, granted=0)
        for entered in patches:
            entered.start()
        try:
            result = await goal_approval.approve_goal("teacher-a", "kid", "conv-1", "goal-1")
        finally:
            for entered in patches:
                entered.stop()

        self.assertEqual(result["granted"], 0)
        self.assertTrue(result["already_earned"])
        self.assertFalse(result["capped"], "already-earned is not the same as capped")

        [row] = await notifications.list_for("kid")
        self.assertEqual(row["title_key"], "notif.goal.approved.noSparks")

    async def test_hitting_the_daily_cap_is_surfaced_not_swallowed(self):
        """The fifth approval of a day pays nothing. "Worth nothing" and "capped
        out" are different facts and the teacher should not have to guess."""
        record = _conversation()
        _, patches = self._mentoring(record, granted=0)
        for entered in patches:
            entered.start()
        try:
            result = await goal_approval.approve_goal("teacher-a", "kid", "conv-1", "goal-1")
        finally:
            for entered in patches:
                entered.stop()

        self.assertEqual(result["granted"], 0)
        self.assertTrue(result["capped"])
        self.assertFalse(result["already_earned"])

    async def test_a_missing_goal_is_reported_not_invented(self):
        record = _conversation()
        _, patches = self._mentoring(record)
        for entered in patches:
            entered.start()
        try:
            with self.assertRaises(goal_approval.ApprovalError) as caught:
                await goal_approval.approve_goal("teacher-a", "kid", "conv-1", "nope")
        finally:
            for entered in patches:
                entered.stop()
        self.assertEqual(caught.exception.code, "goal_not_found")

    # ── assignment ───────────────────────────────────────────────────────────

    async def test_assigning_goes_through_the_ordinary_creation_path(self):
        """So `_new_goal`, `_project_goals`, `price_goal` and the LRS
        `student-goal initialized` report all run once, where they are tested."""
        created = {"id": "conv-9", "goals": [{"id": "goal-9", "title": "לתרגל"}]}
        with patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)) as create:
            await goal_approval.assign_goal(
                "teacher-a", "kid", {"title": "לתרגל", "next_steps": "עמוד 12"})

        payload = create.await_args.args[0]
        self.assertEqual(payload["author"], "teacher", "drives the LRS instructor_exid")
        self.assertEqual(payload["source"], "teacher")
        self.assertTrue(payload["visible_to_learner"])
        self.assertEqual(payload["goals"][0]["title"], "לתרגל")

    async def test_an_assigned_goal_notifies_the_learner_with_a_deep_link(self):
        created = {"id": "conv-9", "goals": [{"id": "goal-9", "title": "לתרגל"}]}
        with patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)):
            await goal_approval.assign_goal("teacher-a", "kid", {"title": "לתרגל"})

        [row] = await notifications.list_for("kid")
        self.assertEqual(row["title_key"], "notif.goal.assigned")
        self.assertEqual(row["actions"][0]["route"],
                         "/mentoring?conversation=conv-9&goal=goal-9")

    async def test_a_goal_with_no_title_is_refused(self):
        with self.assertRaises(goal_approval.ApprovalError) as caught:
            await goal_approval.assign_goal("teacher-a", "kid", {"next_steps": "only steps"})
        self.assertEqual(caught.exception.code, "title_required")

    # ── sub-group assignment ─────────────────────────────────────────────────

    async def test_sub_group_assign_refuses_learners_outside_the_group(self):
        """The id list comes from the client. Being in the teacher's group is
        checked per learner, not assumed from the group id in the URL."""
        created = {"id": "c", "goals": [{"id": "g", "title": "t"}]}
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group",
                   new=AsyncMock(return_value=["kid-a", "kid-b"])), \
             patch("app.services.mentoring.list_conversations", new=AsyncMock(return_value=[])), \
             patch("app.brain.org.teacher_can_access_learner", new=AsyncMock(return_value=True)), \
             patch("app.services.notifications.notify", new=AsyncMock()), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)):
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", ["kid-a", "kid-b", "intruder"], {"title": "t"})

        self.assertEqual(result["assigned"], ["kid-a", "kid-b"])
        self.assertEqual(result["skipped"], [{"learner_id": "intruder", "reason": "not_in_group"}])

    async def test_sub_group_assign_is_refused_for_a_group_the_teacher_lacks(self):
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=False)):
            with self.assertRaises(goal_approval.ApprovalError) as caught:
                await goal_approval.assign_to_group("outsider", "group-1", ["kid"], {"title": "t"})
        self.assertEqual(caught.exception.code, "not_authorized")

    async def test_sub_group_assign_creates_one_goal_per_learner(self):
        """The happy path: six learners, six conversations, six notifications."""
        created = {"id": "c", "goals": [{"id": "g", "title": "לחזק שברים"}]}
        learners = [f"kid-{i}" for i in range(6)]
        notify = AsyncMock()
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.teacher_can_access_learner", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group", new=AsyncMock(return_value=learners)), \
             patch("app.services.mentoring.list_conversations", new=AsyncMock(return_value=[])), \
             patch("app.services.notifications.notify", notify), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)) as create:
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", learners, {"title": "לחזק שברים"})

        self.assertEqual(result["assigned"], learners)
        self.assertEqual(result["skipped"], [])
        self.assertEqual(create.await_count, 6)
        self.assertEqual(notify.await_count, 6)

    async def test_a_double_click_does_not_fan_the_same_goal_out_twice(self):
        """Idempotent per (learner, title, week) — the plan's requirement.

        The UI disables the button while in flight, but a retried request or a
        re-opened panel would otherwise give a child the same goal twice.
        """
        from datetime import datetime, timezone

        title = "לחזק שברים"
        # What the first click left behind.
        existing = [{
            "id": "c1", "author": "teacher",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "goals": [{"id": "g1", "title": title}],
        }]
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group", new=AsyncMock(return_value=["kid-a"])), \
             patch("app.services.mentoring.list_conversations",
                   new=AsyncMock(return_value=existing)), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock()) as create:
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", ["kid-a"], {"title": title})

        create.assert_not_awaited()
        self.assertEqual(result["assigned"], [])
        self.assertEqual(result["skipped"],
                         [{"learner_id": "kid-a", "reason": "already_assigned_this_week"}])

    async def test_the_same_goal_may_be_set_again_next_week(self):
        """The window is a week, not forever — re-setting an objective is normal."""
        title = "לחזק שברים"
        stale = [{
            "id": "c1", "author": "teacher", "created_at": "2026-01-05T09:00:00+00:00",
            "goals": [{"id": "g1", "title": title}],
        }]
        created = {"id": "c2", "goals": [{"id": "g2", "title": title}]}
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.teacher_can_access_learner", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group", new=AsyncMock(return_value=["kid-a"])), \
             patch("app.services.mentoring.list_conversations",
                   new=AsyncMock(return_value=stale)), \
             patch("app.services.notifications.notify", new=AsyncMock()), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)):
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", ["kid-a"], {"title": title})

        self.assertEqual(result["assigned"], ["kid-a"])

    async def test_a_self_authored_goal_does_not_block_a_teacher_assignment(self):
        """A child who set themselves a similar goal must still receive the teacher's."""
        from datetime import datetime, timezone

        title = "לחזק שברים"
        own = [{
            "id": "c1", "author": "learner",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "goals": [{"id": "g1", "title": title}],
        }]
        created = {"id": "c2", "goals": [{"id": "g2", "title": title}]}
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.teacher_can_access_learner", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group", new=AsyncMock(return_value=["kid-a"])), \
             patch("app.services.mentoring.list_conversations", new=AsyncMock(return_value=own)), \
             patch("app.services.notifications.notify", new=AsyncMock()), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)):
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", ["kid-a"], {"title": title})

        self.assertEqual(result["assigned"], ["kid-a"])

    async def test_a_lookup_failure_does_not_block_the_assignment(self):
        """Fail open here: refusing to assign because a dedupe read broke would
        silently drop a teacher's action."""
        created = {"id": "c", "goals": [{"id": "g", "title": "t"}]}
        with patch("app.brain.org.teacher_can_access_group", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.teacher_can_access_learner", new=AsyncMock(return_value=True)), \
             patch("app.brain.org.learners_in_group", new=AsyncMock(return_value=["kid-a"])), \
             patch("app.services.mentoring.list_conversations",
                   new=AsyncMock(side_effect=RuntimeError("cosmos timeout"))), \
             patch("app.services.notifications.notify", new=AsyncMock()), \
             patch("app.services.mentoring.create_conversation",
                   new=AsyncMock(return_value=created)):
            result = await goal_approval.assign_to_group(
                "teacher-a", "group-1", ["kid-a"], {"title": "t"})

        self.assertEqual(result["assigned"], ["kid-a"])


if __name__ == "__main__":
    unittest.main()
