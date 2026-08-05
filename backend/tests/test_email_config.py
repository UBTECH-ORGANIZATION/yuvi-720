"""A half-configured mailer must say which half is missing.

Production lost `POST /api/leads` to a 502 whose only clue was the log line
"Azure Communication Services is not fully configured" — true, unactionable, and
three settings wide. The sender's refusal is correct (never half-send a lead);
the silence about *which* setting was the expensive part. These tests pin the
naming, and pin that a partial config still refuses.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import email  # noqa: E402

FULL = {
    "AZURE_COMMUNICATION_CONNECTION_STRING": "endpoint=https://acs.example.com/;accesskey=k",
    "ACS_SENDER_ADDRESS": "doNotReply@yuvilab.ai",
    "CONTACT_EMAILS": "a@yuvilab.ai,b@yuvilab.ai",
}


def _with(**overrides):
    return mock.patch.dict(os.environ, {**FULL, **overrides}, clear=False)


class MissingEmailSettings(unittest.TestCase):
    def test_a_full_config_reports_nothing_missing(self):
        with _with():
            self.assertEqual(email.missing_email_settings(), [])

    def test_each_setting_is_named_when_it_is_empty(self):
        for name in FULL:
            with self.subTest(name=name), _with(**{name: ""}):
                self.assertEqual(email.missing_email_settings(), [name])

    def test_whitespace_is_not_configuration(self):
        """An App Service setting saved as a space is absent, not present."""
        with _with(ACS_SENDER_ADDRESS="   "):
            self.assertEqual(email.missing_email_settings(), ["ACS_SENDER_ADDRESS"])

    def test_a_recipient_list_of_only_separators_is_missing(self):
        with _with(CONTACT_EMAILS=" , , "):
            self.assertEqual(email.missing_email_settings(), ["CONTACT_EMAILS"])

    def test_every_gap_is_listed_not_just_the_first(self):
        with _with(ACS_SENDER_ADDRESS="", CONTACT_EMAILS=""):
            self.assertEqual(
                email.missing_email_settings(),
                ["ACS_SENDER_ADDRESS", "CONTACT_EMAILS"],
            )


class SendRefusesAndExplains(unittest.TestCase):
    def test_the_error_names_the_missing_setting(self):
        with _with(AZURE_COMMUNICATION_CONNECTION_STRING=""):
            with self.assertRaises(RuntimeError) as caught:
                email._send_sync("subject", "body")
        self.assertIn("AZURE_COMMUNICATION_CONNECTION_STRING", str(caught.exception))

    def test_a_partial_config_never_reaches_the_client(self):
        """Refusing beats half-sending: a lead with no recipients is a lost lead."""
        with _with(CONTACT_EMAILS=""):
            with mock.patch.object(email, "EmailClient") as client:
                with self.assertRaises(RuntimeError):
                    email._send_sync("subject", "body")
        client.from_connection_string.assert_not_called()

    def test_a_full_config_does_send(self):
        with _with():
            with mock.patch.object(email, "EmailClient") as client:
                email._send_sync("subject", "body", "kid@example.com", "Kid")
        payload = client.from_connection_string.return_value.begin_send.call_args[0][0]
        self.assertEqual(payload["senderAddress"], "doNotReply@yuvilab.ai")
        self.assertEqual(
            payload["recipients"]["to"],
            [{"address": "a@yuvilab.ai"}, {"address": "b@yuvilab.ai"}],
        )
        self.assertEqual(payload["replyTo"][0]["address"], "kid@example.com")


if __name__ == "__main__":
    unittest.main()
