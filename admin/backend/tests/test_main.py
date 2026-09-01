"""Route-boundary tests for the standalone administrator service."""

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
    admin_secret_key="route-test-secret-that-is-not-used-in-production",
    google_client_id="",
    google_client_secret="",
    admin_base_url="http://localhost:9998",
    secure_cookies=False,
    port=9998,
    environment="test",
)


class FakeLeadRepository:
    """In-memory stand-in for the `campaign_leads` collection."""

    def __init__(self) -> None:
        self.leads = [
            {
                "lead_id": "lead-1",
                "created_at": datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
                "status": "new",
                "notes": "",
                "full_name": "דנה כהן",
                "role": "רכזת תקשוב",
                "organization": "חטיבת הביניים רבין",
                "city": "חיפה",
                "phone": "050-1234567",
                "email": "dana@example.org",
                "grades": "ז-ט",
                "message": "מעוניינים בפיילוט",
                "source": "landing-720",
            },
            {
                "lead_id": "lead-2",
                "created_at": datetime(2026, 6, 20, 9, 0, tzinfo=timezone.utc),
                "status": "contacted",
                "notes": "",
                "full_name": "עמית לוי",
                "role": "מנהל בית ספר",
                "organization": "עירוני א",
                "city": "תל אביב",
                "phone": "052-7654321",
                "email": "amit@example.org",
                "grades": "",
                "message": "",
                "source": "landing-720",
            },
        ]

    async def fetch_leads(self, **_):
        return list(self.leads)

    async def fetch_lead(self, lead_id: str):
        return next((lead for lead in self.leads if lead["lead_id"] == lead_id), None)

    async def list_sources(self):
        return sorted({lead["source"] for lead in self.leads})

    async def update_lead(self, lead_id: str, *, updates, updated_by, now):
        lead = await self.fetch_lead(lead_id)
        if lead is None:
            return None
        lead.update(updates)
        lead["updated_by"] = updated_by
        lead["updated_at"] = now
        return lead

    def close(self) -> None:
        return None


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

    def test_authenticated_access_is_the_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            private_app = create_app(TEST_SETTINGS)
        private_client = TestClient(private_app)

        status = private_client.get("/api/auth/status")
        self.assertFalse(status.json()["public_access"])
        self.assertEqual(private_client.get("/api/ai-usage/summary").status_code, 401)

    def test_usage_report_requires_server_issued_admin_cookie(self) -> None:
        response = self.client.get("/api/ai-usage/summary")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "admin_authentication_required")

    def test_coach_trace_is_admin_only_and_exposes_only_technical_steps(self) -> None:
        class FakeRepository:
            async def fetch_coach_debug_trace(self, exchange_id: str):
                self.exchange_id = exchange_id
                return {
                    "created_at": "2026-08-20T12:00:00+00:00",
                    "steps": [{"name": "tool_plan", "status": "skipped"}],
                    "learner_id": "must-not-leak",
                    "prompt": "must-not-leak",
                }

        repository = FakeRepository()
        self.app.state.usage_repository = repository
        unauthenticated = self.client.get("/api/coach-debug-traces/exchange-1")
        self.assertEqual(unauthenticated.status_code, 401)

        self._sign_in()
        response = self.client.get("/api/coach-debug-traces/exchange-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {
            "created_at": "2026-08-20T12:00:00+00:00",
            "steps": [{"name": "tool_plan", "status": "skipped"}],
        })
        self.assertEqual(repository.exchange_id, "exchange-1")

    def test_coach_trace_rejects_invalid_exchange_id(self) -> None:
        self._sign_in()
        response = self.client.get("/api/coach-debug-traces/not%20a%20trace")
        self.assertEqual(response.status_code, 404)

    def test_public_preview_never_exposes_coach_traces(self) -> None:
        public_app = create_app(TEST_SETTINGS, public_access=True)
        public_client = TestClient(public_app)

        response = public_client.get("/api/coach-debug-traces/exchange-1")

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

    def test_public_mode_never_exposes_campaign_leads(self) -> None:
        public_app = create_app(TEST_SETTINGS, public_access=True)
        public_app.state.lead_repository = FakeLeadRepository()
        public_client = TestClient(public_app)

        response = public_client.get("/api/leads")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["detail"], "admin_authentication_required")

    def test_environment_badge_names_the_database_without_the_password(self) -> None:
        settings = Settings(
            **{
                **TEST_SETTINGS.__dict__,
                "mongodb_connection_string": (
                    "mongodb+srv://dbadmin:s3cr3t@yuvi720-dev.mongocluster.cosmos.azure.com/?tls=true"
                ),
            }
        )
        app = create_app(settings, public_access=True)
        client = TestClient(app)

        response = client.get("/api/environment")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "environment": "test",
            "host": "yuvi720-dev.mongocluster.cosmos.azure.com",
            "database": "yuvi720",
            "is_production": False,
        })
        self.assertNotIn("s3cr3t", response.text)

    def test_environment_badge_flags_the_production_cluster(self) -> None:
        settings = Settings(
            **{
                **TEST_SETTINGS.__dict__,
                "mongodb_connection_string": (
                    "mongodb+srv://dbadmin:s3cr3t@yuvi720.mongocluster.cosmos.azure.com/?tls=true"
                ),
            }
        )
        app = create_app(settings, public_access=True)
        client = TestClient(app)

        response = client.get("/api/environment")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_production"])

    def test_authenticated_lead_board_groups_statuses(self) -> None:
        self.app.state.lead_repository = FakeLeadRepository()
        self._sign_in()

        response = self.client.get("/api/leads?days=30")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["total"], 2)
        self.assertEqual(body["counts_by_status"]["new"], 1)
        self.assertEqual(body["counts_by_status"]["contacted"], 1)
        self.assertEqual(body["sources"], ["landing-720"])
        self.assertEqual(body["leads"][0]["full_name"], "דנה כהן")

    def test_lead_export_returns_csv_attachment(self) -> None:
        self.app.state.lead_repository = FakeLeadRepository()
        self._sign_in()

        response = self.client.get("/api/leads/export")
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/csv", response.headers["content-type"])
        self.assertIn("attachment;", response.headers["content-disposition"])
        self.assertIn("דנה כהן", response.text)

    def test_lead_status_update_rejects_unknown_status(self) -> None:
        repository = FakeLeadRepository()
        self.app.state.lead_repository = repository
        self._sign_in()

        rejected = self.client.patch("/api/leads/lead-1", json={"status": "archived"})
        self.assertEqual(rejected.status_code, 422)

        accepted = self.client.patch("/api/leads/lead-1", json={"status": "won"})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["status"], "won")
        self.assertEqual(repository.leads[0]["updated_by"], "allowed@example.com")

    def test_missing_lead_returns_not_found(self) -> None:
        self.app.state.lead_repository = FakeLeadRepository()
        self._sign_in()

        response = self.client.get("/api/leads/unknown-lead")
        self.assertEqual(response.status_code, 404)

    def _sign_in(self) -> None:
        token = create_admin_token(
            email="allowed@example.com",
            name="Admin",
            settings=TEST_SETTINGS,
        )
        self.client.cookies.set("spark_admin_token", token)

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
