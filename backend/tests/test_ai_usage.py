"""AI usage metering, privacy, streaming, and gateway-enforcement tests."""

from __future__ import annotations

import ast
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services import ai_usage, llm  # noqa: E402
from app.services.ai_usage import UsageContext, UsageTimer  # noqa: E402


class _InsertCollection:
    def __init__(self) -> None:
        self.documents: list[dict] = []

    async def create_index(self, *args, **kwargs):
        return kwargs.get("name") or "index"

    async def insert_one(self, document: dict):
        self.documents.append(dict(document))
        return object()


class _StreamResponse:
    status_code = 200
    headers = {"x-request-id": "provider-request"}

    def __init__(self, *, pause_after_first: bool = False) -> None:
        self.pause_after_first = pause_after_first

    async def aiter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"hello"}}]}'
        if self.pause_after_first:
            import asyncio
            await asyncio.Event().wait()
        yield 'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}'
        yield "data: [DONE]"


class _StreamContext:
    def __init__(self, response: _StreamResponse) -> None:
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, traceback):
        return False


class _FakeAsyncClient:
    response = _StreamResponse()

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return False

    def stream(self, *args, **kwargs):
        return _StreamContext(self.response)


class UsagePersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_contains_operational_metadata_but_no_content_or_secrets(self):
        collection = _InsertCollection()

        def collection_for(name: str):
            if name == "ai_usage_events":
                return collection
            return None

        context = UsageContext(
            actor_id="demo-learner",
            actor_type="learner",
            endpoint="/api/test",
            feature="feature_3_learning_companion",
            operation="coach.reply",
            source="unit_test",
            session_id="conversation-1",
            exchange_id="exchange-1",
        )
        ai_usage._indexes_ready = False
        with patch.object(ai_usage, "_get_collection_named", side_effect=collection_for):
            event = await ai_usage.record_usage(
                context=context,
                timer=UsageTimer.start(),
                provider="azure_openai",
                gateway="apim",
                deployment="test-deployment",
                api_version="test-version",
                streaming=False,
                meter="tokens",
                status="completed",
                usage_status="exact",
                usage={
                    "input_tokens": 10,
                    "output_tokens": 3,
                    "total_tokens": 13,
                    "cached_input_tokens": 2,
                },
            )

        self.assertEqual(len(collection.documents), 1)
        self.assertEqual(event["total_tokens"], 13)
        serialized = json.dumps(event, default=str).lower()
        for forbidden in ("messages", "prompt", "response_text", "email", "api_key", "headers", "ssml"):
            self.assertNotIn(f'"{forbidden}"', serialized)
        self.assertNotIn("cost_usd\": 0", serialized)

    def test_usage_parser_never_estimates_missing_counts(self):
        self.assertIsNone(ai_usage.token_usage_from_payload({}))
        parsed = ai_usage.token_usage_from_payload({"prompt_tokens": 8})
        self.assertEqual(parsed["input_tokens"], 8)
        self.assertIsNone(parsed["output_tokens"])
        self.assertIsNone(parsed["total_tokens"])

    def test_cost_requires_explicit_effective_pricing(self):
        usage = {
            "input_tokens": 1_000_000,
            "output_tokens": 500_000,
            "total_tokens": 1_500_000,
            "cached_input_tokens": 0,
        }
        self.assertEqual(ai_usage._price_snapshot(None, "tokens", usage, None), (None, None))
        cost, snapshot = ai_usage._price_snapshot({
            "pricing_id": "verified-test-rate",
            "unit_size": 1_000_000,
            "input_usd_per_unit": 2,
            "output_usd_per_unit": 4,
            "currency": "USD",
        }, "tokens", usage, None)
        self.assertEqual(cost, 4.0)
        self.assertEqual(snapshot["pricing_id"], "verified-test-rate")


class StreamingUsageTests(unittest.IsolatedAsyncioTestCase):
    def context(self) -> UsageContext:
        return UsageContext(
            actor_id="demo-learner",
            actor_type="learner",
            endpoint="/api/agent/coach/stream",
            feature="feature_3_learning_companion",
            operation="coach.reply",
            source="unit_test",
        )

    async def test_stream_records_terminal_provider_usage_once(self):
        recorder = AsyncMock()
        _FakeAsyncClient.response = _StreamResponse()
        with (
            patch.object(llm, "_resolve_llm_config", return_value=("https://example.invalid", "secret", "deployment", "version")),
            patch.object(llm.httpx, "AsyncClient", _FakeAsyncClient),
            patch.object(llm, "record_usage", recorder),
        ):
            chunks = [chunk async for chunk in llm.call_llm_stream(
                [{"role": "user", "content": "not persisted"}],
                usage_context=self.context(),
            )]

        self.assertEqual(chunks, ["hello"])
        recorder.assert_awaited_once()
        kwargs = recorder.await_args.kwargs
        self.assertEqual(kwargs["status"], "completed")
        self.assertEqual(kwargs["usage_status"], "exact")
        self.assertEqual(kwargs["usage"]["total_tokens"], 13)

    async def test_closed_stream_records_cancellation_once(self):
        recorder = AsyncMock()
        _FakeAsyncClient.response = _StreamResponse(pause_after_first=True)
        with (
            patch.object(llm, "_resolve_llm_config", return_value=("https://example.invalid", "secret", "deployment", "version")),
            patch.object(llm.httpx, "AsyncClient", _FakeAsyncClient),
            patch.object(llm, "record_usage", recorder),
        ):
            stream = llm.call_llm_stream(
                [{"role": "user", "content": "not persisted"}],
                usage_context=self.context(),
            )
            self.assertEqual(await stream.__anext__(), "hello")
            await stream.aclose()

        recorder.assert_awaited_once()
        self.assertEqual(recorder.await_args.kwargs["status"], "cancelled")


class UsageGatewayGuardTests(unittest.TestCase):
    def test_every_llm_call_has_usage_context(self):
        missing: list[str] = []
        app_dir = BACKEND_DIR / "app"
        for path in app_dir.rglob("*.py"):
            if path.name == "llm.py":
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = node.func.id if isinstance(node.func, ast.Name) else None
                if name not in {"call_llm", "call_llm_stream"}:
                    continue
                if not any(keyword.arg == "usage_context" for keyword in node.keywords):
                    missing.append(f"{path.relative_to(BACKEND_DIR)}:{node.lineno}")
        self.assertEqual(missing, [], f"LLM calls missing UsageContext: {missing}")

    def test_chat_completions_transport_stays_in_gateway(self):
        violations: list[str] = []
        allowed = {Path("app/services/llm.py")}
        for path in (BACKEND_DIR / "app").rglob("*.py"):
            relative = path.relative_to(BACKEND_DIR)
            if relative in allowed:
                continue
            text = path.read_text(encoding="utf-8")
            if "/chat/completions" in text:
                violations.append(str(relative))
        self.assertEqual(violations, [], f"Direct model transport outside gateway: {violations}")


if __name__ == "__main__":
    unittest.main()
