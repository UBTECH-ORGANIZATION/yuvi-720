"""Route-boundary tests for the standalone administrator service."""

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
    admin_secret_key="route-test-secret-that-is-not-used-in-production",
    google_client_id="",
    google_client_secret="",
    admin_base_url="http://localhost:9998",
    secure_cookies=False,
    port=9998,
    environment="test",
)


class AdminRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.app = create_app(TEST_SETTINGS, public_access=False)
        self.client = TestClient(self.app)

    def test_auth_status_is_safe_when_signed_out(self) -> None:
        response = self.client.get("/api/auth/status")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "authenticated": False,
            "admin": None,
            "oauth_configured": False,
            "public_access": False,
        })

    def test_usage_report_requires_server_issued_admin_cookie(self) -> None:
        response = self.client.get("/api/ai-usage/summary")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "admin_authentication_required")

    def test_authenticated_usage_report_reads_sanitized_events(self) -> None:
        class FakeRepository:
            async def fetch_events(self, **_):
                return [{
                    "event_id": "event-1",
                    "started_at": "2026-07-01T10:00:00+00:00",
                    "actor_id": "learner-opaque-1",
                    "endpoint": "/api/agent/coach/stream",
                    "operation": "coach.reply",
                    "meter": "tokens",
                    "status": "completed",
                    "usage_status": "exact",
                    "total_tokens": 12,
                    "latency_ms": 100,
                }]

            async def fetch_pricing(self, **_):
                return []

        self.app.state.usage_repository = FakeRepository()
        token = create_admin_token(
            email="allowed@example.com",
            name="Admin",
            settings=TEST_SETTINGS,
        )
        self.client.cookies.set("spark_admin_token", token)
        response = self.client.get("/api/ai-usage/summary?days=7")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["access_mode"], "authenticated_admin")
        self.assertEqual(body["totals"]["total_tokens"], 12)
        self.assertNotIn("prompt", body["recent"][0])
        self.assertNotIn("email", body["recent"][0])

    def test_public_mode_opens_usage_report_without_cookie(self) -> None:
        class FakeRepository:
            async def fetch_events(self, **_):
                return []

            async def fetch_pricing(self, **_):
                return []

        public_app = create_app(TEST_SETTINGS, public_access=True)
        public_app.state.usage_repository = FakeRepository()
        public_client = TestClient(public_app)

        status = public_client.get("/api/auth/status")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json(), {
            "authenticated": False,
            "admin": None,
            "oauth_configured": False,
            "public_access": True,
        })

        report = public_client.get("/api/ai-usage/summary?days=7")
        self.assertEqual(report.status_code, 200)
        self.assertEqual(report.json()["access_mode"], "public_preview")

    def test_security_headers_are_applied(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])

    def test_readiness_requires_database_access(self) -> None:
        with patch("backend.main._FRONTEND_DIST") as frontend_dist:
            frontend_dist.exists.return_value = True
            response = self.client.get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "database_unavailable")


if __name__ == "__main__":
    unittest.main()
