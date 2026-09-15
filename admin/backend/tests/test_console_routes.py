"""Route-boundary tests for the native organisation/games console."""

import asyncio
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.auth import create_admin_token
from backend.config import Settings
from backend.main import create_app
from backend.tests.console_fakes import ConsoleHarness, FakeConsoleDatabase, seed_org


TEST_SETTINGS = Settings(
    mongodb_connection_string="",
    mongodb_database="yuvi720",
    admin_emails=frozenset({"allowed@example.com"}),
    admin_secret_key="console-test-secret-that-is-not-used-in-production",
    google_client_id="",
    google_client_secret="",
    admin_base_url="http://localhost:9998",
    secure_cookies=False,
    port=9998,
    environment="test",
)
ACTOR = "admin-console:allowed@example.com"

CONSOLE_GETS = (
    "/api/admin/overview",
    "/api/admin/people",
    "/api/admin/teachers/alice/connections",
    "/api/admin/learners/kid1/connections",
    "/api/admin/org",
    "/api/admin/admins",
    "/api/admin/audit",
    "/api/admin/games/usage",
    "/api/admin/games/jobs",
)
CONSOLE_POSTS = (
    "/api/admin/org/schools",
    "/api/admin/org/groups",
    "/api/admin/org/groups/g1/archive",
    "/api/admin/org/teacher-links",
    "/api/admin/org/teacher-links/remove",
    "/api/admin/org/enrollments",
    "/api/admin/org/enrollments/remove",
    "/api/admin/admins",
    "/api/admin/admins/revoke",
    "/api/admin/users",
    "/api/admin/org/import",
    "/api/admin/games/limits/defaults",
    "/api/admin/games/limits/kid1",
    "/api/admin/games/limits/kid1/reset",
)


def _app(public_access: bool, db: FakeConsoleDatabase):
    app = create_app(TEST_SETTINGS, public_access=public_access)
    app.state.console_database = db
    return app


class ConsoleAuthTests(unittest.TestCase):
    def test_unauthenticated_requests_get_401_on_every_console_route(self) -> None:
        client = TestClient(_app(False, FakeConsoleDatabase()))
        for path in CONSOLE_GETS:
            response = client.get(path)
            self.assertEqual(response.status_code, 401, path)
            self.assertEqual(response.json()["detail"], "admin_authentication_required")
        for path in CONSOLE_POSTS:
            response = client.post(path, json={})
            self.assertEqual(response.status_code, 401, path)

    def test_public_preview_never_reaches_the_console(self) -> None:
        with patch.dict(os.environ, {"ADMIN_PUBLIC_ACCESS": "true"}):
            client = TestClient(_app(True, FakeConsoleDatabase()))
        self.assertTrue(client.get("/api/auth/status").json()["public_access"])
        for path in CONSOLE_GETS:
            self.assertEqual(client.get(path).status_code, 401, path)
        for path in CONSOLE_POSTS:
            self.assertEqual(client.post(path, json={}).status_code, 401, path)

    def test_a_cookie_for_an_unlisted_email_is_rejected(self) -> None:
        client = TestClient(_app(False, FakeConsoleDatabase()))
        token = create_admin_token(email="stranger@example.com", name="X", settings=TEST_SETTINGS)
        client.cookies.set("spark_admin_token", token)
        self.assertEqual(client.get("/api/admin/overview").status_code, 401)


class ConsoleRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.h = ConsoleHarness()
        asyncio.run(seed_org(self.h))
        self.app = _app(False, self.h.db)
        self.client = TestClient(self.app)
        token = create_admin_token(
            email="allowed@example.com", name="Allowed Admin", settings=TEST_SETTINGS
        )
        self.client.cookies.set("spark_admin_token", token)

    def test_overview_is_private_and_counts(self) -> None:
        response = self.client.get("/api/admin/overview")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "private, no-store")
        body = response.json()
        self.assertEqual(body["counts"]["students"], 2)
        self.assertEqual(body["counts"]["groups"], 1)
        self.assertEqual([r["learner_id"] for r in body["unassigned_learners"]], ["kid2"])

    def test_people_query_params_are_validated(self) -> None:
        response = self.client.get("/api/admin/people", params={"role": "teacher", "q": "bob"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([p["user_id"] for p in response.json()["people"]], ["bob"])
        self.assertEqual(self.client.get("/api/admin/people", params={"role": "root"}).status_code, 422)

    def test_org_snapshot_includes_archived_groups(self) -> None:
        self.assertEqual(self.client.post("/api/admin/org/groups/g1/archive").status_code, 200)
        body = self.client.get("/api/admin/org").json()
        self.assertEqual(set(body), {"schools", "groups", "teacher_links", "enrollments"})
        self.assertEqual(body["groups"][0]["active"], False)

    def test_group_save_validates_and_audits_the_google_identity(self) -> None:
        bad = self.client.post("/api/admin/org/groups", json={"id": "g2", "school_id": "nope"})
        self.assertEqual(bad.status_code, 400)
        self.assertEqual(bad.json(), {"error": "unknown_school"})
        ok = self.client.post("/api/admin/org/groups",
                              json={"id": "g2", "school_id": "s1", "name": "Two", "grade": "8"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["name"], "Two")
        audit = self.client.get("/api/admin/audit", params={"target_id": "g2"}).json()["entries"]
        self.assertEqual(audit[0]["actor_id"], ACTOR)
        self.assertEqual(audit[0]["action"], "upsert_group")
        self.assertEqual(self.client.get("/api/admin/audit", params={"limit": 0}).status_code, 422)

    def test_unlink_needs_confirmation_when_the_group_would_be_unstaffed(self) -> None:
        refused = self.client.post("/api/admin/org/teacher-links/remove",
                                   json={"teacher_id": "alice", "group_id": "g1"})
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json(), {"error": "would_leave_group_unstaffed"})
        self.assertEqual(refused.headers["cache-control"], "private, no-store")
        confirmed = self.client.post("/api/admin/org/teacher-links/remove",
                                     json={"teacher_id": "alice", "group_id": "g1",
                                           "confirm_unstaffed": True})
        self.assertEqual(confirmed.status_code, 200)
        self.assertFalse(confirmed.json()["active"])
        view = self.client.get("/api/admin/teachers/alice/connections").json()
        self.assertEqual(view["reachable_count"], 0)

    def test_link_teacher_and_learner_connections(self) -> None:
        linked = self.client.post("/api/admin/org/teacher-links",
                                  json={"teacher_id": "bob", "group_id": "g1", "link_role": "observer"})
        self.assertEqual(linked.status_code, 200)
        self.assertEqual(linked.json()["link_role"], "observer")
        view = self.client.get("/api/admin/learners/kid1/connections").json()
        self.assertEqual(sorted(g["teacher_id"] for g in view["granted_via"]), ["alice", "bob"])
        unknown = self.client.post("/api/admin/org/teacher-links",
                                   json={"teacher_id": "ghost", "group_id": "g1"})
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(unknown.json(), {"error": "unknown_teacher"})

    def test_enroll_single_bulk_and_remove(self) -> None:
        single = self.client.post("/api/admin/org/enrollments", json={"learner_id": "kid2", "group_id": "g1"})
        self.assertEqual(single.status_code, 200)
        self.assertEqual(single.json()["learner_id"], "kid2")
        bulk = self.client.post("/api/admin/org/enrollments",
                                json={"group_id": "g1", "learner_ids": ["kid1", "ghost"]})
        self.assertEqual(bulk.status_code, 200)
        self.assertEqual(bulk.json(), {"enrolled": ["kid1"],
                                       "skipped": [{"learner_id": "ghost", "reason": "unknown_learner"}]})
        removed = self.client.post("/api/admin/org/enrollments/remove",
                                   json={"learner_id": "kid2", "group_id": "g1"})
        self.assertEqual(removed.status_code, 200)
        self.assertFalse(removed.json()["active"])
        missing = self.client.post("/api/admin/org/enrollments/remove",
                                   json={"learner_id": "kid2", "group_id": "gx"})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json(), {"error": "unknown_enrollment"})

    def test_admin_grants_and_the_last_admin_guardrail(self) -> None:
        self.assertEqual([a["_id"] for a in self.client.get("/api/admin/admins").json()["admins"]], ["root"])
        granted = self.client.post("/api/admin/admins", json={"user_id": "alice", "scope": "school",
                                                              "school_ids": ["s1"]})
        self.assertEqual(granted.status_code, 200)
        self.assertEqual(granted.json()["granted_by"], ACTOR)
        self.assertEqual(self.client.post("/api/admin/admins/revoke", json={"user_id": "alice"}).status_code, 200)
        self.assertEqual([a["_id"] for a in self.client.get("/api/admin/admins").json()["admins"]], ["root"])
        last = self.client.post("/api/admin/admins/revoke", json={"user_id": "root"})
        self.assertEqual(last.status_code, 409)
        self.assertEqual(last.json(), {"error": "cannot_remove_last_admin"})

    def test_create_user_returns_the_temp_password_once(self) -> None:
        created = self.client.post("/api/admin/users",
                                   json={"username": "newkid", "display_name": "New Kid", "roles": ["learner"]})
        self.assertEqual(created.status_code, 200)
        body = created.json()
        self.assertTrue(body["temp_password"])
        self.assertNotIn("password", body["user"])
        again = self.client.get("/api/admin/people", params={"q": "newkid"}).json()["people"][0]
        self.assertNotIn("temp_password", again)
        self.assertNotIn("password", again)
        duplicate = self.client.post("/api/admin/users", json={"username": "newkid", "roles": ["learner"]})
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json(), {"error": "username_taken"})
        bad_roles = self.client.post("/api/admin/users", json={"username": "x", "roles": ["superuser"]})
        self.assertEqual(bad_roles.status_code, 400)
        self.assertEqual(bad_roles.json(), {"error": "roles_required"})

    def test_roster_import_preview_then_commit(self) -> None:
        roster = {"schools": [{"id": "s2", "name": "Two"}],
                  "groups": [{"id": "g9", "school_id": "s2", "name": "Nine"}]}
        preview = self.client.post("/api/admin/org/import", json={"roster": roster}).json()
        self.assertFalse(preview["committed"])
        self.assertEqual(len(preview["diff"]["added"]), 2)
        self.assertEqual(len(self.client.get("/api/admin/org").json()["groups"]), 1)
        commit = self.client.post("/api/admin/org/import", json={"roster": roster, "commit": True}).json()
        self.assertTrue(commit["committed"])
        self.assertEqual(len(self.client.get("/api/admin/org").json()["groups"]), 2)

    def test_games_usage_jobs_and_caps(self) -> None:
        self.h.db.rows("learner_games").append({"_id": "gm-1", "learner_id": "kid1", "title": "Maze",
                                                "created_at": "2099-01-01T00:00:00+00:00"})
        self.h.db.rows("learner_game_jobs").append({
            "_id": "gj-1", "game_id": "gm-1", "learner_id": "kid1", "kind": "create", "status": "done",
            "usage_summary": {"cost_usd": 0.4}, "created_at": "2099-01-01T00:00:00+00:00",
            "payload": {"never": "returned"}, "model": "claude-opus-5", "reasoning_effort": "low",
        })
        usage = self.client.get("/api/admin/games/usage")
        self.assertEqual(usage.status_code, 200)
        self.assertEqual(usage.headers["cache-control"], "private, no-store")
        self.assertEqual(usage.json()["totals"]["cost_usd"], 0.4)
        self.assertEqual(usage.json()["learners"][0]["display_name"], "Kid1")

        jobs = self.client.get("/api/admin/games/jobs", params={"limit": 5, "since_hours": 24})
        self.assertEqual(jobs.status_code, 200)
        [item] = jobs.json()["items"]
        self.assertEqual(item["job_id"], "gj-1")
        self.assertEqual(item["title"], "Maze")
        self.assertNotIn("payload", item)
        self.assertEqual(self.client.get("/api/admin/games/jobs", params={"limit": 0}).status_code, 422)

        defaults = self.client.post("/api/admin/games/limits/defaults",
                                    json={"create_per_day": 5, "edit_per_day": 20})
        self.assertEqual(defaults.status_code, 200)
        self.assertEqual(defaults.json(), {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})
        learner = self.client.post("/api/admin/games/limits/kid1",
                                   json={"create_per_day": 9, "edit_per_day": 9, "note": "pilot"})
        self.assertEqual(learner.status_code, 200)
        self.assertEqual(learner.json()["source"], "learner")
        self.assertEqual(self.client.get("/api/admin/games/usage").json()["learners"][0]["note"], "pilot")
        reset = self.client.post("/api/admin/games/limits/kid1/reset")
        self.assertEqual(reset.json(), {"create_per_day": 5, "edit_per_day": 20, "source": "admin"})

        self.assertEqual(self.client.post("/api/admin/games/limits/kid1",
                                          json={"create_per_day": 5000, "edit_per_day": 1}).status_code, 422)
        reserved = self.client.post("/api/admin/games/limits/__defaults__",
                                    json={"create_per_day": 1, "edit_per_day": 1})
        self.assertEqual(reserved.status_code, 400)
        self.assertEqual(reserved.json(), {"error": "bad_learner"})
        actions = [e["action"] for e in self.client.get("/api/admin/audit").json()["entries"]]
        self.assertEqual(actions[:3], ["clear_game_limits", "set_game_limits", "set_game_limit_defaults"])
        self.assertTrue(all(e["actor_id"] == ACTOR for e in
                            self.client.get("/api/admin/audit", params={"actor_id": ACTOR}).json()["entries"]))


if __name__ == "__main__":
    unittest.main()
