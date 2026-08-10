"""Teacher alerts: fanout scoping, dedupe, replay, and the evidence contract.

The single most important property here is the first test. An alert carries a
child's name and what they are struggling with; delivering one to a teacher
outside that child's groups is a data-protection incident, not a UI bug. So
recipients are resolved from the live roster at publish time and never from
anything the caller passed.
"""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.services import realtime, teacher_alerts


def _evidence(**raw):
    return {"label_key": "tch.evidence.detector.misconception", "value": "misconception",
            "raw": raw or {"fail_streak": 3}}


class TeacherAlertsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        teacher_alerts.reset_for_tests()
        realtime.reset_for_tests()
        # No database in tests: the module falls back to its in-memory store,
        # which is the same code path a credential-less dev box takes.
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()

    async def asyncTearDown(self):
        self._collection.stop()

    # ── scoping ──────────────────────────────────────────────────────────────

    async def test_an_alert_reaches_only_the_teachers_of_that_learner(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a", "teacher-b"])):
            stored = await teacher_alerts.raise_alert(
                "kid-1", "struggling",
                title_key="tch.alert.struggling.misconception",
                evidence=_evidence(),
            )

        self.assertEqual({row["teacher_id"] for row in stored}, {"teacher-a", "teacher-b"})
        # And nothing was written for anyone else.
        outsider = await teacher_alerts.list_alerts("teacher-c")
        self.assertEqual(outsider, [])

    # ── the bridge to the bell ───────────────────────────────────────────────

    async def test_an_urgent_alert_also_reaches_the_teacher_bell(self):
        """An urgent condition must survive the dashboard not being open.

        And it must arrive as TEACHER mail: one person can hold both roles, so a
        notification with the wrong `recipient_role` would surface a class
        emergency in the same account's learner bell.
        """
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])), \
             patch("app.services.notifications.notify", new=AsyncMock()) as notify:
            await teacher_alerts.raise_alert(
                "kid-1", "safety_flag", title_key="tch.alert.safety",
                evidence=_evidence(source="coach_chat"),
            )
        notify.assert_awaited_once()
        args, kwargs = notify.await_args
        self.assertEqual(args[0], "teacher-a")
        self.assertEqual(kwargs["recipient_role"], "teacher")
        self.assertTrue(kwargs["actions"][0]["route"].endswith("/kid-1"))

    async def test_an_attention_alert_does_not_ring_the_bell(self):
        """Only urgent. Every attention-level condition already lives in the
        inbox, and routing them all here would make the bell the same firehose."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])), \
             patch("app.services.notifications.notify", new=AsyncMock()) as notify:
            await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="tch.alert.struggling.misconception",
                evidence=_evidence(),
            )
        notify.assert_not_awaited()

    async def test_a_learner_nobody_teaches_produces_no_alert(self):
        """The orphan case. Not an error — it is the state the admin console
        surfaces on its Overview tab."""
        with patch("app.brain.org.teachers_for_learner", new=AsyncMock(return_value=[])):
            stored = await teacher_alerts.raise_alert(
                "orphan", "struggling", title_key="k", evidence=_evidence(),
            )
        self.assertEqual(stored, [])

    async def test_the_caller_cannot_choose_the_recipients(self):
        """Even `group_id` is decoration: fanout comes from the roster."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["only-real-teacher"])):
            stored = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(),
                group_id="a-group-they-are-not-in",
            )
        self.assertEqual([row["teacher_id"] for row in stored], ["only-real-teacher"])

    # ── the explainability contract ──────────────────────────────────────────

    async def test_an_alert_without_raw_evidence_is_refused(self):
        """MoE F6: flagging a student obliges us to show the datum behind it. A
        schema constraint, not a convention someone remembers."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            for bad in ({}, {"label_key": "k"}, {"label_key": "k", "raw": {}}):
                with self.subTest(evidence=bad):
                    with self.assertRaises(teacher_alerts.AlertError):
                        await teacher_alerts.raise_alert(
                            "kid-1", "struggling", title_key="k", evidence=bad,
                        )

    async def test_an_unknown_kind_is_refused(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            with self.assertRaises(teacher_alerts.AlertError):
                await teacher_alerts.raise_alert(
                    "kid-1", "made_up", title_key="k", evidence=_evidence(),
                )

    async def test_stored_alerts_carry_keys_and_params_never_rendered_text(self):
        """A teacher may switch language at any time; a frozen Hebrew string
        would not follow them."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "struggling",
                title_key="tch.alert.struggling.misconception",
                params={"objective_id": "OBJ.1"},
                evidence=_evidence(),
            )
        self.assertTrue(alert["title_key"].startswith("tch."))
        self.assertEqual(alert["params"], {"objective_id": "OBJ.1"})

    # ── dedupe ───────────────────────────────────────────────────────────────

    async def test_the_same_condition_counts_up_instead_of_ringing_twice(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            first = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(),
                bucket="OBJ.1",
            )
            second = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(fail_streak=5),
                bucket="OBJ.1",
            )

        self.assertEqual(first[0]["_id"], second[0]["_id"])
        self.assertEqual(second[0]["occurrences"], 2)
        self.assertEqual(second[0]["seq"], first[0]["seq"], "a recurrence must not burn a seq")
        # The evidence is refreshed — the teacher should see the current number.
        self.assertEqual(second[0]["evidence"]["raw"]["fail_streak"], 5)
        self.assertEqual(len(await teacher_alerts.list_alerts("teacher-a")), 1)

    async def test_a_different_objective_is_a_different_alert(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            await teacher_alerts.raise_alert("kid-1", "struggling", title_key="k",
                                             evidence=_evidence(), bucket="OBJ.1")
            await teacher_alerts.raise_alert("kid-1", "struggling", title_key="k",
                                             evidence=_evidence(), bucket="OBJ.2")
        self.assertEqual(len(await teacher_alerts.list_alerts("teacher-a")), 2)

    def test_the_bucket_matches_what_recurrence_means_for_each_kind(self):
        self.assertEqual(
            teacher_alerts.default_bucket("struggling", objective_id="OBJ.1"), "OBJ.1")
        self.assertEqual(
            teacher_alerts.default_bucket("goal_submitted", goal_id="g-9"), "g-9")
        self.assertEqual(
            teacher_alerts.default_bucket("safety_flag", flag_id="wb_1"), "wb_1")
        # "Still inactive" is one alert per day, not one per check.
        self.assertEqual(
            teacher_alerts.default_bucket("inactive", at="2026-08-03T09:00:00+00:00"),
            "2026-08-03")

    # ── replay ───────────────────────────────────────────────────────────────

    async def test_seq_is_monotonic_per_teacher(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            for index in range(3):
                await teacher_alerts.raise_alert(
                    "kid-1", "struggling", title_key="k",
                    evidence=_evidence(), bucket=f"OBJ.{index}",
                )
        seqs = [row["seq"] for row in await teacher_alerts.list_alerts("teacher-a")]
        self.assertEqual(seqs, sorted(seqs))
        self.assertEqual(len(set(seqs)), 3)

    async def test_since_replays_exactly_what_was_missed(self):
        """The reconnect path: no gaps, no duplicates."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            for index in range(4):
                await teacher_alerts.raise_alert(
                    "kid-1", "struggling", title_key="k",
                    evidence=_evidence(), bucket=f"OBJ.{index}",
                )
        everything = await teacher_alerts.list_alerts("teacher-a")
        cursor = everything[1]["seq"]        # the client saw the first two

        missed = await teacher_alerts.list_alerts("teacher-a", since=cursor)
        self.assertEqual([row["seq"] for row in missed],
                         [row["seq"] for row in everything[2:]])

    async def test_one_teachers_traffic_does_not_move_anothers_cursor(self):
        """`seq` is per teacher so a busy class cannot make a quiet teacher's
        cursor jump by thousands and look like missed alerts."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["busy"])):
            for index in range(5):
                await teacher_alerts.raise_alert("kid-1", "struggling", title_key="k",
                                                 evidence=_evidence(), bucket=f"O{index}")
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["quiet"])):
            [first] = await teacher_alerts.raise_alert("kid-2", "struggling", title_key="k",
                                                       evidence=_evidence(), bucket="O0")
        self.assertEqual(first["seq"], 1)

    # ── lifecycle ────────────────────────────────────────────────────────────

    async def test_acknowledge_and_resolve_move_the_status(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(),
            )

        acked = await teacher_alerts.acknowledge("teacher-a", alert["_id"])
        self.assertEqual(acked["status"], teacher_alerts.STATUS_ACKNOWLEDGED)
        self.assertEqual(acked["acknowledged_by"], "teacher-a")

        resolved = await teacher_alerts.resolve("teacher-a", alert["_id"])
        self.assertEqual(resolved["status"], teacher_alerts.STATUS_RESOLVED)
        self.assertIsNotNone(resolved["resolved_at"])

    async def test_a_teacher_cannot_touch_another_teachers_alert(self):
        """Ownership is part of the id, so guessing the key is not enough."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(),
            )
        self.assertIsNone(await teacher_alerts.acknowledge("teacher-b", alert["_id"]))
        self.assertIsNone(await teacher_alerts.resolve("teacher-b", alert["_id"]))

    async def test_a_resolved_condition_can_open_a_fresh_alert(self):
        """Resolving says "I dealt with it", not "never tell me again"."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(), bucket="OBJ.1",
            )
            await teacher_alerts.resolve("teacher-a", alert["_id"])
            [reopened] = await teacher_alerts.raise_alert(
                "kid-1", "struggling", title_key="k", evidence=_evidence(), bucket="OBJ.1",
            )
        self.assertEqual(reopened["status"], teacher_alerts.STATUS_OPEN)
        self.assertEqual(reopened["occurrences"], 1)
        self.assertGreater(reopened["seq"], alert["seq"])

    # ── delivery ─────────────────────────────────────────────────────────────

    async def test_a_new_alert_is_pushed_to_the_teachers_topic(self):
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe("teacher:teacher-a", heartbeat=5):
                frames.append(frame)

        import asyncio
        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)

        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            await teacher_alerts.raise_alert(
                "kid-1", "safety_flag", title_key="tch.alert.safety", evidence=_evidence(),
            )
        await asyncio.sleep(0.05)
        task.cancel()

        self.assertEqual([frame["type"] for frame in frames], ["alert"])
        self.assertEqual(frames[0]["alert"]["severity"], teacher_alerts.SEVERITY_URGENT)

    async def test_severity_distinguishes_an_interrupt_from_a_note(self):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            [safety] = await teacher_alerts.raise_alert(
                "kid-1", "safety_flag", title_key="k", evidence=_evidence())
            [goal] = await teacher_alerts.raise_alert(
                "kid-2", "goal_submitted", title_key="k", evidence=_evidence())
        self.assertEqual(safety["severity"], teacher_alerts.SEVERITY_URGENT)
        self.assertEqual(goal["severity"], teacher_alerts.SEVERITY_INFO)


if __name__ == "__main__":
    unittest.main()


class AlertVisibilityTest(unittest.IsolatedAsyncioTestCase):
    """Regressions found by driving two real browsers at the live lane."""

    async def asyncSetUp(self):
        teacher_alerts.reset_for_tests()
        realtime.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()

    async def asyncTearDown(self):
        self._collection.stop()

    async def _raise(self, **kwargs):
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            return await teacher_alerts.raise_alert(
                "kid-1", "coach_handoff", title_key="k",
                evidence=_evidence(), bucket="OBJ.1", **kwargs,
            )

    async def test_an_acknowledged_alert_survives_a_reload(self):
        """Acknowledging means "I have seen this", not "this is over". Querying
        `status=open` for the snapshot made acknowledged rows vanish on refresh
        while the UI was built to keep showing them dimmed."""
        [alert] = await self._raise()
        await teacher_alerts.acknowledge("teacher-a", alert["_id"])

        live = await teacher_alerts.list_alerts("teacher-a", status=teacher_alerts.LIVE)
        self.assertEqual([row["_id"] for row in live], [alert["_id"]])
        self.assertEqual(live[0]["status"], teacher_alerts.STATUS_ACKNOWLEDGED)

    async def test_a_resolved_alert_does_not_come_back_on_reload(self):
        [alert] = await self._raise()
        await teacher_alerts.resolve("teacher-a", alert["_id"])
        self.assertEqual(
            await teacher_alerts.list_alerts("teacher-a", status=teacher_alerts.LIVE), [])

    async def test_a_recurrence_reaches_the_screen_without_re_alarming(self):
        """Publishing nothing on a recurrence left the teacher looking at "×1"
        while the condition kept firing underneath. It must update — but keep its
        `seq` and its acknowledged state, so it does not jump back to the top or
        start shouting again."""
        frames: list[dict] = []

        async def collect():
            async for frame in realtime.subscribe("teacher:teacher-a", heartbeat=5):
                frames.append(frame)

        task = asyncio.create_task(collect())
        await asyncio.sleep(0.05)

        [first] = await self._raise()
        await teacher_alerts.acknowledge("teacher-a", first["_id"])
        # Let the consumer drain the open + acknowledge frames before clearing;
        # publishing only queues, so clearing too early leaves them to arrive
        # afterwards and land in the window under test.
        await asyncio.sleep(0.05)
        frames.clear()

        [again] = await self._raise()
        await asyncio.sleep(0.05)
        task.cancel()

        self.assertEqual(again["occurrences"], 2)
        self.assertEqual(again["seq"], first["seq"], "a recurrence must not jump the queue")
        self.assertEqual(again["status"], teacher_alerts.STATUS_ACKNOWLEDGED,
                         "a recurrence must not un-acknowledge itself")
        self.assertEqual([frame["type"] for frame in frames], ["alert"])
        self.assertTrue(frames[0].get("recurrence"))


class AuditFixTest(unittest.IsolatedAsyncioTestCase):
    """Holes found auditing Phase 4 before moving on."""

    async def asyncSetUp(self):
        teacher_alerts.reset_for_tests()
        realtime.reset_for_tests()
        self._collection = patch("app.brain.repository._get_collection_named", return_value=None)
        self._collection.start()

    async def asyncTearDown(self):
        self._collection.stop()

    async def test_the_cursor_survives_resolving_everything(self):
        """The snapshot cursor used to be the max `seq` of the alerts it was
        returning. A teacher who had dealt with everything got a cursor of 0, so
        the next reconnect replayed their entire alert history."""
        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            for index in range(3):
                [alert] = await teacher_alerts.raise_alert(
                    "kid-1", "struggling", title_key="k",
                    evidence=_evidence(), bucket=f"OBJ.{index}")
                await teacher_alerts.resolve("teacher-a", alert["_id"])

        self.assertEqual(await teacher_alerts.list_alerts(
            "teacher-a", status=teacher_alerts.LIVE), [])
        self.assertEqual(await teacher_alerts.latest_seq("teacher-a"), 3)
        # And asking for the high-water mark must not consume a number.
        self.assertEqual(await teacher_alerts.latest_seq("teacher-a"), 3)

    async def test_resolving_a_help_alert_lowers_the_live_help_badge(self):
        """`note_help_requested` had nothing to undo it, so the amber "asked for
        help" tile stayed lit long after the teacher had dealt with it."""
        from app.services import presence
        presence.reset_for_tests()

        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            presence.note_help_requested("kid-1")
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "coach_handoff", title_key="k", evidence=_evidence())

        self.assertIsNotNone(presence.snapshot("kid-1")["help_requested_at"])
        await teacher_alerts.resolve("teacher-a", alert["_id"])
        self.assertIsNone(presence.snapshot("kid-1")["help_requested_at"])

    async def test_acknowledging_does_not_lower_it(self):
        """Acknowledging is "I have seen this", not "I have been over there"."""
        from app.services import presence
        presence.reset_for_tests()

        with patch("app.brain.org.teachers_for_learner",
                   new=AsyncMock(return_value=["teacher-a"])):
            presence.note_help_requested("kid-1")
            [alert] = await teacher_alerts.raise_alert(
                "kid-1", "coach_handoff", title_key="k", evidence=_evidence())

        await teacher_alerts.acknowledge("teacher-a", alert["_id"])
        self.assertIsNotNone(presence.snapshot("kid-1")["help_requested_at"])
