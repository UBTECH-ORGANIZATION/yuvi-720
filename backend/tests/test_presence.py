"""Presence: connections, lesson state, the grace window, and struggle.

The behaviour worth protecting is the honesty of it. A dropped socket is not a
child leaving, an SSE hook firing twice is not two children, and a struggle
nobody can see any more is not actionable. Each of those is a test below.
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.services import presence, realtime


class PresenceTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        presence.reset_for_tests()
        realtime.reset_for_tests()
        # No database, and no roster lookups reaching for one.
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()
        self._teachers = patch("app.brain.org.teachers_for_learner",
                               new=AsyncMock(return_value=[]))
        self._teachers.start()

    async def asyncTearDown(self):
        self._collection.stop()
        self._teachers.stop()

    # ── the default ──────────────────────────────────────────────────────────

    def test_an_unknown_learner_is_offline_not_missing(self):
        """Callers render this straight into a UI; returning None would make
        every consumer handle absence separately, and one of them would forget."""
        snapshot = presence.snapshot("never-seen")
        self.assertEqual(snapshot["status"], presence.STATUS_OFFLINE)
        self.assertIsNone(snapshot["last_seen_at"])

    # ── connections ──────────────────────────────────────────────────────────

    async def test_connecting_puts_a_learner_online(self):
        presence.note_connection("kid")
        snapshot = presence.snapshot("kid")
        self.assertEqual(snapshot["status"], presence.STATUS_ONLINE)
        self.assertIsNotNone(snapshot["last_seen_at"])

    async def test_a_dropped_connection_does_not_immediately_mean_gone(self):
        """Laptops sleep and proxies reap idle sockets. Flipping the dot on
        disconnect would show a class of children leaving every few minutes."""
        presence.note_connection("kid")
        presence.note_disconnection("kid")
        # Still online: the grace timer is running, not expired.
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_ONLINE)

    async def test_the_grace_window_eventually_marks_them_offline(self):
        presence.note_connection("kid")
        with patch.object(presence, "OFFLINE_GRACE_SECONDS", 0.05):
            presence.note_disconnection("kid")
            await asyncio.sleep(0.15)
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_OFFLINE)

    async def test_reconnecting_inside_the_grace_window_cancels_going_offline(self):
        presence.note_connection("kid")
        with patch.object(presence, "OFFLINE_GRACE_SECONDS", 0.1):
            presence.note_disconnection("kid")
            presence.note_connection("kid")          # came straight back
            await asyncio.sleep(0.2)
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_ONLINE)

    async def test_reconnecting_does_not_drag_them_out_of_a_lesson(self):
        """A reconnect mid-lesson is a network event, not a navigation."""
        presence.note_connection("kid")
        presence.note_event("kid", {"verb": "answered", "component_id": "cmp-1"})
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_IN_LESSON)

        presence.note_connection("kid")
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_IN_LESSON)

    async def test_going_offline_clears_a_struggle(self):
        """A struggle you can no longer watch is not something a teacher can act
        on — leaving the badge up would invite walking over to an empty seat."""
        presence.note_connection("kid")
        presence.note_struggle("kid", "misconception", {"fail_streak": 3})
        with patch.object(presence, "OFFLINE_GRACE_SECONDS", 0.05):
            presence.note_disconnection("kid")
            await asyncio.sleep(0.15)
        self.assertIsNone(presence.snapshot("kid")["struggling"])

    # ── lesson state from xAPI ───────────────────────────────────────────────

    async def test_content_verbs_put_a_learner_in_a_lesson(self):
        for verb in ("entered", "answered", "attempted"):
            with self.subTest(verb=verb):
                presence.reset_for_tests()
                presence.note_event("kid", {
                    "verb": verb, "component_id": "cmp-1",
                    "unit_id": "unit-1", "objective_id": "OBJ.1",
                })
                snapshot = presence.snapshot("kid")
                self.assertEqual(snapshot["status"], presence.STATUS_IN_LESSON)
                self.assertEqual(snapshot["component_id"], "cmp-1")
                self.assertEqual(snapshot["objective_id"], "OBJ.1")
                self.assertIsNotNone(snapshot["lesson_entered_at"])

    async def test_leaving_content_returns_them_to_browsing(self):
        presence.note_event("kid", {"verb": "answered", "component_id": "cmp-1"})
        presence.note_event("kid", {"verb": "exited", "component_id": "cmp-1"})
        snapshot = presence.snapshot("kid")
        self.assertEqual(snapshot["status"], presence.STATUS_ONLINE)
        self.assertIsNone(snapshot["lesson_entered_at"])

    async def test_lesson_entered_at_is_not_reset_by_every_answer(self):
        """It is "how long have they been in here", so it must survive the
        stream of events that happen while they are in here."""
        presence.note_event("kid", {"verb": "entered", "component_id": "cmp-1"})
        entered = presence.snapshot("kid")["lesson_entered_at"]
        presence.note_event("kid", {"verb": "answered", "component_id": "cmp-1"})
        self.assertEqual(presence.snapshot("kid")["lesson_entered_at"], entered)

    async def test_moving_on_clears_a_stale_struggle(self):
        presence.note_event("kid", {"verb": "answered", "component_id": "cmp-1"})
        presence.note_struggle("kid", "wheel_spinning", {"opportunities": 12})
        presence.note_event("kid", {"verb": "completed", "component_id": "cmp-1"})
        self.assertIsNone(presence.snapshot("kid")["struggling"])

    # ── struggle + help ──────────────────────────────────────────────────────

    async def test_a_struggle_carries_the_evidence_that_produced_it(self):
        """The teacher's card must be able to say *why*, never a bare badge."""
        presence.note_struggle("kid", "misconception", {"fail_streak": 3, "objective_id": "OBJ.1"})
        struggling = presence.snapshot("kid")["struggling"]
        self.assertEqual(struggling["kind"], "misconception")
        self.assertEqual(struggling["evidence"]["fail_streak"], 3)
        self.assertIsNotNone(struggling["since"])

    async def test_the_same_struggle_does_not_restart_its_clock(self):
        """"Since" is how long they have been stuck. Re-stamping it on every
        repeat detection would make a ten-minute struggle always read as new."""
        presence.note_struggle("kid", "misconception", {"fail_streak": 3})
        since = presence.snapshot("kid")["struggling"]["since"]
        presence.note_struggle("kid", "misconception", {"fail_streak": 4})
        self.assertEqual(presence.snapshot("kid")["struggling"]["since"], since)

    async def test_help_requested_is_recorded_and_clearable(self):
        presence.note_help_requested("kid")
        self.assertIsNotNone(presence.snapshot("kid")["help_requested_at"])
        presence.clear_help_requested("kid")
        self.assertIsNone(presence.snapshot("kid")["help_requested_at"])

    # ── chat counts as life ──────────────────────────────────────────────────

    async def test_talking_to_yuvi_counts_as_being_online(self):
        presence.note_activity("kid")
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_ONLINE)

    # ── group view ───────────────────────────────────────────────────────────

    async def test_the_group_view_includes_learners_who_are_absent(self):
        """A live strip that only lists who is online cannot answer "is anyone
        missing?" — and the absent ones are the point."""
        presence.note_connection("here")
        with patch("app.brain.org.learners_in_group",
                   new=AsyncMock(return_value=["here", "absent"])):
            rows = await presence.snapshot_for_group("group-1")

        by_id = {row["learner_id"]: row for row in rows}
        self.assertEqual(by_id["here"]["status"], presence.STATUS_ONLINE)
        self.assertEqual(by_id["absent"]["status"], presence.STATUS_OFFLINE)

    # ── fanout scoping ───────────────────────────────────────────────────────

    async def test_presence_frames_reach_only_this_learners_teachers(self):
        frames: list[dict] = []

        async def collect(topic):
            async for frame in realtime.subscribe(topic, heartbeat=5):
                frames.append((topic, frame))

        mine = asyncio.create_task(collect("teacher:theirs"))
        outsider = asyncio.create_task(collect("teacher:outsider"))
        await asyncio.sleep(0.05)

        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["theirs"])):
            presence.note_connection("kid")
            await asyncio.sleep(0.1)

        mine.cancel()
        outsider.cancel()

        topics = {topic for topic, _ in frames}
        self.assertEqual(topics, {"teacher:theirs"})
        self.assertEqual(frames[0][1]["type"], "presence")

    # ── bus integration ──────────────────────────────────────────────────────

    async def test_the_bus_hooks_drive_presence_end_to_end(self):
        """The whole point of the `on_subscribe` hook: a learner opening the app
        goes online without the client having to announce anything."""
        presence.install_hooks()
        agen = realtime.subscribe("learner:kid", heartbeat=5)
        task = asyncio.create_task(_consume(agen))
        await asyncio.sleep(0.05)

        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_ONLINE)

        with patch.object(presence, "OFFLINE_GRACE_SECONDS", 0.05):
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            await asyncio.sleep(0.2)

        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_OFFLINE)


async def _consume(agen):
    async for _ in agen:
        pass


if __name__ == "__main__":
    unittest.main()


class IdlePresenceTest(unittest.IsolatedAsyncioTestCase):
    """The idle watchdog publishes straight from a timer, bypassing
    `triggers.evaluate` — so the teacher escalation wired into that loop never
    saw it, and a learner sitting on one screen doing nothing looked fine on the
    live strip."""

    async def asyncSetUp(self):
        presence.reset_for_tests()
        realtime.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()
        self._teachers = patch("app.brain.org.teachers_for_learner",
                               new=AsyncMock(return_value=[]))
        self._teachers.start()

    async def asyncTearDown(self):
        self._collection.stop()
        self._teachers.stop()

    async def test_the_idle_watchdog_marks_the_learner_stuck(self):
        from app.services import triggers
        triggers._last_published.clear()
        triggers.publish_idle("kid", "OBJ.1")

        struggling = presence.snapshot("kid")["struggling"]
        self.assertIsNotNone(struggling, "an idle stretch must show on the live strip")
        self.assertEqual(struggling["kind"], "idle")
        self.assertEqual(struggling["evidence"]["objective_id"], "OBJ.1")

    async def test_idle_does_not_raise_a_teacher_alert(self):
        """Presence only. Sitting still for two minutes is not an interrupt."""
        from app.services import teacher_alerts, triggers
        teacher_alerts.reset_for_tests()
        triggers._last_published.clear()
        triggers.publish_idle("kid", "OBJ.1")
        self.assertEqual(await teacher_alerts.list_alerts("anyone"), [])
