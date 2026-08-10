"""Fault reporting: ownership, honeypot, and public rate limiting."""

from __future__ import annotations

from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

from app.routes import support as support_routes
from app.services import support, support_hub, support_media, support_notify


def _build(**overrides):
    payload = {
        "source": "in_app",
        "reporter_type": "learner",
        "reporter_id": "reporter-a",
        "reporter_name": "",
        "contact_email": "",
        "category": "bug",
        "severity": "high",
        "title": "המסך נתקע",
        "description": "לחצתי על המשך ושום דבר לא קרה",
        "context": {"route": "/student-dashboard", "secret": "drop me"},
    }
    payload.update(overrides)
    return support.build_ticket_document(**payload)


class SupportTicketTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.collection_patch = patch.object(support, "_get_collection_named", return_value=None)
        self.collection_patch.start()
        self.path_patch = patch.object(support, "_FALLBACK", root / "support_tickets.json")
        self.path_patch.start()
        support._indexes_ready = False

    async def asyncTearDown(self) -> None:
        self.path_patch.stop()
        self.collection_patch.stop()
        self.temp_dir.cleanup()

    async def test_reporter_only_sees_their_own_tickets(self) -> None:
        await support.create_ticket(_build(reporter_id="reporter-a", title="שלי"))
        await support.create_ticket(_build(reporter_id="reporter-b", title="של מישהו אחר"))

        mine = await support.list_tickets_for_reporter("reporter-a")

        self.assertEqual([ticket["title"] for ticket in mine], ["שלי"])

    async def test_unknown_category_and_severity_fall_back_to_defaults(self) -> None:
        document = _build(category="../../etc/passwd", severity="catastrophic")

        self.assertEqual(document["category"], support.DEFAULT_TICKET_CATEGORY)
        self.assertEqual(document["severity"], support.DEFAULT_TICKET_SEVERITY)
        self.assertEqual(document["status"], support.DEFAULT_TICKET_STATUS)

    async def test_context_keeps_only_allowlisted_technical_fields(self) -> None:
        document = _build()

        self.assertEqual(document["context"], {"route": "/student-dashboard"})

    async def test_learner_reports_never_store_a_display_name(self) -> None:
        document = _build(reporter_type="learner", reporter_name="")

        self.assertEqual(document["reporter_name"], "")

    async def test_payload_hides_admin_only_fields_from_the_reporter(self) -> None:
        payload = support.ticket_payload(_build())

        for field in ("admin_notes", "updated_by", "reporter_id", "context"):
            self.assertNotIn(field, payload)


class PublicRateLimitTests(unittest.TestCase):
    def setUp(self) -> None:
        support_routes._public_hits.clear()

    def test_public_reports_are_throttled_per_client(self) -> None:
        allowed = [
            support_routes._public_rate_limited("1.2.3.4")
            for _ in range(support_routes._PUBLIC_MAX_PER_WINDOW)
        ]
        self.assertEqual(allowed, [False] * support_routes._PUBLIC_MAX_PER_WINDOW)
        self.assertTrue(support_routes._public_rate_limited("1.2.3.4"))
        self.assertFalse(support_routes._public_rate_limited("5.6.7.8"))


class SupportChatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.collection_patch = patch.object(support, "_get_collection_named", return_value=None)
        self.collection_patch.start()
        self.path_patch = patch.object(support, "_CHAT_FALLBACK", root / "support_chat.json")
        self.path_patch.start()
        support._chat_indexes_ready = False

    async def asyncTearDown(self) -> None:
        self.path_patch.stop()
        self.collection_patch.stop()
        self.temp_dir.cleanup()

    async def _thread(self, teacher_id: str = "teacher-a") -> str:
        conversation = await support.create_conversation(
            teacher_id, teacher_name=teacher_id, subject="הכיתה לא נטענת"
        )
        return conversation["id"]

    async def test_a_thread_is_only_readable_by_its_owner(self) -> None:
        conversation_id = await self._thread("teacher-a")

        self.assertIsNotNone(await support.get_conversation(conversation_id, teacher_id="teacher-a"))
        self.assertIsNone(await support.get_conversation(conversation_id, teacher_id="teacher-b"))

    async def test_listing_is_scoped_to_the_teacher_and_open_to_the_admin(self) -> None:
        await self._thread("teacher-a")
        await self._thread("teacher-b")

        mine = await support.list_conversations(teacher_id="teacher-a")
        everything = await support.list_conversations()

        self.assertEqual(len(mine["conversations"]), 1)
        self.assertEqual(len(everything["conversations"]), 2)

    async def test_unread_counts_follow_the_other_side(self) -> None:
        conversation_id = await self._thread()
        await support.append_message(
            conversation_id,
            author_role="teacher",
            author_id="teacher-a",
            author_name="teacher-a",
            body="המסך תקוע",
        )

        after_teacher = await support.get_conversation(conversation_id)
        self.assertEqual(after_teacher["unread_admin"], 1)
        self.assertEqual(after_teacher["unread_teacher"], 0)
        self.assertEqual(after_teacher["status"], "pending")

        await support.append_message(
            conversation_id,
            author_role="admin",
            author_id="admin@example.com",
            author_name="admin@example.com",
            body="בודקים, נחזור אליך",
        )
        after_admin = await support.get_conversation(conversation_id)
        self.assertEqual(after_admin["unread_admin"], 0)
        self.assertEqual(after_admin["unread_teacher"], 1)
        self.assertEqual(after_admin["status"], "open")

        await support.mark_read(conversation_id, reader_role="teacher")
        self.assertEqual((await support.get_conversation(conversation_id))["unread_teacher"], 0)

    async def test_messages_are_paginated_oldest_first_within_a_page(self) -> None:
        conversation_id = await self._thread()
        for index in range(5):
            await support.append_message(
                conversation_id,
                author_role="teacher",
                author_id="teacher-a",
                author_name="teacher-a",
                body=f"הודעה {index}",
            )

        page = await support.list_messages(conversation_id, limit=2)
        self.assertTrue(page["has_more"])
        self.assertEqual([item["body"] for item in page["messages"]], ["הודעה 3", "הודעה 4"])

        older = await support.list_messages(conversation_id, limit=2, cursor=page["next_cursor"])
        self.assertEqual([item["body"] for item in older["messages"]], ["הודעה 1", "הודעה 2"])

    async def test_empty_messages_are_rejected(self) -> None:
        conversation_id = await self._thread()

        result = await support.append_message(
            conversation_id,
            author_role="teacher",
            author_id="teacher-a",
            author_name="teacher-a",
            body="   ",
        )

        self.assertIsNone(result)

    async def test_unknown_conversation_status_is_rejected(self) -> None:
        conversation_id = await self._thread()

        self.assertIsNone(await support.set_conversation_status(conversation_id, "escalated"))
        self.assertIsNotNone(await support.set_conversation_status(conversation_id, "closed"))


class SupportRealtimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_notify_token_requires_an_exact_configured_secret(self) -> None:
        with patch.dict(os.environ, {"SUPPORT_INTERNAL_TOKEN": "s3cret-value"}, clear=False):
            self.assertTrue(support_notify.token_matches("s3cret-value"))
            self.assertTrue(support_notify.token_matches("  s3cret-value  "))
            self.assertFalse(support_notify.token_matches("s3cret"))
            self.assertFalse(support_notify.token_matches(None))

    async def test_notify_is_refused_when_no_secret_is_configured(self) -> None:
        with patch.dict(os.environ, {"SUPPORT_INTERNAL_TOKEN": ""}, clear=False):
            self.assertFalse(support_notify.token_matches(""))
            self.assertFalse(support_notify.token_matches("anything"))

    async def test_broadcast_drops_sockets_that_have_gone_away(self) -> None:
        class DeadSocket:
            async def send_json(self, _event):
                raise RuntimeError("closed")

        class LiveSocket:
            def __init__(self) -> None:
                self.events = []

            async def send_json(self, event):
                self.events.append(event)

        room = support_hub.teacher_room("teacher-a")
        live, dead = LiveSocket(), DeadSocket()
        await support_hub.join(room, live)
        await support_hub.join(room, dead)

        delivered = await support_hub.broadcast(room, {"type": "message.created"})

        self.assertEqual(delivered, 1)
        self.assertEqual(support_hub.room_size(room), 1)
        self.assertEqual(live.events, [{"type": "message.created"}])
        await support_hub.leave(room, live)


class SupportAttachmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_file_type_is_decided_by_magic_bytes_not_the_upload_name(self) -> None:
        self.assertEqual(support_media.sniff_image(b"\x89PNG\r\n\x1a\n rest"), ("image/png", ".png"))
        self.assertEqual(support_media.sniff_image(b"\xff\xd8\xff\xe0 rest"), ("image/jpeg", ".jpg"))
        self.assertEqual(
            support_media.sniff_image(b"RIFF\x00\x00\x00\x00WEBPVP8 "), ("image/webp", ".webp")
        )
        with self.assertRaises(support_media.AttachmentError):
            support_media.sniff_image(b"MZ\x90\x00 windows executable")

    async def test_oversized_uploads_are_rejected_before_any_storage_call(self) -> None:
        with patch.dict(
            os.environ, {"SUPPORT_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true"}
        ):
            with self.assertRaises(support_media.AttachmentError) as caught:
                await support_media.upload("moti", b"x" * (support_media.MAX_BYTES + 1))
        self.assertEqual(str(caught.exception), "file_too_large")

    async def test_upload_degrades_when_storage_is_not_configured(self) -> None:
        with patch.dict(
            os.environ,
            {"SUPPORT_STORAGE_CONNECTION_STRING": "", "SUPPORT_STORAGE_ACCOUNT_URL": ""},
        ):
            with self.assertRaises(support_media.AttachmentError) as caught:
                await support_media.upload("moti", b"\x89PNG\r\n\x1a\n")
        self.assertEqual(str(caught.exception), "attachments_unavailable")

    async def test_blob_names_are_owner_scoped_and_path_traversal_is_rejected(self) -> None:
        name = support_media.build_blob_name("moti/../admin", ".png")

        self.assertTrue(support_media.is_safe_blob_name(name))
        self.assertEqual(support_media.owner_of(name), "motiadmin")
        for bad in ("../secret.png", "moti/../../etc/passwd", "moti/file.exe", "moti/a.png/b"):
            self.assertFalse(support_media.is_safe_blob_name(bad))

    async def test_a_ticket_only_keeps_attachments_the_reporter_owns(self) -> None:
        mine = support_media.build_blob_name("moti", ".png")
        theirs = support_media.build_blob_name("someone-else", ".png")

        kept = support_routes._owned_attachments([mine, theirs, "../evil.png"], "moti")

        self.assertEqual(kept, [mine])


if __name__ == "__main__":
    unittest.main()
