"""Notifications: idempotency, the soft delete, and the ownership boundary.

Two properties carry most of the weight here.

**Nothing a user was told ever disappears.** Dismissal stamps a timestamp; the
document survives and can be shown again. A notification is the record of what
someone was told and when — a safety escalation dismissed unread is exactly the
row an incident review needs.

**One event, one row, one ring.** Ids are deterministic per underlying event, so
a retry, a double click or a replay cannot ring the bell twice.
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from app.services import notifications, realtime


class NotificationsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        notifications.reset_for_tests()
        realtime.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()

    async def asyncTearDown(self):
        self._collection.stop()

    async def _notify(self, recipient="kid", notification_id="goal_approved:g1", **kwargs):
        return await notifications.notify(
            recipient, notifications.KIND_GOAL_APPROVED,
            notification_id=notification_id,
            title_key="notif.goal.approved.withSparks",
            params={"title": "שברים", "sparks": 12},
            actions=[{"label_key": "notif.action.openGoal",
                      "route": "/mentoring?conversation=c1&goal=g1"}],
            **kwargs,
        )

    # ── content ──────────────────────────────────────────────────────────────

    async def test_a_row_stores_keys_and_params_never_rendered_text(self):
        """A user can switch language at any moment. A stored Hebrew sentence
        would be frozen in a language they no longer read."""
        row = await self._notify()
        self.assertEqual(row["title_key"], "notif.goal.approved.withSparks")
        self.assertEqual(row["params"]["sparks"], 12)
        # No field holds a rendered sentence.
        self.assertNotIn("title", row)
        self.assertNotIn("body", row)
        self.assertNotIn("text", row)

    async def test_every_notification_carries_a_deep_link(self):
        """Without one it is an announcement the user then has to go and find
        the subject of."""
        row = await self._notify()
        self.assertTrue(row["actions"])
        self.assertIn("conversation=c1", row["actions"][0]["route"])
        self.assertIn("goal=g1", row["actions"][0]["route"])

    async def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            await notifications.notify("kid", "made_up", notification_id="x", title_key="k")

    # ── idempotency ──────────────────────────────────────────────────────────

    async def test_the_same_event_produces_exactly_one_row(self):
        first = await self._notify()
        second = await self._notify()
        self.assertIsNotNone(first)
        self.assertIsNone(second, "a repeat must be recognised, not stored again")
        self.assertEqual(len(await notifications.list_for("kid")), 1)

    async def test_a_repeat_does_not_ring_the_bell_again(self):
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe("user:kid", heartbeat=5):
                frames.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)

        await self._notify()
        await asyncio.sleep(0.05)
        await self._notify()
        await asyncio.sleep(0.05)
        task.cancel()

        self.assertEqual(len(frames), 1, "the second attempt must not push a frame")

    async def test_a_dismissed_notification_cannot_re_ring(self):
        """The deterministic id is what makes this true: a hard delete would let
        the same event fire again and re-light the bell."""
        await self._notify()
        await notifications.dismiss("kid", ["goal_approved:g1"])
        self.assertIsNone(await self._notify())
        self.assertEqual(await notifications.unread_count("kid"), 0)

    # ── the soft delete ──────────────────────────────────────────────────────

    async def test_dismissing_stamps_a_timestamp_and_keeps_the_document(self):
        await self._notify()
        await notifications.dismiss("kid", ["goal_approved:g1"])

        self.assertEqual(await notifications.list_for("kid"), [])
        kept = await notifications.list_for("kid", include_dismissed=True)
        self.assertEqual(len(kept), 1)
        self.assertIsNotNone(kept[0]["dismissed_at"])

    async def test_dismissing_also_marks_it_read(self):
        """Otherwise the badge stays lit for a row the user explicitly cleared."""
        await self._notify()
        await notifications.dismiss("kid", ["goal_approved:g1"])
        self.assertEqual(await notifications.unread_count("kid"), 0)

    async def test_clear_all_is_a_bulk_soft_delete_not_a_purge(self):
        for index in range(3):
            await self._notify(notification_id=f"goal_approved:g{index}")
        await notifications.dismiss_all("kid")

        self.assertEqual(await notifications.list_for("kid"), [])
        self.assertEqual(len(await notifications.list_for("kid", include_dismissed=True)), 3)

    # ── read state ───────────────────────────────────────────────────────────

    async def test_unread_count_tracks_reads(self):
        for index in range(3):
            await self._notify(notification_id=f"goal_approved:g{index}")
        self.assertEqual(await notifications.unread_count("kid"), 3)

        await notifications.mark_read("kid", ["goal_approved:g0"])
        self.assertEqual(await notifications.unread_count("kid"), 2)

        await notifications.mark_all_read("kid")
        self.assertEqual(await notifications.unread_count("kid"), 0)

    async def test_marking_read_twice_does_not_double_count(self):
        await self._notify()
        self.assertEqual(await notifications.mark_read("kid", ["goal_approved:g1"]), 1)
        self.assertEqual(await notifications.mark_read("kid", ["goal_approved:g1"]), 0)

    async def test_newest_first(self):
        for index in range(3):
            await self._notify(notification_id=f"goal_approved:g{index}")
            await asyncio.sleep(0.01)
        rows = await notifications.list_for("kid")
        self.assertEqual([row["_id"] for row in rows],
                         ["goal_approved:g2", "goal_approved:g1", "goal_approved:g0"])

    # ── the ownership boundary ───────────────────────────────────────────────

    async def test_one_user_cannot_read_anothers_notifications(self):
        await self._notify(recipient="kid")
        self.assertEqual(await notifications.list_for("someone-else"), [])
        self.assertEqual(await notifications.unread_count("someone-else"), 0)

    async def test_one_user_cannot_mark_anothers_notifications_read(self):
        """The id is guessable, so ownership is re-checked per row rather than
        trusted from the request."""
        await self._notify(recipient="kid")
        self.assertEqual(
            await notifications.mark_read("someone-else", ["goal_approved:g1"]), 0)
        self.assertEqual(await notifications.unread_count("kid"), 1)

    async def test_one_user_cannot_dismiss_anothers_escalation(self):
        await self._notify(recipient="kid")
        self.assertEqual(
            await notifications.dismiss("someone-else", ["goal_approved:g1"]), 0)
        self.assertEqual(len(await notifications.list_for("kid")), 1)

    async def test_dismiss_all_only_touches_the_caller(self):
        await self._notify(recipient="kid")
        await self._notify(recipient="other-kid", notification_id="goal_approved:other")
        await notifications.dismiss_all("kid")
        self.assertEqual(len(await notifications.list_for("other-kid")), 1)

    # ── two hats, two inboxes ────────────────────────────────────────────────

    async def _both_hats(self):
        """One account holding both roles — `gal` is exactly this."""
        await self._notify(recipient="gal", notification_id="goal_approved:g1")
        await notifications.notify(
            "gal", notifications.KIND_ALERT,
            notification_id="alert:a1", title_key="tch.alert.safety",
            recipient_role=notifications.ROLE_TEACHER,
        )

    async def test_each_portal_sees_only_its_own_mail(self):
        await self._both_hats()
        learner = await notifications.list_for("gal", role=notifications.ROLE_LEARNER)
        teacher = await notifications.list_for("gal", role=notifications.ROLE_TEACHER)
        self.assertEqual([row["_id"] for row in learner], ["goal_approved:g1"])
        self.assertEqual([row["_id"] for row in teacher], ["alert:a1"])
        # And unscoped still means "everything", for anything that wants both.
        self.assertEqual(len(await notifications.list_for("gal")), 2)

    async def test_the_badge_counts_one_hat_at_a_time(self):
        await self._both_hats()
        self.assertEqual(await notifications.unread_count("gal", role=notifications.ROLE_LEARNER), 1)
        self.assertEqual(await notifications.unread_count("gal", role=notifications.ROLE_TEACHER), 1)
        self.assertEqual(await notifications.unread_count("gal"), 2)

    async def test_mark_all_read_in_one_portal_leaves_the_other_alone(self):
        """Otherwise clearing the teacher bell silently swallows the goal
        approval waiting in the same person's learner bell."""
        await self._both_hats()
        await notifications.mark_all_read("gal", role=notifications.ROLE_TEACHER)
        self.assertEqual(await notifications.unread_count("gal", role=notifications.ROLE_LEARNER), 1)
        self.assertEqual(await notifications.unread_count("gal", role=notifications.ROLE_TEACHER), 0)

    async def test_rows_written_before_the_field_existed_are_learner_mail(self):
        """That is all the lane carried then — treating them as teacher mail
        would move a child's goal approval into a teacher's bell."""
        row = await self._notify(recipient="gal")
        row.pop("recipient_role", None)
        self.assertEqual(
            [r["_id"] for r in await notifications.list_for("gal", role=notifications.ROLE_LEARNER)],
            ["goal_approved:g1"])

    # ── delivery ─────────────────────────────────────────────────────────────

    async def test_it_rides_the_recipients_own_topic(self):
        """Learners already hold that topic through the coach stream, so a
        notification costs no extra connection."""
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe("user:kid", heartbeat=5):
                frames.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)
        await self._notify()
        await asyncio.sleep(0.05)
        task.cancel()

        self.assertEqual(frames[0]["type"], "notification")
        self.assertEqual(frames[0]["notification"]["_id"], "goal_approved:g1")


if __name__ == "__main__":
    unittest.main()
