"""A lead must survive a mail outage.

`POST /api/leads` used to exist only as an email: a mail failure meant the
enquiry was gone, and nothing could be filtered or exported later. These tests
pin that the lead is stored before the mail is attempted, and that the honeypot
still short-circuits both.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.routes import campaign  # noqa: E402

VALID_LEAD = {
    "full_name": "דנה כהן",
    "role": "רכזת תקשוב",
    "organization": "חטיבת הביניים רבין",
    "city": "חיפה",
    "phone": "050-1234567",
    "email": "dana@example.org",
}


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(campaign.router)
    return TestClient(app)


class LeadPersistence(unittest.TestCase):
    def test_a_lead_is_stored_before_the_email_is_sent(self):
        calls: list[str] = []
        with mock.patch.object(campaign, "store_lead", mock.AsyncMock(side_effect=lambda _: calls.append("store"))), \
             mock.patch.object(campaign, "send_lead_email", mock.AsyncMock(side_effect=lambda _: calls.append("email"))):
            response = _client().post("/api/leads", json=VALID_LEAD)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, ["store", "email"])

    def test_a_mail_failure_still_leaves_the_lead_stored(self):
        store = mock.AsyncMock()
        with mock.patch.object(campaign, "store_lead", store), \
             mock.patch.object(campaign, "send_lead_email", mock.AsyncMock(side_effect=RuntimeError("smtp down"))):
            response = _client().post("/api/leads", json=VALID_LEAD)
        self.assertEqual(response.status_code, 502)
        store.assert_awaited_once()

    def test_the_honeypot_stores_nothing(self):
        store = mock.AsyncMock()
        email = mock.AsyncMock()
        with mock.patch.object(campaign, "store_lead", store), \
             mock.patch.object(campaign, "send_lead_email", email):
            response = _client().post("/api/leads", json={**VALID_LEAD, "company": "bot"})
        self.assertEqual(response.status_code, 200)
        store.assert_not_awaited()
        email.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
