"""Org scoping (F8) — the access-control contract every teacher surface rests on.

A miss here is not a cosmetic bug: it is one child's data shown to the wrong
adult. These tests therefore assert the *denials* as hard as the grants.

Runs against the JSON fallback (no Mongo needed): `org_repository` degrades to
`.runtime/org.json`, which is redirected to a temp dir per test.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain import org
from app.services import org_repository


def run(coro):
    return asyncio.run(coro)


class OrgScopingTest(unittest.TestCase):
    def setUp(self) -> None:
        # Point the fallback store at a throwaway file and force the fallback
        # path (no Mongo in unit tests).
        self._tmp = tempfile.TemporaryDirectory()
        self._original_file = org_repository.FALLBACK_ORG_FILE
        org_repository.FALLBACK_ORG_FILE = Path(self._tmp.name) / "org.json"

        self._original_getter = org_repository._get_collection_named
        org_repository._get_collection_named = lambda name: None  # type: ignore[assignment]

        run(self._seed())

    def tearDown(self) -> None:
        org_repository.FALLBACK_ORG_FILE = self._original_file
        org_repository._get_collection_named = self._original_getter  # type: ignore[assignment]
        self._tmp.cleanup()

    async def _seed(self) -> None:
        await org_repository.upsert_school("school-a", name="School A")
        await org_repository.upsert_group("g-shared", school_id="school-a", name="Shared")
        await org_repository.upsert_group("g-alice", school_id="school-a", name="Alice only")
        await org_repository.upsert_group("g-bob", school_id="school-a", name="Bob only")

        # Shared group is co-taught: the many-to-many the requirement calls for.
        await org_repository.link_teacher("alice", "g-shared", school_id="school-a")
        await org_repository.link_teacher("bob", "g-shared", school_id="school-a")
        await org_repository.link_teacher("alice", "g-alice", school_id="school-a")
        await org_repository.link_teacher("bob", "g-bob", school_id="school-a")

        await org_repository.enroll_learner("kid-shared", "g-shared", school_id="school-a")
        await org_repository.enroll_learner("kid-alice", "g-alice", school_id="school-a")
        await org_repository.enroll_learner("kid-bob", "g-bob", school_id="school-a")
        # Enrolled nowhere — must be invisible to teachers but findable by admin.
        # (no enrollment row for "kid-orphan" on purpose)

    # ── grants ───────────────────────────────────────────────────────────────

    def test_co_taught_learner_visible_to_both_teachers(self):
        self.assertTrue(run(org.teacher_can_access_learner("alice", "kid-shared")))
        self.assertTrue(run(org.teacher_can_access_learner("bob", "kid-shared")))

    def test_teacher_reaches_own_exclusive_learner(self):
        self.assertTrue(run(org.teacher_can_access_learner("alice", "kid-alice")))
        self.assertTrue(run(org.teacher_can_access_learner("bob", "kid-bob")))

    def test_groups_for_teacher_lists_only_linked_groups(self):
        ids = {group["id"] for group in run(org.groups_for_teacher("alice"))}
        self.assertEqual(ids, {"g-shared", "g-alice"})

    def test_teachers_for_learner_drives_alert_fanout(self):
        # This is what the realtime fanout resolves at publish time.
        self.assertEqual(
            sorted(run(org.teachers_for_learner("kid-shared"))), ["alice", "bob"]
        )
        self.assertEqual(run(org.teachers_for_learner("kid-alice")), ["alice"])

    # ── denials ──────────────────────────────────────────────────────────────

    def test_teacher_cannot_reach_other_teachers_exclusive_learner(self):
        self.assertFalse(run(org.teacher_can_access_learner("alice", "kid-bob")))
        self.assertFalse(run(org.teacher_can_access_learner("bob", "kid-alice")))

    def test_teacher_cannot_reach_unenrolled_learner(self):
        self.assertFalse(run(org.teacher_can_access_learner("alice", "kid-orphan")))

    def test_unknown_teacher_reaches_nothing(self):
        self.assertFalse(run(org.teacher_can_access_learner("nobody", "kid-shared")))
        self.assertEqual(run(org.groups_for_teacher("nobody")), [])

    def test_teacher_cannot_reach_unlinked_group(self):
        self.assertFalse(run(org.teacher_can_access_group("alice", "g-bob")))

    # ── revocation must land immediately ─────────────────────────────────────

    def test_unlinking_a_teacher_revokes_access_at_once(self):
        self.assertTrue(run(org.teacher_can_access_learner("bob", "kid-shared")))
        run(org_repository.unlink_teacher("bob", "g-shared"))
        self.assertFalse(run(org.teacher_can_access_learner("bob", "kid-shared")))
        # Alice is untouched — revocation is per link, not per group.
        self.assertTrue(run(org.teacher_can_access_learner("alice", "kid-shared")))

    def test_unenrolling_a_learner_revokes_access_at_once(self):
        run(org_repository.unenroll_learner("kid-shared", "g-shared"))
        self.assertFalse(run(org.teacher_can_access_learner("alice", "kid-shared")))

    def test_inactive_enrollment_is_excluded_from_group_roster(self):
        run(org_repository.unenroll_learner("kid-alice", "g-alice"))
        self.assertEqual(run(org.learners_in_group("g-alice")), [])

    def test_archived_group_drops_out_of_teacher_scope(self):
        run(org_repository.archive_group("g-alice"))
        ids = {group["id"] for group in run(org.groups_for_teacher("alice"))}
        self.assertEqual(ids, {"g-shared"})

    # ── admin ────────────────────────────────────────────────────────────────

    def test_admin_sees_every_learner_and_group(self):
        run(org_repository.grant_admin("root", scope="system"))
        self.assertTrue(run(org.is_admin("root")))
        self.assertTrue(run(org.teacher_can_access_learner("root", "kid-bob")))
        self.assertTrue(run(org.teacher_can_access_learner("root", "kid-orphan")))
        self.assertTrue(run(org.teacher_can_access_group("root", "g-bob")))
        self.assertEqual(len(run(org.groups_for_teacher("root"))), 3)

    def test_revoked_admin_loses_scope_immediately(self):
        run(org_repository.grant_admin("root", scope="system"))
        run(org_repository.revoke_admin("root"))
        self.assertFalse(run(org.is_admin("root")))
        self.assertFalse(run(org.teacher_can_access_learner("root", "kid-bob")))

    def test_school_scoped_admin_is_limited_to_their_schools(self):
        run(org_repository.upsert_school("school-b", name="School B"))
        run(org_repository.upsert_group("g-other", school_id="school-b", name="Other"))
        run(org_repository.grant_admin("dean", scope="school", school_ids=["school-b"]))
        ids = {group["id"] for group in run(org.groups_for_teacher("dean"))}
        self.assertEqual(ids, {"g-other"})

    def test_admin_is_not_in_the_alert_fanout(self):
        # Admins can read on demand; they are not flooded with every child's
        # live alerts.
        run(org_repository.grant_admin("root", scope="system"))
        self.assertNotIn("root", run(org.teachers_for_learner("kid-shared")))

    # ── orphans ──────────────────────────────────────────────────────────────

    def test_unassigned_learners_are_surfaced(self):
        orphans = run(org.unassigned_learners(
            ["kid-shared", "kid-alice", "kid-bob", "kid-orphan"]
        ))
        self.assertEqual(orphans, ["kid-orphan"])

    # ── audit ────────────────────────────────────────────────────────────────

    def test_audit_records_actor_and_before_after(self):
        run(org_repository.record_audit(
            actor_id="root", action="unlink_teacher", target_type="teacher_link",
            target_id="bob:g-shared", before={"active": True}, after={"active": False},
        ))
        rows = run(org_repository.list_audit(target_id="bob:g-shared"))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["actor_id"], "root")
        self.assertEqual(rows[0]["before"], {"active": True})
        self.assertEqual(rows[0]["after"], {"active": False})


if __name__ == "__main__":
    unittest.main()
