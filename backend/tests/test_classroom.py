"""API tests for teacher/student messaging and calendar events."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import classroom_store  # noqa: E402
import learner_state  # noqa: E402
from server import create_app  # noqa: E402

# server.py loads backend/.env on import, so clear the connection here to keep
# these tests on the JSON fallback instead of hitting a real cluster.
os.environ.pop("MONGODB_CONNECTION_STRING", None)
classroom_store._mongo_client = None
learner_state._mongo_client = None


class ClassroomApiTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._original_file = classroom_store.FALLBACK_FILE
        classroom_store.FALLBACK_FILE = Path(self._tmp.name) / "classroom.json"
        self.client = TestClient(create_app())

    def tearDown(self):
        classroom_store.FALLBACK_FILE = self._original_file
        self._tmp.cleanup()

    # ---------------- messaging ----------------

    def test_thread_starts_empty(self):
        response = self.client.get("/api/messages/thread", params={"teacher_id": "t1", "learner_id": "l1"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["messages"], [])

    def test_teacher_message_reaches_the_learner_thread(self):
        self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t1", "learner_id": "l1", "sender": "teacher", "text": "היי, איך הולך?"},
        )
        thread = self.client.get(
            "/api/messages/thread", params={"teacher_id": "t1", "learner_id": "l1"}
        ).json()

        self.assertEqual(len(thread["messages"]), 1)
        self.assertEqual(thread["messages"][0]["from"], "teacher")
        self.assertEqual(thread["messages"][0]["text"], "היי, איך הולך?")
        # Unread only for the side that did not send it.
        self.assertEqual(thread["unread_learner"], 1)
        self.assertEqual(thread["unread_teacher"], 0)

    def test_learner_reply_is_visible_to_the_teacher(self):
        self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t1", "learner_id": "l1", "sender": "teacher", "text": "שאלה"},
        )
        self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t1", "learner_id": "l1", "sender": "learner", "text": "תשובה"},
        )
        thread = self.client.get(
            "/api/messages/thread", params={"teacher_id": "t1", "learner_id": "l1"}
        ).json()

        self.assertEqual([m["from"] for m in thread["messages"]], ["teacher", "learner"])
        self.assertEqual(thread["unread_teacher"], 1)

    def test_marking_read_clears_only_that_side(self):
        self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t1", "learner_id": "l1", "sender": "learner", "text": "שלום"},
        )
        thread = self.client.post(
            "/api/messages/thread/read",
            json={"teacher_id": "t1", "learner_id": "l1", "reader": "teacher"},
        ).json()

        self.assertEqual(thread["unread_teacher"], 0)

    def test_empty_message_is_rejected(self):
        response = self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t1", "learner_id": "l1", "sender": "teacher", "text": "   "},
        )
        self.assertEqual(response.status_code, 400)

    def test_threads_are_listed_per_teacher(self):
        for learner in ("l1", "l2"):
            self.client.post(
                "/api/messages/thread",
                json={"teacher_id": "t1", "learner_id": learner, "sender": "teacher", "text": "hi"},
            )
        self.client.post(
            "/api/messages/thread",
            json={"teacher_id": "t2", "learner_id": "l3", "sender": "teacher", "text": "hi"},
        )

        threads = self.client.get("/api/messages/threads", params={"teacher_id": "t1"}).json()["threads"]
        self.assertEqual({t["learner_id"] for t in threads}, {"l1", "l2"})

    # ---------------- calendar ----------------

    def test_event_create_list_update_delete(self):
        created = self.client.post(
            "/api/calendar/events",
            json={"owner_id": "t1", "title": "מפגש כיתה", "date": "2026-08-10", "time": "10:00", "type": "meeting"},
        )
        self.assertEqual(created.status_code, 200)
        event_id = created.json()["event_id"]

        listed = self.client.get("/api/calendar/events", params={"owner_id": "t1"}).json()["events"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["title"], "מפגש כיתה")

        updated = self.client.patch(
            f"/api/calendar/events/{event_id}",
            json={"owner_id": "t1", "title": "מפגש כיתה — עודכן", "time": "11:30"},
        ).json()
        self.assertEqual(updated["title"], "מפגש כיתה — עודכן")
        self.assertEqual(updated["time"], "11:30")

        deleted = self.client.delete(f"/api/calendar/events/{event_id}", params={"owner_id": "t1"})
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(self.client.get("/api/calendar/events", params={"owner_id": "t1"}).json()["events"], [])

    def test_event_requires_title_and_date(self):
        self.assertEqual(
            self.client.post("/api/calendar/events", json={"owner_id": "t1", "date": "2026-08-10"}).status_code,
            400,
        )
        self.assertEqual(
            self.client.post("/api/calendar/events", json={"owner_id": "t1", "title": "בלי תאריך"}).status_code,
            400,
        )

    def test_unknown_event_type_falls_back_to_meeting(self):
        created = self.client.post(
            "/api/calendar/events",
            json={"owner_id": "t1", "title": "בדיקה", "date": "2026-08-10", "type": "not-a-type"},
        ).json()
        self.assertEqual(created["type"], "meeting")

    def test_events_are_scoped_to_their_owner(self):
        created = self.client.post(
            "/api/calendar/events", json={"owner_id": "t1", "title": "שלי", "date": "2026-08-10"}
        ).json()

        self.assertEqual(self.client.get("/api/calendar/events", params={"owner_id": "t2"}).json()["events"], [])
        other_owner_delete = self.client.delete(
            f"/api/calendar/events/{created['event_id']}", params={"owner_id": "t2"}
        )
        self.assertEqual(other_owner_delete.status_code, 404)


class LearnerStateMotionTests(unittest.TestCase):
    """The reduce-motion preference must round-trip like any other learner setting."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._original_file = learner_state.FALLBACK_STATE_FILE
        learner_state.FALLBACK_STATE_FILE = Path(self._tmp.name) / "learner_state.json"
        self.client = TestClient(create_app())

    def tearDown(self):
        learner_state.FALLBACK_STATE_FILE = self._original_file
        self._tmp.cleanup()

    def test_reduce_motion_defaults_to_false_and_persists(self):
        state = self.client.get("/api/learner-state", params={"learner_id": "motion-test"}).json()
        self.assertFalse(state["reduce_motion"])

        updated = self.client.patch(
            "/api/learner-state", json={"learner_id": "motion-test", "reduce_motion": True}
        ).json()
        self.assertTrue(updated["reduce_motion"])

        reread = self.client.get("/api/learner-state", params={"learner_id": "motion-test"}).json()
        self.assertTrue(reread["reduce_motion"])


if __name__ == "__main__":
    unittest.main()
