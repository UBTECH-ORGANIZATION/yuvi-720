"""Admin control plane — guardrails and the audit trail.

The console can hand one adult access to another adult's students, so the
interesting assertions here are the refusals and the paper trail, not the happy
path.
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import admin_org, org_repository
from app.services.admin_org import AdminError


def run(coro):
    return asyncio.run(coro)


class AdminOrgTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)

        # Force the JSON fallback for both stores (no Mongo in unit tests).
        self._org_file = org_repository.FALLBACK_ORG_FILE
        org_repository.FALLBACK_ORG_FILE = root / "org.json"
        self._org_getter = org_repository._get_collection_named
        org_repository._get_collection_named = lambda name: None  # type: ignore[assignment]

        from app.auth import repository as users_repo
        self._users_repo = users_repo
        self._users_file = users_repo.FALLBACK_USERS_FILE
        users_repo.FALLBACK_USERS_FILE = root / "users.json"
        self._users_collection = users_repo._collection
        users_repo._collection = lambda: None  # type: ignore[assignment]

        # Provisioning a learner seeds a brain document. Without this the test
        # writes into whatever `MONGODB_CONNECTION_STRING` points at — which is
        # a live Cosmos database on a dev box. Pin the brain store to the temp
        # dir too, so the suite can never touch real learner data.
        from app.brain import repository as brain_repo
        self._brain_repo = brain_repo
        self._brain_file = brain_repo.FALLBACK_BRAIN_FILE
        brain_repo.FALLBACK_BRAIN_FILE = root / "learners_brain.json"
        self._brain_collection = brain_repo._get_collection
        brain_repo._get_collection = lambda: None  # type: ignore[assignment]

        # `get_brain` also reads legacy `learner_state` during migration, which
        # opens its own client. Cut that too, or the suite still dials Cosmos.
        import learner_state
        self._legacy_state = learner_state
        self._legacy_collection = learner_state._get_collection
        learner_state._get_collection = lambda: None  # type: ignore[assignment]

        run(self._seed())

    def tearDown(self) -> None:
        org_repository.FALLBACK_ORG_FILE = self._org_file
        org_repository._get_collection_named = self._org_getter  # type: ignore[assignment]
        self._users_repo.FALLBACK_USERS_FILE = self._users_file
        self._users_repo._collection = self._users_collection  # type: ignore[assignment]
        self._brain_repo.FALLBACK_BRAIN_FILE = self._brain_file
        self._brain_repo._get_collection = self._brain_collection  # type: ignore[assignment]
        self._legacy_state._get_collection = self._legacy_collection  # type: ignore[assignment]
        self._tmp.cleanup()

    async def _seed(self) -> None:
        from app.auth.passwords import hash_password
        for user_id, roles in (
            ("root", ["teacher", "admin"]), ("alice", ["teacher"]),
            ("bob", ["teacher"]), ("kid1", ["learner"]), ("kid2", ["learner"]),
        ):
            await self._users_repo.upsert_user({
                "_id": user_id, "username": user_id, "display_name": user_id.title(),
                "roles": roles, "password": hash_password("Aa12345"),
            })
        await org_repository.grant_admin("root", scope="system")
        await admin_org.save_school("root", {"id": "s1", "name": "School One"})
        await admin_org.save_group("root", {"id": "g1", "school_id": "s1", "name": "Group One"})
        await admin_org.link_teacher("root", "alice", "g1")
        await admin_org.enroll_learner("root", "kid1", "g1")

    # ── overview surfaces the invisible ──────────────────────────────────────

    def test_overview_surfaces_unassigned_learners_and_teacherless_groups(self):
        run(admin_org.save_group("root", {"id": "g2", "school_id": "s1", "name": "Empty"}))
        data = run(admin_org.overview())
        self.assertIn("kid2", [row["learner_id"] for row in data["unassigned_learners"]])
        self.assertIn("g2", [row["id"] for row in data["teacherless_groups"]])
        self.assertEqual(data["counts"]["students"], 2)

    # ── connections, both directions ─────────────────────────────────────────

    def test_teacher_connections_answers_which_students_can_they_see(self):
        view = run(admin_org.teacher_connections("alice"))
        self.assertEqual(view["reachable_learners"], ["kid1"])
        self.assertEqual(view["reachable_count"], 1)

    def test_learner_connections_names_the_group_that_grants_each_teacher(self):
        view = run(admin_org.learner_connections("kid1"))
        self.assertEqual(len(view["granted_via"]), 1)
        self.assertEqual(view["granted_via"][0]["teacher_id"], "alice")
        self.assertEqual(view["granted_via"][0]["group_id"], "g1")

    # ── guardrails ───────────────────────────────────────────────────────────

    def test_unlinking_last_teacher_of_a_populated_group_is_refused(self):
        with self.assertRaises(AdminError) as caught:
            run(admin_org.unlink_teacher("root", "alice", "g1"))
        self.assertEqual(caught.exception.code, "would_leave_group_unstaffed")
        # Still linked — the refusal must not have half-applied.
        self.assertEqual(run(admin_org.teacher_connections("alice"))["reachable_count"], 1)

    def test_unlinking_last_teacher_succeeds_when_confirmed(self):
        run(admin_org.unlink_teacher("root", "alice", "g1", confirm_unstaffed=True))
        self.assertEqual(run(admin_org.teacher_connections("alice"))["reachable_count"], 0)

    def test_unlinking_is_allowed_when_a_co_teacher_remains(self):
        run(admin_org.link_teacher("root", "bob", "g1"))
        run(admin_org.unlink_teacher("root", "alice", "g1"))
        self.assertEqual(run(admin_org.learner_connections("kid1"))["granted_via"][0]["teacher_id"], "bob")

    def test_admin_cannot_revoke_their_own_grant(self):
        with self.assertRaises(AdminError) as caught:
            run(admin_org.revoke_admin("root", "root"))
        self.assertEqual(caught.exception.code, "cannot_revoke_self")

    def test_cannot_remove_the_last_admin(self):
        run(admin_org.grant_admin("root", "alice"))
        run(admin_org.revoke_admin("root", "alice"))          # two → one is fine
        with self.assertRaises(AdminError):
            run(admin_org.revoke_admin("root", "root"))

    def test_group_must_belong_to_a_known_school(self):
        with self.assertRaises(AdminError) as caught:
            run(admin_org.save_group("root", {"id": "gx", "school_id": "nope", "name": "X"}))
        self.assertEqual(caught.exception.code, "unknown_school")

    def test_cannot_link_unknown_teacher_or_enroll_unknown_learner(self):
        with self.assertRaises(AdminError):
            run(admin_org.link_teacher("root", "ghost", "g1"))
        with self.assertRaises(AdminError):
            run(admin_org.enroll_learner("root", "ghost", "g1"))

    def test_archived_group_keeps_its_history(self):
        run(admin_org.archive_group("root", "g1"))
        stored = run(org_repository.get_group("g1"))
        self.assertIsNotNone(stored)          # archived, not deleted
        self.assertFalse(stored["active"])

    # ── audit ────────────────────────────────────────────────────────────────

    def test_every_mutation_is_audited_with_actor(self):
        run(admin_org.link_teacher("root", "bob", "g1"))
        entries = run(org_repository.list_audit(target_id="bob:g1"))
        self.assertTrue(entries)
        self.assertEqual(entries[0]["actor_id"], "root")
        self.assertEqual(entries[0]["action"], "link_teacher")

    def test_unlink_audit_records_before_and_after(self):
        run(admin_org.link_teacher("root", "bob", "g1"))
        run(admin_org.unlink_teacher("root", "bob", "g1"))
        entry = run(org_repository.list_audit(target_id="bob:g1"))[0]
        self.assertEqual(entry["action"], "unlink_teacher")
        self.assertTrue(entry["before"]["active"])
        self.assertFalse(entry["after"]["active"])

    # ── bulk + import ────────────────────────────────────────────────────────

    def test_bulk_enroll_reports_skips_instead_of_failing_the_batch(self):
        result = run(admin_org.bulk_enroll("root", "g1", ["kid2", "ghost"]))
        self.assertEqual(result["enrolled"], ["kid2"])
        self.assertEqual(result["skipped"][0]["reason"], "unknown_learner")

    def test_import_preview_does_not_mutate(self):
        roster = {
            "schools": [{"id": "s2", "name": "School Two"}],
            "groups": [{"id": "g9", "school_id": "s2", "name": "New"}],
        }
        preview = run(admin_org.import_roster("root", roster, commit=False))
        self.assertFalse(preview["committed"])
        self.assertEqual(len(preview["diff"]["added"]), 2)
        self.assertIsNone(run(org_repository.get_group("g9")))   # nothing written

    def test_import_commit_applies_and_is_idempotent(self):
        roster = {
            "schools": [{"id": "s2", "name": "School Two"}],
            "groups": [{"id": "g9", "school_id": "s2", "name": "New"}],
        }
        run(admin_org.import_roster("root", roster, commit=True))
        self.assertIsNotNone(run(org_repository.get_group("g9")))
        again = run(admin_org.import_roster("root", roster, commit=False))
        self.assertEqual(again["diff"]["added"], [])   # second pass sees no adds

    # ── provisioning ─────────────────────────────────────────────────────────

    def test_create_user_returns_temp_password_once_and_forces_a_reset(self):
        created = run(admin_org.create_user("root", {
            "username": "newkid", "display_name": "New Kid", "roles": ["learner"],
        }))
        self.assertTrue(created["temp_password"])
        stored = run(self._users_repo.get_user_by_id("newkid"))
        self.assertTrue(stored["must_change_password"])
        # The hash must never travel with the public projection.
        self.assertNotIn("password", created["user"])

    def test_duplicate_username_is_refused(self):
        with self.assertRaises(AdminError) as caught:
            run(admin_org.create_user("root", {"username": "alice", "roles": ["teacher"]}))
        self.assertEqual(caught.exception.code, "username_taken")

    def test_roles_are_validated(self):
        with self.assertRaises(AdminError) as caught:
            run(admin_org.create_user("root", {"username": "x", "roles": ["superuser"]}))
        self.assertEqual(caught.exception.code, "roles_required")


if __name__ == "__main__":
    unittest.main()
