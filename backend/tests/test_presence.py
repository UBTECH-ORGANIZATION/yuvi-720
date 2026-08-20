"""Presence: connections, lesson state, the grace window, and struggle.

The behaviour worth protecting is the honesty of it. A dropped socket is not a
child leaving, an SSE hook firing twice is not two children, and a struggle
nobody can see any more is not actionable. Each of those is a test below.
"""

from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timedelta, timezone
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


class ChatRecencyTest(unittest.IsolatedAsyncioTestCase):
    """A child mid-conversation with Yuvi must not read "last seen 40 min ago".

    Chat turns are the only sign of life between lesson verbs, but they arrive
    per message, so they are throttled rather than dropped.
    """

    async def asyncSetUp(self):
        presence.reset_for_tests()
        realtime.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()
        self._teachers = patch("app.brain.org.teachers_for_learner",
                               new=AsyncMock(return_value=[]))
        self._teachers.start()
        presence.note_connection("kid")

    async def asyncTearDown(self):
        self._collection.stop()
        self._teachers.stop()

    async def test_a_chat_turn_stamps_when_it_happened(self):
        presence.note_activity("kid")
        self.assertIsNotNone(presence.snapshot("kid")["chat_at"])

    async def test_a_burst_of_turns_costs_one_frame(self):
        with patch.object(presence, "_changed") as changed:
            for _ in range(6):
                presence.note_activity("kid")
        self.assertEqual(changed.call_count, 1, "six messages must not be six frames")

    async def test_the_next_frame_comes_once_the_window_has_passed(self):
        presence.note_activity("kid")
        stale = datetime.now(timezone.utc) - timedelta(
            seconds=presence.CHAT_FRAME_MIN_SECONDS + 1)
        presence._state["kid"]["chat_at"] = stale.isoformat()
        with patch.object(presence, "_changed") as changed:
            presence.note_activity("kid")
        self.assertEqual(changed.call_count, 1)

    async def test_a_chat_turn_is_never_written_to_the_database(self):
        """This is the hot path of every conversation. It broadcasts; it does
        not persist — a chat turn is not a transition."""
        with patch.object(presence, "_changed") as changed:
            presence.note_activity("kid")
        self.assertTrue(changed.call_args_list)
        for call in changed.call_args_list:
            self.assertFalse(call.kwargs["persist"])


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, length=None):
        return list(self._rows)


class _FakeCollection:
    def __init__(self, rows):
        self._rows = rows

    def find(self, *_args, **_kwargs):
        return _FakeCursor(self._rows)


class RehydrateTest(unittest.IsolatedAsyncioTestCase):
    """After a restart the class must not all read offline — and must not read
    online either. What comes back is what was *seen*, never what is true now."""

    STORED = {
        "_id": "kid", "learner_id": "kid",
        # Claims about "now" that this process has no evidence for:
        "status": presence.STATUS_IN_LESSON,
        "connections": 3,
        "lesson_entered_at": "2026-08-19T08:55:00+00:00",
        "struggling": {"kind": "wheel_spinning", "since": "2026-08-19T08:57:00+00:00"},
        "chat_at": "2026-08-19T08:59:00+00:00",
        "surface": "lesson",
        # Things that actually happened:
        "last_seen_at": "2026-08-19T09:00:00+00:00",
        "help_requested_at": "2026-08-19T08:58:00+00:00",
        "subject": "מתמטיקה",
        "unit_title": "מערכת צירים",
    }

    async def asyncSetUp(self):
        presence.reset_for_tests()
        realtime.reset_for_tests()
        # No database by default — `_rehydrate` supplies one for the call under
        # test. Without this, `note_connection` persists against the real one.
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()
        self._teachers = patch("app.brain.org.teachers_for_learner",
                               new=AsyncMock(return_value=[]))
        self._teachers.start()

    async def asyncTearDown(self):
        self._collection.stop()
        self._teachers.stop()

    async def _rehydrate(self, rows):
        with patch("app.brain.repository._get_collection_named",
                   return_value=_FakeCollection(rows)):
            return await presence.rehydrate()

    async def test_a_restored_learner_is_never_claimed_to_be_online(self):
        loaded = await self._rehydrate([dict(self.STORED)])
        self.assertEqual(loaded, 1)
        snapshot = presence.snapshot("kid")
        self.assertEqual(snapshot["status"], presence.STATUS_OFFLINE)
        self.assertEqual(snapshot["connections"], 0)
        self.assertIsNone(snapshot["lesson_entered_at"])
        self.assertIsNone(snapshot["struggling"])

    async def test_a_stale_chat_or_surface_is_not_resurrected(self):
        """Both drive "where is this child right now". Restoring them would put
        a disconnected learner in a chat that ended before the restart."""
        await self._rehydrate([dict(self.STORED)])
        snapshot = presence.snapshot("kid")
        self.assertIsNone(snapshot["chat_at"])
        self.assertIsNone(snapshot["surface"])

    async def test_what_was_seen_survives(self):
        await self._rehydrate([dict(self.STORED)])
        snapshot = presence.snapshot("kid")
        self.assertEqual(snapshot["last_seen_at"], "2026-08-19T09:00:00+00:00")
        self.assertEqual(snapshot["subject"], "מתמטיקה")
        self.assertEqual(snapshot["unit_title"], "מערכת צירים")

    async def test_a_raised_hand_outlives_a_restart(self):
        """It is a request that nobody answered, not a claim about liveness.
        Losing it on deploy drops a child who asked for help."""
        await self._rehydrate([dict(self.STORED)])
        self.assertEqual(
            presence.snapshot("kid")["help_requested_at"], "2026-08-19T08:58:00+00:00")

    async def test_a_learner_who_already_reconnected_is_left_alone(self):
        presence.note_connection("kid")
        loaded = await self._rehydrate([dict(self.STORED)])
        self.assertEqual(loaded, 0)
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_ONLINE)

    async def test_no_database_is_not_an_error(self):
        with patch("app.brain.repository._get_collection_named", return_value=None):
            self.assertEqual(await presence.rehydrate(), 0)


class SurfaceSignalTest(unittest.IsolatedAsyncioTestCase):
    """The learner's own client reports where it is. Advisory by design: it may
    place a child in the studio or on their dashboard, but it must never be able
    to fake the lesson state that xAPI owns — and repeats must cost nothing,
    because the client fires on every navigation."""

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

    async def test_screens_map_to_the_places_the_live_view_knows(self):
        for screen, surface in (
            # A lesson PAGE maps to browsing, never to "lesson": whereOf only
            # grants the lesson state from xAPI-fed status, so a "lesson"
            # surface would be recorded and then refused — rendering unknown.
            ("learning_lesson", "browsing"),
            ("teacher_app", "browsing"),
            ("learning_create", "studio"),
            ("results", "browsing"),
            ("student_dashboard", "browsing"),
            ("mentoring", "browsing"),
            ("learning_portal", "browsing"),
            ("learning_world", "browsing"),
            ("something_new", "unknown"),
        ):
            with self.subTest(screen=screen):
                presence.reset_for_tests()
                presence.note_surface("kid", screen)
                self.assertEqual(presence.snapshot("kid")["surface"], surface)

    async def test_a_surface_report_never_touches_status(self):
        """The one rule that makes the signal safe to accept from a client:
        claiming the lesson screen must not put you in a lesson."""
        presence.note_surface("kid", "learning_lesson")
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_OFFLINE)

        presence.note_connection("kid")
        presence.note_event("kid", {"verb": "entered", "component_id": "cmp-1"})
        presence.note_surface("kid", "results")     # left the lesson, says the client
        self.assertEqual(presence.snapshot("kid")["status"], presence.STATUS_IN_LESSON)

    async def test_reporting_the_same_screen_costs_nothing(self):
        presence.note_surface("kid", "results")
        with patch.object(presence, "_changed") as changed:
            presence.note_surface("kid", "results")
            presence.note_surface("kid", "results")
        self.assertEqual(changed.call_count, 0)

    async def test_moving_between_screens_of_one_bucket_still_reaches_the_view(self):
        """Dashboard and results are both "browsing", but the live view names
        them apart — so the move between them must cost a frame."""
        presence.note_surface("kid", "student_dashboard")
        with patch.object(presence, "_changed") as changed:
            presence.note_surface("kid", "results")
        self.assertEqual(changed.call_count, 1)
        self.assertEqual(presence.snapshot("kid")["surface_screen"], "results")

    async def test_the_lesson_page_names_its_learning_from_the_catalog(self):
        """The chip should say WHICH learning, not "on a lesson page" — and the
        name is the catalog's, never text the client sent."""
        with patch("app.services.kata_catalog.get_unit",
                   return_value={"id": "u-1", "title": "מערכת צירים", "subject": "math"}):
            presence.note_surface("kid", "learning_lesson", unit_id="u-1")
        self.assertEqual(presence.snapshot("kid")["surface_title"], "מערכת צירים")
        self.assertEqual(presence.snapshot("kid")["surface_subject"], "math")

        # Leaving the lesson screen clears the labels with the screen.
        presence.note_surface("kid", "results")
        self.assertIsNone(presence.snapshot("kid")["surface_title"])
        self.assertIsNone(presence.snapshot("kid")["surface_subject"])

    async def test_moving_between_two_lessons_is_still_a_move(self):
        """Same screen, different learning: the title is part of the place, so
        the change must cost a frame."""
        def unit(unit_id, _language=None):
            return {"id": unit_id, "title": f"שיעור {unit_id}"}
        with patch("app.services.kata_catalog.get_unit", side_effect=unit):
            presence.note_surface("kid", "learning_lesson", unit_id="u-1")
            with patch.object(presence, "_changed") as changed:
                presence.note_surface("kid", "learning_lesson", unit_id="u-2")
                presence.note_surface("kid", "learning_lesson", unit_id="u-2")
        self.assertEqual(changed.call_count, 1)
        self.assertEqual(presence.snapshot("kid")["surface_title"], "שיעור u-2")

    async def test_the_objective_name_outranks_the_exercise_name(self):
        """A teacher thinks in objectives; the exercise title is the fallback,
        never the headline."""
        with patch("app.services.kata_catalog.get_component",
                   return_value={"id": "c-1", "title": "תרגול בסיסי + סטנדרטי ב",
                                 "objective_id": "obj-1", "subject": "math"}), \
             patch("app.services.kata_catalog.get_unit", return_value=None), \
             patch("app.services.kata_catalog.localized_objective_title",
                   return_value="מערכת צירים - מספרים חיוביים"):
            presence.note_surface("kid", "learning_lesson", component_id="c-1")
        self.assertEqual(
            presence.snapshot("kid")["surface_title"], "מערכת צירים - מספרים חיוביים")
        self.assertEqual(presence.snapshot("kid")["surface_subject"], "math")

    async def test_an_unknown_unit_falls_back_to_no_title(self):
        with patch("app.services.kata_catalog.get_unit", return_value=None), \
             patch("app.services.kata_catalog.get_component", return_value=None):
            presence.note_surface("kid", "learning_lesson", unit_id="ghost")
        self.assertIsNone(presence.snapshot("kid")["surface_title"])
        self.assertEqual(presence.snapshot("kid")["surface_screen"], "learning_lesson")

    async def test_a_change_is_broadcast_and_persisted(self):
        with patch.object(presence, "_changed") as changed:
            presence.note_surface("kid", "learning_create")
        changed.assert_called_once_with("kid", persist=True)

    async def test_surface_at_is_when_they_arrived_not_when_they_last_reported(self):
        """This stamp is what the studio-budget and concentration work will
        read as "how long have they been here" — re-stamping it on every
        report would reset that clock to zero forever."""
        presence.note_surface("kid", "learning_create")
        arrived = presence.snapshot("kid")["surface_at"]
        presence.note_surface("kid", "learning_create")
        self.assertEqual(presence.snapshot("kid")["surface_at"], arrived)
