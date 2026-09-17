"""The session registry: one `exit` per session, filed at the moment the
session really ended, and a new session for activity after a timeout."""

from __future__ import annotations

import os
import time
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

from app.services.lrs import session_registry as registry
from app.services.lrs import statements

ENV = {
    "SPARK_STORAGE": "json",
    "LRS_ENABLED": "true",
    "LRS_TOKEN_URL": "https://lrs-stg.education.gov.il/auth/oauth/v2/token",
    "LRS_STATEMENTS_URL": "https://lrs-stg.education.gov.il/xAPI/statements",
    "LRS_CLIENT_ID": "cid",
    "LRS_CLIENT_SECRET": "secret",
    "LRS_SUPPLIER_DOMAIN": "https://spark.yuvilab.co.il",
    "LRS_KATA_ECAT_ID": "123456",
    "LRS_TEST_EXIDENTIFIER": "1012345678",
    "LRS_SESSION_IDLE_MINUTES": "30",
}
IDENTITY = {"exidentifier": "1012345678", "school": "123456", "nmm": None}
T0 = datetime(2026, 9, 17, 10, 0, tzinfo=timezone.utc)


class RegistryTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        registry.reset_for_tests()
        statements.reset_timestamp_sequence_for_tests()
        self.env = mock.patch.dict(os.environ, ENV, clear=False)
        self.env.start()
        self.enqueued: list[dict] = []

        async def enqueue(statement, **_kwargs):
            self.enqueued.append(statement)

        self.patches = [
            mock.patch.object(registry.reporter.outbox, "enqueue", side_effect=enqueue),
            mock.patch.object(
                registry.reporter.identity_mod, "resolve_reporting_identity",
                new=mock.AsyncMock(return_value=IDENTITY),
            ),
            mock.patch("app.auth.repository.set_current_moe_session", new=mock.AsyncMock()),
            mock.patch("app.auth.repository.get_user_by_id", new=mock.AsyncMock(return_value=None)),
        ]
        for patch in self.patches:
            patch.start()
        registry.reporter._warned_identities.clear()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.env.stop()
        registry.reset_for_tests()

    def verbs(self) -> list[str]:
        return [s["verb"]["id"].rsplit("/", 1)[-1] for s in self.enqueued]

    def exits(self) -> list[dict]:
        return [s for s in self.enqueued if s["verb"]["id"].endswith("/exit")]


class LifecycleTests(RegistryTestCase):
    async def test_open_then_logout_files_enter_and_one_exit_with_the_gross_duration(self):
        await registry.open("u1", "s1", roles=["learner"], device={"deviceType": "Desktop"}, at=T0)
        closed = await registry.close("s1", reason="logout", at=T0 + timedelta(minutes=12, seconds=34))
        self.assertTrue(closed)
        self.assertEqual(self.verbs(), ["enter", "exit"])
        exit_ = self.exits()[0]
        self.assertEqual(exit_["result"]["duration"], "PT12M34S")
        self.assertEqual(exit_["timestamp"], "2026-09-17T10:12:34Z")

    async def test_closing_twice_files_one_exit_and_the_id_is_the_sessions_own(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        self.assertTrue(await registry.close("s1", reason="logout", at=T0 + timedelta(minutes=1)))
        self.assertFalse(await registry.close("s1", reason="timeout", at=T0 + timedelta(minutes=2)))
        self.assertEqual(len(self.exits()), 1)
        expected = str(uuid.uuid5(uuid.NAMESPACE_URL, f"{ENV['LRS_SUPPLIER_DOMAIN']}/session/s1#exit"))
        self.assertEqual(self.exits()[0]["id"], expected)
        # The builder alone is deterministic too — a resend carries the same id.
        again = statements.session_exit(IDENTITY, "s1", 60)
        self.assertEqual(again["id"], expected)

    async def test_suspend_resume_move_the_sign_of_life(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.suspend("s1", at=T0 + timedelta(minutes=5))
        row = await registry.load("s1")
        self.assertEqual(row["suspended_at"], (T0 + timedelta(minutes=5)).isoformat())
        await registry.resume("s1", at=T0 + timedelta(minutes=6))
        row = await registry.load("s1")
        self.assertIsNone(row["suspended_at"])
        self.assertEqual(row["last_seen_at"], (T0 + timedelta(minutes=6)).isoformat())


class TimeoutTests(RegistryTestCase):
    async def test_a_closed_tab_exits_at_its_last_suspend_after_the_idle_window(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.suspend("s1", at=T0 + timedelta(minutes=8))  # pagehide beacon
        self.assertEqual(await registry.sweep(now=T0 + timedelta(minutes=20)), 0)
        self.assertEqual(await registry.sweep(now=T0 + timedelta(minutes=39)), 1)
        exit_ = self.exits()[0]
        self.assertEqual(exit_["timestamp"], "2026-09-17T10:08:00Z")
        self.assertEqual(exit_["result"]["duration"], "PT8M0S")
        self.assertEqual((await registry.load("s1"))["exit_reason"], "timeout")

    async def test_a_killed_browser_exits_at_its_last_ping(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.touch("s1", at=T0 + timedelta(minutes=5), force=True)
        await registry.touch("s1", at=T0 + timedelta(minutes=10), force=True)
        self.assertEqual(await registry.sweep(now=T0 + timedelta(minutes=41)), 1)
        self.assertEqual(self.exits()[0]["timestamp"], "2026-09-17T10:10:00Z")
        self.assertEqual(self.exits()[0]["result"]["duration"], "PT10M0S")

    async def test_the_idle_window_is_configurable(self):
        with mock.patch.dict(os.environ, {"LRS_SESSION_IDLE_MINUTES": "2"}):
            await registry.open("u1", "s1", roles=["learner"], at=T0)
            self.assertEqual(await registry.sweep(now=T0 + timedelta(minutes=3)), 1)

    async def test_a_live_session_is_never_swept(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        for minute in (10, 20, 30, 40):
            await registry.touch("s1", at=T0 + timedelta(minutes=minute), force=True)
            self.assertEqual(await registry.sweep(now=T0 + timedelta(minutes=minute + 1)), 0)


class ReloginTests(RegistryTestCase):
    async def test_signing_in_again_ends_the_previous_session_first(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.touch("s1", at=T0 + timedelta(minutes=3), force=True)
        await registry.open("u1", "s2", roles=["learner"], at=T0 + timedelta(minutes=9))
        self.assertEqual(self.verbs(), ["enter", "exit", "enter"])
        exit_ = self.exits()[0]
        self.assertTrue(exit_["object"]["id"].endswith("/session/s1"))
        self.assertEqual(exit_["timestamp"], "2026-09-17T10:03:00Z")
        self.assertEqual((await registry.load("s1"))["exit_reason"], "relogin")
        self.assertIsNone((await registry.load("s2"))["exited_at"])

    async def test_another_users_session_is_left_alone(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.open("u2", "s2", roles=["learner"], at=T0)
        self.assertIsNone((await registry.load("s1"))["exited_at"])


class EffectiveSidTests(RegistryTestCase):
    async def test_a_live_session_resolves_to_itself(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
        self.assertEqual(await registry.effective_sid(payload), "s1")

    async def test_activity_after_a_timeout_opens_a_new_session_once(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.sweep(now=T0 + timedelta(hours=1))
        payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
        first = await registry.effective_sid(payload)
        registry._effective.clear()
        second = await registry.effective_sid(payload)
        self.assertNotEqual(first, "s1")
        self.assertEqual(first, second)
        self.assertEqual(self.verbs(), ["enter", "exit", "enter"])
        self.assertEqual((await registry.load("s1"))["successor_sid"], first)
        self.assertEqual((await registry.load(first))["predecessor_sid"], "s1")

    async def test_a_request_after_logout_does_not_open_a_session_nobody_is_in(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.close("s1", reason="logout", at=T0 + timedelta(minutes=5))
        payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
        # The stray in-flight request (a beacon, a poll) stays on the exited id.
        self.assertEqual(await registry.effective_sid(payload), "s1")
        self.assertEqual(self.verbs(), ["enter", "exit"])

    async def test_an_old_tab_after_a_relogin_follows_the_users_live_session(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.open("u1", "s2", roles=["learner"], at=T0 + timedelta(minutes=5))  # closes s1: relogin
        payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
        self.assertEqual(await registry.effective_sid(payload), "s2")
        # One session per user: no third session, no extra enter.
        self.assertEqual(self.verbs(), ["enter", "exit", "enter"])

    async def test_a_statement_is_a_sign_of_life_so_a_timeout_exit_lands_after_it(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        # Requests touch the row throttled; a statement filed a minute later
        # must still move last-seen, or the exit would be stamped before it.
        registry._touched["s1"] = time.monotonic()
        await registry.reporter.report_session_resume("u1", "s1")
        filed = self.enqueued[-1]["timestamp"]
        await registry.sweep(now=datetime.now(timezone.utc) + timedelta(hours=1))
        exit_statement = self.exits()[-1]
        self.assertGreaterEqual(exit_statement["timestamp"], filed)

    async def test_the_last_sign_of_life_is_the_later_of_suspend_and_last_seen(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.suspend("s1", at=T0 + timedelta(minutes=5))
        # Content kept reporting while the tab was hidden (a video running on).
        await registry.touch("s1", at=T0 + timedelta(minutes=9), force=True)
        await registry.sweep(now=T0 + timedelta(hours=1))
        self.assertEqual(self.exits()[-1]["timestamp"], (T0 + timedelta(minutes=9)).strftime("%Y-%m-%dT%H:%M:%SZ"))

    async def test_a_tab_left_open_after_a_relogin_and_logout_opens_nothing(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.open("u1", "s2", roles=["learner"], at=T0 + timedelta(minutes=5))  # s1: relogin
        await registry.close("s2", reason="logout", at=T0 + timedelta(minutes=9))
        payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
        # The old tab's ping finds no live session and starts none.
        self.assertEqual(await registry.effective_sid(payload), "s1")
        self.assertEqual(self.verbs(), ["enter", "exit", "enter", "exit"])

    async def test_a_cookie_the_registry_never_saw_is_adopted_from_its_own_start(self):
        payload = {"sub": "u1", "sid": "legacy", "roles": ["learner"], "iat": T0.timestamp()}
        self.assertEqual(await registry.effective_sid(payload), "legacy")
        row = await registry.load("legacy")
        self.assertEqual(row["started_at"], T0.isoformat())
        # …so a later logout still measures from the sign-in.
        await registry.close("legacy", reason="logout", at=T0 + timedelta(minutes=4))
        self.assertEqual(self.exits()[0]["result"]["duration"], "PT4M0S")

    async def test_logout_of_an_unknown_session_measures_from_the_token(self):
        closed = await registry.close(
            "ghost", reason="logout", at=T0 + timedelta(minutes=7),
            user_id="u1", fallback_started_at=T0,
        )
        self.assertTrue(closed)
        self.assertEqual(self.exits()[0]["result"]["duration"], "PT7M0S")
        self.assertFalse(await registry.close("ghost", reason="logout", user_id="u1", fallback_started_at=T0))

    async def test_reporting_off_leaves_the_cookie_alone(self):
        with mock.patch.dict(os.environ, {"LRS_ENABLED": "false"}):
            payload = {"sub": "u1", "sid": "s1", "roles": ["learner"]}
            self.assertEqual(await registry.effective_sid(payload), "s1")
        self.assertIsNone(await registry.load("s1"))


if __name__ == "__main__":
    unittest.main()


class SequencedTimestampTests(unittest.TestCase):
    """The ministry reads a session as a sequence at second resolution: two
    statements of one actor never share a second, and order is kept."""

    def setUp(self):
        statements.reset_timestamp_sequence_for_tests()

    def tearDown(self):
        statements.reset_timestamp_sequence_for_tests()

    def test_statements_of_one_actor_are_a_second_apart_in_order(self):
        first = statements.session_suspend(IDENTITY, "s1")
        second = statements.session_resume(IDENTITY, "s1")
        third = statements.session_suspend(IDENTITY, "s1")
        stamps = [first["timestamp"], second["timestamp"], third["timestamp"]]
        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(len(set(stamps)), 3)
        parsed = [datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ") for s in stamps]
        self.assertGreaterEqual((parsed[1] - parsed[0]).total_seconds(), 1)
        self.assertGreaterEqual((parsed[2] - parsed[1]).total_seconds(), 1)

    def test_other_actors_are_not_pushed(self):
        statements.session_suspend(IDENTITY, "s1")
        other = statements.session_suspend({**IDENTITY, "exidentifier": "1020000002"}, "s2")
        self.assertLessEqual(
            datetime.strptime(other["timestamp"], "%Y-%m-%dT%H:%M:%SZ"),
            datetime.utcnow().replace(microsecond=0) + timedelta(seconds=1),
        )

    def test_an_explicit_past_timestamp_is_kept_when_nothing_followed_it(self):
        exit_ = statements.session_exit(IDENTITY, "s1", 60, timestamp="2026-09-17T10:08:00Z")
        self.assertEqual(exit_["timestamp"], "2026-09-17T10:08:00Z")

    def test_a_relayed_content_timestamp_is_floored_and_sequenced(self):
        raw = {
            "verb": {"id": "http://adlnet.gov/expapi/verbs/initialized"},
            "object": {"id": "https://lomdot.example/x/methodica-1-01"},
            "timestamp": "2026-09-17T10:00:00.400Z",
        }
        a = statements.enriched_content_statement(IDENTITY, "s1", raw)
        b = statements.enriched_content_statement(IDENTITY, "s1", {**raw, "timestamp": "2026-09-17T10:00:00.900Z"})
        self.assertEqual(a["timestamp"], "2026-09-17T10:00:00Z")
        self.assertEqual(b["timestamp"], "2026-09-17T10:00:01Z")


class SuspendResumePairsTests(RegistryTestCase):
    async def test_suspend_and_resume_are_strict_transitions(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        self.assertTrue(await registry.suspend("s1", at=T0 + timedelta(minutes=1)))
        self.assertFalse(await registry.suspend("s1", at=T0 + timedelta(minutes=1, seconds=1)))
        self.assertTrue(await registry.resume("s1", at=T0 + timedelta(minutes=2)))
        self.assertFalse(await registry.resume("s1", at=T0 + timedelta(minutes=2, seconds=1)))

    async def test_a_resume_without_a_suspend_is_not_a_transition(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        self.assertFalse(await registry.resume("s1", at=T0 + timedelta(minutes=2)))
        self.assertEqual((await registry.load("s1"))["last_seen_at"], (T0 + timedelta(minutes=2)).isoformat())

    async def test_an_exited_session_neither_suspends_nor_resumes(self):
        await registry.open("u1", "s1", roles=["learner"], at=T0)
        await registry.close("s1", reason="logout", at=T0 + timedelta(minutes=1))
        self.assertFalse(await registry.suspend("s1"))
        self.assertFalse(await registry.resume("s1"))
