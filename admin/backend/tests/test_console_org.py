"""Organisation console — guardrails and the audit trail, through the real
service and repository code over an in-memory database."""

import asyncio
import unittest

from backend.console.org_service import AdminError
from backend.console.users import verify_password
from backend.tests.console_fakes import ConsoleHarness, seed_org


def run(coro):
    return asyncio.run(coro)


class ConsoleOrgServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.h = ConsoleHarness()
        self.svc = self.h.service
        run(seed_org(self.h))

    # ── overview surfaces the invisible ──────────────────────────────────────

    def test_overview_counts_and_surfaces_unassigned_learners_and_teacherless_groups(self):
        run(self.svc.save_group("root", {"id": "g2", "school_id": "s1", "name": "Empty"}))
        data = run(self.svc.overview())
        self.assertEqual(data["counts"], {
            "schools": 1, "groups": 2, "teachers": 3, "students": 2,
            "active_links": 1, "enrollments": 1,
        })
        self.assertIn("kid2", [row["learner_id"] for row in data["unassigned_learners"]])
        self.assertEqual(data["teacherless_groups"], [{"id": "g2", "name": "Empty"}])
        self.assertEqual(data["recent_changes"][0]["action"], "upsert_group")

    # ── people + connections ─────────────────────────────────────────────────

    def test_people_search_narrows_by_role_and_substring_without_credentials(self):
        rows = run(self.svc.people(role="teacher", query="ali"))
        self.assertEqual([row["user_id"] for row in rows], ["alice"])
        self.assertEqual(rows[0]["groups"], [{"id": "g1", "link_role": "teacher"}])
        self.assertNotIn("password", rows[0])
        learners = run(self.svc.people(role="learner"))
        self.assertEqual([row["user_id"] for row in learners], ["kid1", "kid2"])
        self.assertEqual(learners[0]["enrolled_in"], ["g1"])

    def test_teacher_connections_answers_which_students_can_they_see(self):
        view = run(self.svc.teacher_connections("alice"))
        self.assertEqual(view["reachable_learners"], ["kid1"])
        self.assertEqual(view["reachable_count"], 1)
        self.assertFalse(view["is_admin"])
        self.assertTrue(run(self.svc.teacher_connections("root"))["is_admin"])

    def test_learner_connections_names_the_group_that_grants_each_teacher(self):
        view = run(self.svc.learner_connections("kid1"))
        self.assertEqual(len(view["granted_via"]), 1)
        self.assertEqual(view["granted_via"][0]["teacher_id"], "alice")
        self.assertEqual(view["granted_via"][0]["group_id"], "g1")
        self.assertEqual(view["granted_via"][0]["group_name"], "Group One")

    # ── groups ───────────────────────────────────────────────────────────────

    def test_group_must_belong_to_a_known_school(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.save_group("root", {"id": "gx", "school_id": "nope", "name": "X"}))
        self.assertEqual(caught.exception.code, "unknown_school")

    def test_group_save_is_an_upsert_with_before_and_after_in_the_audit(self):
        run(self.svc.save_group("root", {"id": "g1", "school_id": "s1", "name": "Renamed", "grade": "7"}))
        stored = run(self.h.org.get_group("g1"))
        self.assertEqual(stored["name"], "Renamed")
        self.assertEqual(stored["grade"], "7")
        self.assertTrue(stored["active"])
        self.assertEqual(len(self.h.db.rows("org_groups")), 1)
        entry = run(self.h.org.list_audit(target_id="g1"))[0]
        self.assertEqual(entry["before"]["name"], "Group One")
        self.assertEqual(entry["after"]["name"], "Renamed")

    def test_archived_group_keeps_its_history(self):
        run(self.svc.archive_group("root", "g1"))
        stored = run(self.h.org.get_group("g1"))
        self.assertIsNotNone(stored)
        self.assertFalse(stored["active"])
        self.assertEqual(run(self.h.org.list_groups()), [])
        self.assertEqual(len(run(self.h.org.list_groups(active_only=False))), 1)
        with self.assertRaises(AdminError) as caught:
            run(self.svc.archive_group("root", "ghost"))
        self.assertEqual(caught.exception.code, "unknown_group")

    # ── teacher links ────────────────────────────────────────────────────────

    def test_unlinking_last_teacher_of_a_populated_group_is_refused(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.unlink_teacher("root", "alice", "g1"))
        self.assertEqual(caught.exception.code, "would_leave_group_unstaffed")
        self.assertEqual(run(self.svc.teacher_connections("alice"))["reachable_count"], 1)

    def test_unlinking_last_teacher_succeeds_when_confirmed(self):
        run(self.svc.unlink_teacher("root", "alice", "g1", confirm_unstaffed=True))
        self.assertEqual(run(self.svc.teacher_connections("alice"))["reachable_count"], 0)
        link = run(self.h.org.get_teacher_link("alice", "g1"))
        self.assertFalse(link["active"])
        self.assertTrue(link["revoked_at"])

    def test_unlinking_is_allowed_when_a_co_teacher_remains(self):
        run(self.svc.link_teacher("root", "bob", "g1", "homeroom"))
        run(self.svc.unlink_teacher("root", "alice", "g1"))
        grants = run(self.svc.learner_connections("kid1"))["granted_via"]
        self.assertEqual([g["teacher_id"] for g in grants], ["bob"])
        self.assertEqual(grants[0]["link_role"], "homeroom")

    def test_cannot_link_unknown_teacher_or_group(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.link_teacher("root", "ghost", "g1"))
        self.assertEqual(caught.exception.code, "unknown_teacher")
        with self.assertRaises(AdminError) as caught:
            run(self.svc.link_teacher("root", "bob", "gx"))
        self.assertEqual(caught.exception.code, "unknown_group")

    # ── enrollments ──────────────────────────────────────────────────────────

    def test_enroll_and_unenroll_keep_the_row(self):
        run(self.svc.enroll_learner("root", "kid2", "g1"))
        self.assertEqual(run(self.h.org.learners_in_group("g1")), ["kid1", "kid2"])
        run(self.svc.unenroll_learner("root", "kid2", "g1"))
        self.assertEqual(run(self.h.org.learners_in_group("g1")), ["kid1"])
        row = run(self.h.org.get_enrollment("kid2", "g1"))
        self.assertFalse(row["active"])
        self.assertTrue(row["left_at"])
        with self.assertRaises(AdminError) as caught:
            run(self.svc.unenroll_learner("root", "kid2", "gx"))
        self.assertEqual(caught.exception.code, "unknown_enrollment")

    def test_cannot_enroll_unknown_learner(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.enroll_learner("root", "ghost", "g1"))
        self.assertEqual(caught.exception.code, "unknown_learner")

    def test_bulk_enroll_reports_skips_instead_of_failing_the_batch(self):
        result = run(self.svc.bulk_enroll("root", "g1", ["kid2", "ghost"]))
        self.assertEqual(result["enrolled"], ["kid2"])
        self.assertEqual(result["skipped"][0]["reason"], "unknown_learner")

    # ── admin grants ─────────────────────────────────────────────────────────

    def test_admin_cannot_revoke_their_own_grant(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.revoke_admin("root", "root"))
        self.assertEqual(caught.exception.code, "cannot_revoke_self")

    def test_cannot_remove_the_last_admin(self):
        actor = "admin-console:gal@example.com"
        run(self.svc.grant_admin(actor, "alice"))
        run(self.svc.revoke_admin(actor, "alice"))          # two → one is fine
        self.assertFalse(run(self.h.org.is_admin("alice")))
        with self.assertRaises(AdminError) as caught:
            run(self.svc.revoke_admin(actor, "root"))
        self.assertEqual(caught.exception.code, "cannot_remove_last_admin")
        self.assertTrue(run(self.h.org.is_admin("root")))

    def test_grant_requires_a_known_user_and_records_the_actor(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.grant_admin("root", "ghost"))
        self.assertEqual(caught.exception.code, "unknown_user")
        granted = run(self.svc.grant_admin("admin-console:gal@example.com", "bob", scope="school", school_ids=["s1"]))
        self.assertEqual(granted["granted_by"], "admin-console:gal@example.com")
        self.assertEqual(granted["scope"], "school")
        self.assertEqual(granted["school_ids"], ["s1"])

    # ── audit ────────────────────────────────────────────────────────────────

    def test_every_mutation_is_audited_with_actor(self):
        run(self.svc.link_teacher("admin-console:gal@example.com", "bob", "g1"))
        entries = run(self.h.org.list_audit(target_id="bob:g1"))
        self.assertTrue(entries)
        self.assertEqual(entries[0]["actor_id"], "admin-console:gal@example.com")
        self.assertEqual(entries[0]["action"], "link_teacher")
        by_actor = run(self.h.org.list_audit(actor_id="admin-console:gal@example.com"))
        self.assertEqual([e["action"] for e in by_actor], ["link_teacher"])

    def test_unlink_audit_records_before_and_after(self):
        run(self.svc.link_teacher("root", "bob", "g1"))
        run(self.svc.unlink_teacher("root", "bob", "g1"))
        entry = run(self.h.org.list_audit(target_id="bob:g1"))[0]
        self.assertEqual(entry["action"], "unlink_teacher")
        self.assertTrue(entry["before"]["active"])
        self.assertFalse(entry["after"]["active"])

    # ── provisioning ─────────────────────────────────────────────────────────

    def test_create_user_returns_temp_password_once_and_the_hash_verifies(self):
        created = run(self.svc.create_user("root", {
            "username": "NewKid ", "display_name": "New Kid", "roles": ["learner"],
        }))
        self.assertTrue(created["temp_password"])
        self.assertNotIn("password", created["user"])
        self.assertEqual(created["user"]["user_id"], "newkid")
        stored = run(self.h.users.get_user_by_id("newkid"))
        self.assertTrue(stored["must_change_password"])
        self.assertEqual(stored["password"]["algo"], "pbkdf2_sha256")
        self.assertEqual(stored["password"]["iterations"], 600_000)
        self.assertTrue(verify_password(created["temp_password"], stored["password"]))
        self.assertFalse(verify_password("wrong", stored["password"]))
        self.assertEqual(stored["preferences"]["language"], "he")
        self.assertEqual(stored["preferences"]["theme"], "system")
        audit = run(self.h.org.list_audit(target_id="newkid"))[0]
        self.assertEqual(audit["action"], "create_user")
        self.assertEqual(audit["after"], {"username": "newkid", "roles": ["learner"]})

    def test_create_user_honours_explicit_password_and_user_id(self):
        created = run(self.svc.create_user("root", {
            "username": "teach", "user_id": "t-9", "roles": ["teacher"], "password": "Secret1",
        }))
        self.assertEqual(created["temp_password"], "Secret1")
        stored = run(self.h.users.get_user_by_id("t-9"))
        self.assertTrue(verify_password("Secret1", stored["password"]))

    def test_duplicate_username_and_user_id_are_refused(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.create_user("root", {"username": "Alice", "roles": ["teacher"]}))
        self.assertEqual(caught.exception.code, "username_taken")
        with self.assertRaises(AdminError) as caught:
            run(self.svc.create_user("root", {"username": "fresh", "user_id": "kid1", "roles": ["learner"]}))
        self.assertEqual(caught.exception.code, "user_id_taken")

    def test_roles_are_validated(self):
        with self.assertRaises(AdminError) as caught:
            run(self.svc.create_user("root", {"username": "x", "roles": ["superuser"]}))
        self.assertEqual(caught.exception.code, "roles_required")
        with self.assertRaises(AdminError) as caught:
            run(self.svc.create_user("root", {"roles": ["learner"]}))
        self.assertEqual(caught.exception.code, "username_required")

    # ── roster import ────────────────────────────────────────────────────────

    ROSTER = {
        "schools": [{"id": "s2", "name": "School Two"}],
        "groups": [{"id": "g9", "school_id": "s2", "name": "New"}],
        "teacher_links": [{"teacher_id": "bob", "group_id": "g9"}],
        "enrollments": [{"learner_id": "kid2", "group_id": "g9"}],
    }

    def test_import_preview_does_not_mutate(self):
        preview = run(self.svc.import_roster("root", self.ROSTER, commit=False))
        self.assertFalse(preview["committed"])
        self.assertEqual([e["kind"] for e in preview["diff"]["added"]],
                         ["school", "group", "teacher_link", "enrollment"])
        self.assertIsNone(run(self.h.org.get_group("g9")))
        self.assertEqual(run(self.h.org.list_audit(target_id="import")), [])

    def test_import_commit_applies_and_is_idempotent(self):
        result = run(self.svc.import_roster("root", self.ROSTER, commit=True))
        self.assertTrue(result["committed"])
        self.assertIsNotNone(run(self.h.org.get_group("g9")))
        self.assertEqual(run(self.h.org.learners_in_group("g9")), ["kid2"])
        self.assertEqual(run(self.svc.teacher_connections("bob"))["reachable_learners"], ["kid2"])
        again = run(self.svc.import_roster("root", self.ROSTER, commit=False))
        self.assertEqual(again["diff"]["added"], [])
        self.assertEqual(len(again["diff"]["unchanged"]), 4)
        renamed = {**self.ROSTER, "groups": [{"id": "g9", "school_id": "s2", "name": "Renamed"}]}
        self.assertEqual(
            [e["id"] for e in run(self.svc.import_roster("root", renamed, commit=False))["diff"]["updated"]],
            ["g9"],
        )
        audit = run(self.h.org.list_audit(target_id="import"))[0]
        self.assertEqual(audit["after"]["counts"], {"added": 4, "updated": 0, "unchanged": 0})


if __name__ == "__main__":
    unittest.main()
