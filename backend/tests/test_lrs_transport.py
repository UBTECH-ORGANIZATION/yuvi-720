"""The transport under the reporter: outbox (retry/resend + ledger), client
(headers, one refresh on 401) and the token cache. Spec v1.1 transport
appendix: 204/200 accepted, duplicates not reprocessed, 403 auth, 500
transient → bounded persisted retries."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import httpx

from app.services.lrs import auth, client, config, outbox

ENV = {
    "LRS_TOKEN_URL": "https://lrs-stg.example/auth/token",
    "LRS_STATEMENTS_URL": "https://lrs-stg.example/xAPI/statements",
    "LRS_CLIENT_ID": "cid",
    "LRS_CLIENT_SECRET": "secret",
    "LRS_SCOPE": "lrs",
    "LRS_XAPI_VERSION": "1.0.3",
    "LRS_TIMEOUT_SECONDS": "5",
}


def _statement(sid: str = "11111111-1111-4111-8111-111111111111") -> dict:
    return {
        "id": sid,
        "actor": {"objectType": "Agent", "account": {"homePage": "h", "name": "1012345678"}},
        "verb": {"id": "https://lxp.education.gov.il/xapi/moe/verbs/enter"},
        "object": {"objectType": "Activity", "id": "https://spark.example/session/s1"},
        "context": {"contextActivities": {"grouping": [
            {"objectType": "Activity", "id": "https://spark.example/session/s1"},
        ]}},
        "timestamp": "2026-09-17T10:00:00Z",
    }


class OutboxTests(unittest.IsolatedAsyncioTestCase):
    """JSON fallback = the same rows Mongo would hold, minus the database."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fallback = Path(self.tmp.name) / "lrs_outbox.json"
        self.patches = [
            mock.patch.object(outbox, "_FALLBACK", self.fallback),
            mock.patch.object(outbox, "_collection", return_value=None),
        ]
        for patch in self.patches:
            patch.start()

    def tearDown(self):
        for patch in self.patches:
            patch.stop()
        self.tmp.cleanup()

    def rows(self) -> dict:
        return json.loads(self.fallback.read_text()) if self.fallback.exists() else {}

    async def _enqueue(self, statement, post):
        with mock.patch.object(client, "post_statement", post):
            await outbox.enqueue(statement, learner_id="kid", source="platform")
            await asyncio.sleep(0)  # let the shielded send task run
            await asyncio.sleep(0.01)

    async def test_a_sent_statement_is_a_ledger_row_forever(self):
        await self._enqueue(_statement(), mock.AsyncMock(return_value={"status": 204, "body": None}))
        row = self.rows()[_statement()["id"]]
        self.assertEqual(row["status"], "sent")
        self.assertEqual(row["verb"], "enter")
        self.assertEqual(row["session_id"], "s1")
        self.assertEqual(row["exidentifier"], "1012345678")
        self.assertEqual(row["attempts"], 1)

    async def test_the_same_id_enqueued_twice_is_one_row(self):
        post = mock.AsyncMock(return_value={"status": 204, "body": None})
        await self._enqueue(_statement(), post)
        await self._enqueue({**_statement(), "timestamp": "later"}, post)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[_statement()["id"]]["statement"]["timestamp"], "2026-09-17T10:00:00Z")

    async def test_a_duplicate_rejection_is_delivered(self):
        await self._enqueue(_statement(), mock.AsyncMock(side_effect=client.LrsError("lrs_rejected", 409)))
        self.assertEqual(self.rows()[_statement()["id"]]["status"], "sent")

    async def test_a_permanent_rejection_is_terminal(self):
        for status in (400, 403, 404):
            sid = f"22222222-2222-4222-8222-2222222222{status % 100:02d}"
            await self._enqueue(_statement(sid), mock.AsyncMock(side_effect=client.LrsError("lrs_rejected", status)))
            self.assertEqual(self.rows()[sid]["status"], "rejected", status)
            self.assertEqual(self.rows()[sid]["last_error"], f"lrs_rejected:{status}")

    async def test_a_transient_failure_is_retried_with_backoff_then_failed(self):
        sid = _statement()["id"]
        await self._enqueue(_statement(), mock.AsyncMock(side_effect=client.LrsError("lrs_rejected", 500)))
        row = self.rows()[sid]
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["attempts"], 1)
        next_at = datetime.fromisoformat(row["next_attempt_at"])
        self.assertGreaterEqual(next_at - datetime.now(timezone.utc), timedelta(seconds=10))
        # Two more failures → failed (bounded), still a ledger row.
        with mock.patch.object(client, "post_statement", mock.AsyncMock(side_effect=client.LrsError("lrs_rejected", 500))):
            await outbox._attempt_send(sid)
            await outbox._attempt_send(sid)
        row = self.rows()[sid]
        self.assertEqual(row["status"], "failed")
        self.assertEqual(row["attempts"], 3)
        self.assertIn(sid, self.rows())

    async def test_the_sweep_picks_only_due_rows_and_resends_the_same_id(self):
        sid = _statement()["id"]
        await self._enqueue(_statement(), mock.AsyncMock(side_effect=client.LrsError("lrs_rejected", 500)))
        post = mock.AsyncMock(return_value={"status": 200, "body": [sid]})
        with mock.patch.object(client, "post_statement", post):
            self.assertEqual(await outbox.sweep(), 0)  # not due yet
            data = self.rows()
            data[sid]["next_attempt_at"] = "2000-01-01T00:00:00+00:00"
            self.fallback.write_text(json.dumps(data))
            self.assertEqual(await outbox.sweep(), 1)
        self.assertEqual(post.await_args.args[0]["id"], sid)
        self.assertEqual(self.rows()[sid]["status"], "sent")

    async def test_an_auth_error_is_retried_not_raised(self):
        await self._enqueue(_statement(), mock.AsyncMock(side_effect=auth.LrsAuthError("token endpoint returned 403")))
        row = self.rows()[_statement()["id"]]
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["last_error"], "LrsAuthError")


class ClientTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        auth.invalidate_token()

    def tearDown(self):
        self.env.stop()
        auth.invalidate_token()

    def _transport(self, handler):
        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def make(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        return mock.patch("app.services.lrs.client.httpx.AsyncClient", side_effect=make)

    async def test_headers_are_exactly_the_postman_set(self):
        seen = {}

        def handler(request: httpx.Request):
            seen["headers"] = request.headers
            seen["body"] = json.loads(request.content)
            return httpx.Response(204)

        with mock.patch.object(auth, "get_access_token", mock.AsyncMock(return_value="tok")), self._transport(handler):
            result = await client.post_statement(_statement())
        self.assertEqual(result["status"], 204)
        self.assertEqual(seen["headers"]["authorization"], "Bearer tok")
        self.assertEqual(seen["headers"]["content-type"], "application/json")
        self.assertEqual(seen["headers"]["x-experience-api-version"], "1.0.3")
        self.assertEqual(seen["body"]["id"], _statement()["id"])

    async def test_a_401_triggers_exactly_one_refresh_and_retry(self):
        calls = []

        def handler(request: httpx.Request):
            calls.append(request.headers["authorization"])
            return httpx.Response(401) if len(calls) == 1 else httpx.Response(200, json=[_statement()["id"]])

        tokens = mock.AsyncMock(side_effect=["stale", "fresh"])
        with mock.patch.object(auth, "get_access_token", tokens), self._transport(handler):
            result = await client.post_statement(_statement())
        self.assertEqual(calls, ["Bearer stale", "Bearer fresh"])
        self.assertEqual(result["body"], [_statement()["id"]])
        self.assertEqual(tokens.await_args_list[1].kwargs, {"force_refresh": True})

    async def test_a_second_401_is_an_error_not_a_loop(self):
        with mock.patch.object(auth, "get_access_token", mock.AsyncMock(return_value="t")), \
             self._transport(lambda request: httpx.Response(401)):
            with self.assertRaises(client.LrsError) as raised:
                await client.post_statement(_statement())
        self.assertEqual(raised.exception.status_code, 401)

    async def test_a_transport_failure_is_a_typed_error_without_learner_data(self):
        def handler(request):
            raise httpx.ConnectError("boom", request=request)

        with mock.patch.object(auth, "get_access_token", mock.AsyncMock(return_value="t")), self._transport(handler):
            with self.assertRaises(client.LrsError) as raised:
                await client.post_statement(_statement())
        self.assertEqual(raised.exception.code, "transport:ConnectError")
        self.assertNotIn("1012345678", str(raised.exception))


class AuthTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, ENV)
        self.env.start()
        auth.invalidate_token()

    def tearDown(self):
        self.env.stop()
        auth.invalidate_token()

    def _transport(self, handler):
        transport = httpx.MockTransport(handler)
        real_client = httpx.AsyncClient

        def make(*args, **kwargs):
            kwargs["transport"] = transport
            return real_client(*args, **kwargs)

        return mock.patch("app.services.lrs.auth.httpx.AsyncClient", side_effect=make)

    async def test_the_token_request_is_form_encoded_client_credentials(self):
        seen = {}

        def handler(request: httpx.Request):
            seen["content_type"] = request.headers["content-type"]
            seen["form"] = dict(httpx.QueryParams(request.content.decode()))
            return httpx.Response(200, json={"access_token": "tok", "token_details": {"expires_in": 3600}})

        with self._transport(handler):
            token = await auth.get_access_token()
        self.assertEqual(token, "tok")
        self.assertTrue(seen["content_type"].startswith("application/x-www-form-urlencoded"))
        self.assertEqual(seen["form"], {
            "grant_type": "client_credentials", "client_id": "cid", "client_secret": "secret", "scope": "lrs",
        })
        # Cached until a minute before expiry.
        self.assertAlmostEqual(auth._expires_at, time.time() + 3600 - 60, delta=5)

    async def test_the_cache_serves_until_expiry_and_a_forced_refresh_refetches(self):
        count = {"n": 0}

        def handler(request):
            count["n"] += 1
            return httpx.Response(200, json={"access_token": f"tok{count['n']}", "expires_in": 3600})

        with self._transport(handler):
            self.assertEqual(await auth.get_access_token(), "tok1")
            self.assertEqual(await auth.get_access_token(), "tok1")
            self.assertEqual(await auth.get_access_token(force_refresh=True), "tok2")
        self.assertEqual(count["n"], 2)

    async def test_concurrent_callers_fetch_once(self):
        count = {"n": 0}

        async def slow_handler(request):
            count["n"] += 1
            await asyncio.sleep(0.01)
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})

        with self._transport(slow_handler):
            tokens = await asyncio.gather(*(auth.get_access_token() for _ in range(5)))
        self.assertEqual(set(tokens), {"tok"})
        self.assertEqual(count["n"], 1)

    async def test_a_403_from_the_token_endpoint_is_an_auth_error_without_the_secret(self):
        with self._transport(lambda request: httpx.Response(403, json={"error": "invalid_client"})):
            with self.assertRaises(auth.LrsAuthError) as raised:
                await auth.get_access_token()
        self.assertIn("403", str(raised.exception))
        self.assertNotIn("secret", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
