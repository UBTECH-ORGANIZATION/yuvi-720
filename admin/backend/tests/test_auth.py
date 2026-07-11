"""Authentication policy tests for the standalone admin."""

from dataclasses import replace
import unittest

from backend.auth import create_admin_token, decode_admin_token, is_allowed_admin
from backend.config import Settings


BASE_SETTINGS = Settings(
    mongodb_connection_string="mongodb://example.invalid",
    mongodb_database="yuvi720",
    admin_emails=frozenset({"allowed@example.com"}),
    admin_secret_key="test-secret-that-is-long-enough-for-unit-tests",
    google_client_id="client",
    google_client_secret="secret",
    admin_base_url="http://localhost:9998",
    secure_cookies=False,
    port=9998,
    environment="test",
)


class AdminAuthTests(unittest.TestCase):
    def test_allowlist_is_case_insensitive(self) -> None:
        self.assertTrue(is_allowed_admin(" Allowed@Example.com ", BASE_SETTINGS))
        self.assertFalse(is_allowed_admin("other@example.com", BASE_SETTINGS))

    def test_token_is_rejected_after_allowlist_revocation(self) -> None:
        token = create_admin_token(
            email="allowed@example.com",
            name="Admin",
            settings=BASE_SETTINGS,
        )
        self.assertIsNotNone(decode_admin_token(token, BASE_SETTINGS))
        revoked = replace(BASE_SETTINGS, admin_emails=frozenset())
        self.assertIsNone(decode_admin_token(token, revoked))


if __name__ == "__main__":
    unittest.main()
