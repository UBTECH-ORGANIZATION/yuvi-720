"""The Spark half of the live-support bridge.

Two things matter here and nothing else does. First, a Spark deployment without a
support service must degrade quietly - the widget asks `/config`, gets `enabled:
false` and never renders - rather than throwing at the learner. Second, the request
Spark makes on the learner's behalf must carry a pseudonymous reference and nothing
that could name the child, because the support service sits outside the learning
database and is read by support staff, not teachers.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.dependencies import current_user
from app.routes import support_widget

ACTOR = {
    "sub": "learner-42",
    "username": "dana.cohen",
    "display_name": "דנה כהן",
    "roles": ["learner"],
    "org_id": "school-7",
}

CONFIGURED = {
    "SUPPORT_SERVICE_BASE_URL": "https://support.example.org",
    "SUPPORT_SERVICE_KEY": "service-key",
    "SUPPORT_SERVICE_WS_URL": "",
}


def _app(actor: dict | None = ACTOR) -> FastAPI:
    app = FastAPI()
    app.include_router(support_widget.router)
    if actor is not None:
        app.dependency_overrides[current_user] = lambda: actor
    return app


class ConfigTest(unittest.TestCase):
    def test_disabled_without_settings(self) -> None:
        with patch.dict(support_widget.os.environ, {"SUPPORT_SERVICE_BASE_URL": "", "SUPPORT_SERVICE_KEY": ""}):
            response = TestClient(_app()).get("/api/support/widget/config")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["enabled"])

    def test_enabled_when_configured(self) -> None:
        with patch.dict(support_widget.os.environ, CONFIGURED):
            response = TestClient(_app()).get("/api/support/widget/config")
        self.assertTrue(response.json()["enabled"])


class SessionTest(unittest.TestCase):
    def test_unconfigured_deployment_reports_unavailable(self) -> None:
        with patch.dict(support_widget.os.environ, {"SUPPORT_SERVICE_BASE_URL": "", "SUPPORT_SERVICE_KEY": ""}):
            response = TestClient(_app()).post("/api/support/widget/session")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"], "support_unavailable")

    def test_forwards_only_a_pseudonymous_reference(self) -> None:
        sent: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            sent["headers"] = dict(request.headers)
            sent["url"] = str(request.url)
            sent["body"] = request.content.decode()
            return httpx.Response(
                200,
                json={
                    "token": "widget-jwt",
                    "ticket_id": "t-1",
                    "session_id": "s-1",
                    "expires_in": 900,
                    "ws_path": "/ws/widget",
                },
            )

        transport = httpx.MockTransport(handler)
        original = httpx.AsyncClient

        def client_factory(**kwargs):
            kwargs["transport"] = transport
            return original(**kwargs)

        with patch.dict(support_widget.os.environ, CONFIGURED):
            with patch.object(support_widget.httpx, "AsyncClient", client_factory):
                response = TestClient(_app()).post("/api/support/widget/session")

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["token"], "widget-jwt")
        self.assertEqual(body["socket_url"], "wss://support.example.org/ws/widget")
        self.assertEqual(sent["url"], "https://support.example.org/internal/widget-token")
        self.assertEqual(sent["headers"]["x-support-service-key"], "service-key")

        payload = sent["body"]
        self.assertIn("learner-42", payload)
        for identifying in ("dana.cohen", "דנה כהן", "display_name", "username"):
            self.assertNotIn(identifying, payload)

    def test_support_service_failure_is_not_a_spark_error(self) -> None:
        transport = httpx.MockTransport(lambda request: httpx.Response(500, json={"detail": "boom"}))
        original = httpx.AsyncClient

        def client_factory(**kwargs):
            kwargs["transport"] = transport
            return original(**kwargs)

        with patch.dict(support_widget.os.environ, CONFIGURED):
            with patch.object(support_widget.httpx, "AsyncClient", client_factory):
                response = TestClient(_app()).post("/api/support/widget/session")

        self.assertEqual(response.status_code, 503)


class SocketUrlTest(unittest.TestCase):
    def test_scheme_is_upgraded(self) -> None:
        with patch.dict(support_widget.os.environ, {"SUPPORT_SERVICE_WS_URL": ""}):
            self.assertEqual(
                support_widget._socket_url("https://support.example.org", "/ws/widget"),
                "wss://support.example.org/ws/widget",
            )
            self.assertEqual(
                support_widget._socket_url("http://localhost:8000", "/ws/widget"),
                "ws://localhost:8000/ws/widget",
            )

    def test_explicit_override_wins(self) -> None:
        with patch.dict(support_widget.os.environ, {"SUPPORT_SERVICE_WS_URL": "wss://edge.example.org/"}):
            self.assertEqual(
                support_widget._socket_url("https://support.example.org", "/ws/widget"),
                "wss://edge.example.org/ws/widget",
            )


if __name__ == "__main__":
    unittest.main()
