"""Fault reporting: ownership, honeypot, and public rate limiting."""

from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.routes import support as support_routes
from app.services import support


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


if __name__ == "__main__":
    unittest.main()
