"""Route-boundary tests for support ticket triage in the administrator service."""

from datetime import datetime, timezone
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.auth import create_admin_token
from backend.config import Settings
from backend.main import create_app


TEST_SETTINGS = Settings(
    mongodb_connection_string="",
    mongodb_database="yuvi720",
    admin_emails=frozenset({"allowed@example.com"}),
    admin_secret_key="support-test-secret-that-is-not-used-in-production",
    google_client_id="",
    google_client_secret="",
    admin_base_url="http://localhost:9998",
    secure_cookies=False,
    port=9998,
    environment="test",
)


class FakeSupportRepository:
    """In-memory stand-in for the `support_tickets` collection."""

    def __init__(self) -> None:
        self.tickets = [
            {
                "ticket_id": "tkt-000000000001",
                "created_at": "2026-08-01T09:00:00+00:00",
                "updated_at": "2026-08-01T09:00:00+00:00",
                "status": "new",
                "admin_notes": "",
                "source": "in_app",
                "reporter_type": "teacher",
                "reporter_id": "moti",
                "reporter_name": "moti",
                "contact_email": "",
                "category": "bug",
                "severity": "high",
                "title": "לוח הכיתה לא נטען",
                "description": "אחרי כניסה למסך הכיתה מופיע עיגול טעינה בלי סוף",
                "context": {"route": "/teacher-view"},
                "attachments": [],
            },
            {
                "ticket_id": "tkt-000000000002",
                "created_at": "2026-07-28T09:00:00+00:00",
                "updated_at": "2026-07-28T09:00:00+00:00",
                "status": "resolved",
                "admin_notes": "טופל",
                "source": "public",
                "reporter_type": "guest",
                "reporter_id": None,
                "reporter_name": "הורה",
                "contact_email": "parent@example.org",
                "category": "access",
                "severity": "normal",
                "title": "לא מצליח להתחבר",
                "description": "הסיסמה לא מתקבלת",
                "context": {},
                "attachments": [],
            },
        ]
        self.conversations = [
            {
                "conversation_id": "sup-000000000001",
                "teacher_id": "moti",
                "teacher_name": "moti",
                "subject": "הכיתה לא נטענת",
                "status": "pending",
                "last_message_at": "2026-08-02T09:00:00+00:00",
                "last_message_preview": "המסך תקוע",
                "message_count": 1,
                "unread_admin": 1,
                "unread_teacher": 0,
                "linked_ticket_id": None,
                "created_at": "2026-08-02T09:00:00+00:00",
            },
        ]
        self.messages = [
            {
                "message_id": "msg-000000000001",
                "conversation_id": "sup-000000000001",
                "author_role": "teacher",
                "author_name": "moti",
                "body": "המסך תקוע",
                "at": "2026-08-02T09:00:00+00:00",
            },
        ]

    async def fetch_tickets(self, **_):
        return list(self.tickets)

    async def fetch_ticket(self, ticket_id: str):
        return next((item for item in self.tickets if item["ticket_id"] == ticket_id), None)

    async def update_ticket(self, ticket_id: str, *, updates, updated_by, now):
        ticket = await self.fetch_ticket(ticket_id)
        if ticket is None:
            return None
        ticket.update(updates)
        ticket["updated_by"] = updated_by
        ticket["updated_at"] = now.isoformat()
        return ticket

    async def fetch_conversations(self, **_):
        return list(self.conversations)

    async def fetch_conversation(self, conversation_id: str):
        return next(
            (item for item in self.conversations if item["conversation_id"] == conversation_id),
            None,
        )

    async def fetch_messages(self, conversation_id: str, **_):
        return [item for item in self.messages if item["conversation_id"] == conversation_id]

    async def append_message(self, conversation_id: str, *, body, author_id, now):
        conversation = await self.fetch_conversation(conversation_id)
        if conversation is None:
            return None
        message = {
            "message_id": "msg-new",
            "conversation_id": conversation_id,
            "author_role": "admin",
            "author_name": author_id,
            "body": body,
            "at": now.isoformat(),
        }
        self.messages.append(message)
        conversation["unread_teacher"] += 1
        conversation["unread_admin"] = 0
        return message

    async def set_conversation_status(self, conversation_id: str, *, status, now):
        conversation = await self.fetch_conversation(conversation_id)
        if conversation is None:
            return None
        conversation["status"] = status
        return conversation

    async def mark_conversation_read(self, conversation_id: str) -> None:
        conversation = await self.fetch_conversation(conversation_id)
        if conversation is not None:
            conversation["unread_admin"] = 0

    def close(self) -> None:
        return None


class SupportRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(TEST_SETTINGS, public_access=False)
        self.app.state.support_repository = FakeSupportRepository()
        self.client = TestClient(self.app)
        token = create_admin_token(
            email="allowed@example.com", name="Allowed Admin", settings=TEST_SETTINGS
        )
        self.client.cookies.set("spark_admin_token", token)

    def test_tickets_require_an_admin_cookie(self) -> None:
        anonymous = TestClient(self.app)
        response = anonymous.get("/api/support/tickets")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "admin_authentication_required")

    def test_board_returns_tickets_with_status_counts(self) -> None:
        response = self.client.get("/api/support/tickets")
        self.assertEqual(response.status_code, 200)
        board = response.json()
        self.assertEqual(board["total"], 2)
        self.assertEqual(board["counts_by_status"]["new"], 1)
        self.assertEqual(board["counts_by_status"]["resolved"], 1)
        self.assertIn("in_progress", board["statuses"])

    def test_unknown_status_filter_is_rejected(self) -> None:
        response = self.client.get("/api/support/tickets", params={"status": "urgent"})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "unknown_ticket_status")

    def test_missing_ticket_returns_not_found(self) -> None:
        response = self.client.get("/api/support/tickets/tkt-does-not-exist")
        self.assertEqual(response.status_code, 404)

    def test_update_only_touches_triage_fields(self) -> None:
        response = self.client.patch(
            "/api/support/tickets/tkt-000000000001",
            json={
                "status": "in_progress",
                "admin_notes": "  בבדיקה  ",
                "title": "hijacked",
                "reporter_id": "someone-else",
            },
        )
        self.assertEqual(response.status_code, 200)
        ticket = response.json()
        self.assertEqual(ticket["status"], "in_progress")
        self.assertEqual(ticket["admin_notes"], "בבדיקה")
        self.assertEqual(ticket["title"], "לוח הכיתה לא נטען")
        self.assertEqual(ticket["reporter_id"], "moti")
        self.assertEqual(ticket["updated_by"], "allowed@example.com")

    def test_update_rejects_an_unknown_status(self) -> None:
        response = self.client.patch(
            "/api/support/tickets/tkt-000000000001", json={"status": "escalated"}
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "unknown_ticket_status")

    def test_export_is_utf8_with_a_bom(self) -> None:
        response = self.client.get("/api/support/tickets/export")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.text.startswith("\ufeff"))
        self.assertIn("tkt-000000000001", response.text)

    def test_public_mode_never_exposes_support_tickets(self) -> None:
        os.environ["ADMIN_PUBLIC_ACCESS"] = "true"
        try:
            public_app = create_app(TEST_SETTINGS, public_access=True)
        finally:
            os.environ.pop("ADMIN_PUBLIC_ACCESS", None)
        public_app.state.support_repository = FakeSupportRepository()
        public_client = TestClient(public_app)

        self.assertEqual(public_client.get("/api/support/tickets").status_code, 401)
        self.assertEqual(
            public_client.get("/api/support/tickets/tkt-000000000001").status_code, 401
        )
        self.assertEqual(
            public_client.patch(
                "/api/support/tickets/tkt-000000000001", json={"status": "closed"}
            ).status_code,
            401,
        )
        self.assertEqual(public_client.get("/api/support/conversations").status_code, 401)


class SupportChatRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(TEST_SETTINGS, public_access=False)
        self.repository = FakeSupportRepository()
        self.app.state.support_repository = self.repository
        self.client = TestClient(self.app)
        token = create_admin_token(
            email="allowed@example.com", name="Allowed Admin", settings=TEST_SETTINGS
        )
        self.client.cookies.set("spark_admin_token", token)

    def test_conversations_require_an_admin_cookie(self) -> None:
        anonymous = TestClient(self.app)
        self.assertEqual(anonymous.get("/api/support/conversations").status_code, 401)
        self.assertEqual(
            anonymous.post(
                "/api/support/conversations/sup-000000000001/messages", json={"body": "hi"}
            ).status_code,
            401,
        )

    def test_reading_messages_clears_the_admin_unread_count(self) -> None:
        response = self.client.get("/api/support/conversations/sup-000000000001/messages")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(self.repository.conversations[0]["unread_admin"], 0)

    def test_reply_is_attributed_to_the_signed_in_admin(self) -> None:
        response = self.client.post(
            "/api/support/conversations/sup-000000000001/messages",
            json={"body": "בודקים ונחזור אליך"},
        )
        self.assertEqual(response.status_code, 201)
        message = response.json()
        self.assertEqual(message["author_role"], "admin")
        self.assertEqual(message["author_name"], "allowed@example.com")
        self.assertEqual(self.repository.conversations[0]["unread_teacher"], 1)

    def test_reply_to_a_missing_conversation_is_not_found(self) -> None:
        response = self.client.post(
            "/api/support/conversations/sup-missing/messages", json={"body": "hello"}
        )
        self.assertEqual(response.status_code, 404)

    def test_blank_reply_is_rejected(self) -> None:
        response = self.client.post(
            "/api/support/conversations/sup-000000000001/messages", json={"body": "   "}
        )
        self.assertEqual(response.status_code, 422)

    def test_unknown_conversation_status_is_rejected(self) -> None:
        response = self.client.patch(
            "/api/support/conversations/sup-000000000001", json={"status": "escalated"}
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], "unknown_conversation_status")


class SupportNotifyHookTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(TEST_SETTINGS, public_access=False)
        self.client = TestClient(self.app)

    def test_notify_is_refused_without_the_shared_secret(self) -> None:
        with patch.dict(os.environ, {"SUPPORT_INTERNAL_TOKEN": "s3cret-value"}, clear=False):
            unsigned = self.client.post(
                "/internal/support/notify",
                json={"type": "message.created", "conversation_id": "sup-1"},
            )
            wrong = self.client.post(
                "/internal/support/notify",
                json={"type": "message.created", "conversation_id": "sup-1"},
                headers={"X-Support-Token": "not-it"},
            )
            signed = self.client.post(
                "/internal/support/notify",
                json={"type": "message.created", "conversation_id": "sup-1"},
                headers={"X-Support-Token": "s3cret-value"},
            )

        self.assertEqual(unsigned.status_code, 403)
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(signed.status_code, 204)

    def test_notify_is_refused_when_no_secret_is_configured(self) -> None:
        with patch.dict(os.environ, {"SUPPORT_INTERNAL_TOKEN": ""}, clear=False):
            response = self.client.post(
                "/internal/support/notify",
                json={"type": "message.created", "conversation_id": "sup-1"},
                headers={"X-Support-Token": ""},
            )
        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
