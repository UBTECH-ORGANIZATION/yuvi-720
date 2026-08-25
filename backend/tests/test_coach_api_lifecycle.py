"""ASGI lifecycle coverage for durable general and temporary lesson Coach chat."""

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
from fastapi import FastAPI

from app.agents import sessions  # noqa: E402
from app.services.coach_support import SupportReservation  # noqa: E402
from app.auth.dependencies import require_learner, require_learner_session  # noqa: E402
from app.routes import agent  # noqa: E402


LEARNER_ID = "api-lifecycle-learner"


async def _fake_coach_stream(learner_id: str, **kwargs):
    """Keep the ASGI route, mode selection and real persistence in scope.

    The model itself is intentionally replaced so the test neither calls APIM
    nor depends on an LLM response. Production `run_coach_stream` owns this
    same role mapping and calls `sessions.append_turn` after its safety gates.
    """
    surface = kwargs.get("surface_context") or {}
    role = "lesson_coach" if surface.get("screen") == "learning_lesson" else "general_companion"
    reply = "תשובה בטוחה"
    await sessions.append_turn(
        learner_id,
        role,
        user=kwargs["user_message"],
        assistant=reply,
        session_id=kwargs["session_id"],
        exchange_id=kwargs.get("exchange_id"),
    )
    kwargs["debug_trace"].append({
        "name": "get_learning_status", "status": "ok", "arguments": "must-not-leak",
    })
    yield reply


async def _fake_visual_tail(**kwargs):
    kwargs["debug_trace"].append({
        "name": "visual_plan", "status": "ok", "source": "system",
    })
    if False:  # pragma: no cover - makes this an async generator without output
        yield ""


async def _collect_sse(client: httpx.AsyncClient, body: dict) -> str:
    text = ""
    async with client.stream("POST", "/api/agent/coach/stream", json=body) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            event = json.loads(payload)
            text += event.get("text", "")
    return text


async def _collect_sse_events(client: httpx.AsyncClient, body: dict) -> list[dict]:
    events: list[dict] = []
    async with client.stream("POST", "/api/agent/coach/stream", json=body) as response:
        assert response.status_code == 200
        async for line in response.aiter_lines():
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            events.append(json.loads(payload))
    return events


class CoachApiLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.app = FastAPI()
        self.app.include_router(agent.router)
        self.app.dependency_overrides[require_learner] = lambda: LEARNER_ID
        self.app.dependency_overrides[require_learner_session] = lambda: {
            "sub": LEARNER_ID, "roles": ["learner"],
        }
        self.collection_patch = patch.object(sessions, "_get_collection_named", return_value=None)
        self.history_patch = patch.object(sessions, "_HISTORY_FALLBACK", root / "history.json")
        self.session_patch = patch.object(sessions, "_FALLBACK", root / "sessions.json")
        self.stream_patch = patch.object(agent, "run_coach_stream", _fake_coach_stream)
        self.visual_patch = patch.object(agent, "_stream_visual_tail", _fake_visual_tail)
        self.get_brain = AsyncMock(return_value={"current_state": {}})
        self.brain_patch = patch("app.brain.repository.get_brain", new=self.get_brain)
        self.activity_patch = patch.object(agent.triggers, "note_chat_activity")
        for item in (
            self.collection_patch, self.history_patch, self.session_patch,
            self.stream_patch, self.visual_patch, self.brain_patch, self.activity_patch,
        ):
            item.start()
        sessions._indexes_ready = False
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.app), base_url="http://test",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in (
            self.activity_patch, self.brain_patch, self.visual_patch, self.stream_patch, self.session_patch,
            self.history_patch, self.collection_patch,
        ):
            item.stop()
        self.temp_dir.cleanup()

    async def test_lesson_conversation_requires_launch_session_id(self):
        response = await self.client.post(
            "/api/agent/coach/conversations",
            json={"unit_id": "math-unit", "component_id": "hexagons"},
        )
        self.assertEqual(response.status_code, 422)

    async def test_support_state_returns_question_status(self):
        self.get_brain.return_value = {
            "current_state": {
                "component_id": "hexagons",
                "item_id": "hexagons-001",
                "question_id": "q1",
            }
        }

        with (
            patch("app.services.kata_catalog.ensure_loaded", new=AsyncMock()),
            patch("app.services.kata_catalog.question_item_ordinals", return_value={"hexagons-001": 1}),
            patch("app.services.kata_catalog.question_part_indexes", return_value={}),
            patch("app.services.kata_catalog.non_question_items", return_value=[]),
            patch("app.services.kata_catalog.questions_for_item", return_value=[{"questionId": "q1"}]),
            patch("app.services.kata_catalog.item_profiles", return_value=[]),
            patch("app.services.learner_activity.has_content_hint", new=AsyncMock(return_value=True)),
            patch.object(
                agent.question_status,
                "status_for_item",
                new=AsyncMock(return_value={
                    "status": "unattempted",
                    "answer_count": 0,
                    "section_count": 1,
                    "correct_section_count": 0,
                }),
            ),
        ):
            response = await self.client.get(
                "/api/agent/coach/support/state?component_id=hexagons"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["question_status"]["status"], "unattempted")
        self.assertTrue(response.json()["content_hint_used"])

    async def test_explicit_lesson_chat_hint_uses_support_lane(self):
        self.get_brain.return_value = {
            "current_state": {
                "component_id": "hexagons",
                "item_id": "hexagons-001",
                "question_id": "q1",
            }
        }
        reservation = SupportReservation("hexagons|hexagons-001|q1", 1)
        stream_calls = []

        async def capture_coach_stream(learner_id: str, **kwargs):
            stream_calls.append(kwargs)
            async for chunk in _fake_coach_stream(learner_id, **kwargs):
                yield chunk

        with (
            patch.object(agent, "reserve_support", new=AsyncMock(return_value=reservation)) as reserve,
            patch.object(agent, "run_coach_stream", capture_coach_stream),
        ):
            text = await _collect_sse(self.client, {
                "conversation_id": "lesson-hint-chat",
                "message": "תן לי רמז",
                "language": "he",
                "surface": {
                    "screen": "learning_lesson",
                    "unit_id": "math-unit",
                    "component_id": "hexagons",
                },
            })

        self.assertEqual(text, "תשובה בטוחה")
        reserve.assert_awaited_once_with(
            LEARNER_ID,
            "hint",
            surface_component_id="hexagons",
            session_id=None,
            conversation_id="lesson-hint-chat",
            expected_question_key=None,
        )
        stream_kwargs = stream_calls[0]
        self.assertEqual(stream_kwargs["user_message"], "תן לי רמז")
        self.assertEqual(stream_kwargs["support_mode"], "hint")
        self.assertEqual(stream_kwargs["hint_level"], 1)
        self.assertEqual(stream_kwargs["endpoint"], "/api/agent/coach/support")

    async def test_general_history_survives_and_lesson_history_is_erased_via_api(self):
        general = await self.client.post(
            "/api/agent/coach/conversations",
            json={"learner_id": "spoofed-learner"},
        )
        self.assertEqual(general.status_code, 201)
        general_id = general.json()["id"]

        general_text = await _collect_sse(self.client, {
            "conversation_id": general_id,
            "message": "כמה זוויות יש במשושה?",
            "language": "he",
            "surface": {"screen": "student_dashboard"},
        })
        self.assertEqual(general_text, "תשובה בטוחה")

        lesson = await self.client.post(
            "/api/agent/coach/conversations",
            json={
                "unit_id": "math-unit",
                "component_id": "hexagons",
                "launch_session_id": "lesson-launch-one",
            },
        )
        self.assertEqual(lesson.status_code, 201)
        lesson_id = lesson.json()["id"]
        lesson_text = await _collect_sse(self.client, {
            "conversation_id": lesson_id,
            "message": "תן לי רמז",
            "language": "he",
            "surface": {
                "screen": "learning_lesson", "unit_id": "math-unit", "component_id": "hexagons",
            },
        })
        self.assertEqual(lesson_text, "תשובה בטוחה")

        before_cleanup = await self.client.get(
            f"/api/agent/coach/conversations/{lesson_id}/messages",
            params={"mode": "lesson_coach"},
        )
        self.assertEqual([row["text"] for row in before_cleanup.json()["messages"]], ["תן לי רמז", "תשובה בטוחה"])

        ended = await self.client.post(f"/api/agent/coach/lesson-conversations/{lesson_id}/end")
        self.assertEqual(ended.json(), {"ok": True, "deleted": True})

        general_list = await self.client.get(
            "/api/agent/coach/conversations", params={"mode": "general_companion"},
        )
        self.assertEqual([row["id"] for row in general_list.json()["conversations"]], [general_id])
        general_messages = await self.client.get(
            f"/api/agent/coach/conversations/{general_id}/messages",
            params={"mode": "general_companion"},
        )
        self.assertEqual([row["text"] for row in general_messages.json()["messages"]], ["כמה זוויות יש במשושה?", "תשובה בטוחה"])

        removed_lesson = await self.client.get(
            f"/api/agent/coach/conversations/{lesson_id}/messages",
            params={"mode": "lesson_coach"},
        )
        self.assertEqual(removed_lesson.json()["messages"], [])

    async def test_reply_trace_is_always_sent_with_only_safe_step_metadata(self):
        body = {
            "conversation_id": "general-debug-trace",
            "message": "מה קורה?",
            "language": "he",
            "surface": {"screen": "student_dashboard"},
        }
        with patch.dict(os.environ, {"COACH_DEBUG_TRACE_ENABLED": "false"}):
            events_without_storage = await _collect_sse_events(self.client, body)
        self.assertEqual(
            [event["tool_trace"] for event in events_without_storage if "tool_trace" in event],
            [[
                {"name": "get_learning_status", "status": "ok", "source": "system"},
                {"name": "visual_plan", "status": "ok", "source": "system"},
            ]],
        )

        with patch.dict(os.environ, {"COACH_DEBUG_TRACE_ENABLED": "true"}):
            events = await _collect_sse_events(self.client, body)

        trace_events = [event["tool_trace"] for event in events if "tool_trace" in event]
        self.assertEqual(trace_events, [[
            {"name": "get_learning_status", "status": "ok", "source": "system"},
            {"name": "visual_plan", "status": "ok", "source": "system"},
        ]])

    def test_safe_tool_trace_keeps_system_and_agent_provenance(self):
        trace = agent._safe_tool_trace([
            {"name": "tutor_decision", "status": "ok", "source": "system"},
            {"name": "get_active_goals", "status": "ok", "source": "agent", "arguments": "private"},
            {"name": "tool_plan", "status": "skipped", "source": "system"},
            {"name": "unsafe value", "status": "ok", "source": "agent"},
        ])
        self.assertEqual(trace, [
            {"name": "tutor_decision", "status": "ok", "source": "system"},
            {"name": "get_active_goals", "status": "ok", "source": "agent"},
        ])


if __name__ == "__main__":
    unittest.main()