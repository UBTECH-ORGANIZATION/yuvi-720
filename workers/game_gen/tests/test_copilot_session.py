"""Unit tests for game_gen.copilot_session using a fake Copilot client.

``copilot.CopilotClient`` / ``RuntimeConnection`` are monkeypatched so no CLI
subprocess is spawned; SDK events are injected through the ``on_event``
callback captured from ``create_session``.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

import copilot

from game_gen import config
from game_gen.copilot_session import (
    CREDIT_LIMIT_ERROR,
    HeadlessCopilotSession,
    TurnResult,
    list_model_ids,
)


# ── Fakes ─────────────────────────────────────────────────────────────


class FakeHistory:
    def __init__(self) -> None:
        self.calls: list[Any] = []
        self.fail = False

    async def truncate(self, params: Any) -> Any:
        self.calls.append(params)
        if self.fail:
            raise RuntimeError("boom")
        return SimpleNamespace(events_removed=2)


class FakeSession:
    def __init__(self, session_id: str, kwargs: dict) -> None:
        self.session_id = session_id
        self.kwargs = kwargs
        self.on_event = kwargs["on_event"]
        self.sent: list[tuple[str, dict]] = []
        self.rpc = SimpleNamespace(history=FakeHistory())
        self.disconnected = False
        self.script: list[Any] = []  # events to fire on send()

    async def send(self, prompt: str, **kw: Any) -> str:
        self.sent.append((prompt, kw))
        if getattr(self, "send_error", None):
            raise self.send_error
        for ev in self.script:
            self.on_event(ev)
        return "msg-1"

    async def disconnect(self) -> None:
        self.disconnected = True


class FakeClient:
    instances: list["FakeClient"] = []

    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        self.sessions: list[FakeSession] = []
        self.models = [
            SimpleNamespace(
                id="claude-opus-5", name="Claude Opus 5",
                capabilities=SimpleNamespace(supports=SimpleNamespace(reasoning_effort=True)),
                supported_reasoning_efforts=["low", "medium", "high"],
                default_reasoning_effort="medium",
                billing=SimpleNamespace(
                    multiplier=1.0,
                    token_prices=SimpleNamespace(batch_size=1_000_000, input_price=5.0, output_price=25.0),
                ),
            ),
            SimpleNamespace(
                id="gpt-4.1", name="GPT-4.1",
                capabilities=SimpleNamespace(supports=SimpleNamespace(reasoning_effort=False)),
                supported_reasoning_efforts=None,
                default_reasoning_effort=None,
            ),
        ]
        FakeClient.instances.append(self)

    async def start(self) -> None:
        self.started = True

    async def stop(self) -> None:
        self.stopped = True

    async def list_models(self) -> list[Any]:
        return self.models

    async def create_session(self, *, session_id: str, **kwargs: Any) -> FakeSession:
        s = FakeSession(session_id, kwargs)
        self.sessions.append(s)
        return s


def ev(etype: str, **data: Any) -> SimpleNamespace:
    return SimpleNamespace(type=etype, data=SimpleNamespace(**data), id=None)


@pytest.fixture(autouse=True)
def patched_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    FakeClient.instances.clear()
    monkeypatch.setattr(copilot, "CopilotClient", FakeClient)
    monkeypatch.setattr(config, "COPILOT_CLI_PATH", None)
    config.reset_reasoning_cache()
    yield
    config.reset_reasoning_cache()


def run(coro: Any) -> Any:
    return asyncio.run(coro)


async def _started(**overrides: Any) -> tuple[HeadlessCopilotSession, FakeSession, list[dict]]:
    events: list[dict] = []
    kwargs: dict[str, Any] = dict(
        model="claude-opus-5",
        reasoning_effort="medium",
        system_message="SYSTEM",
        session_id="job-1__aaaaaaaa",
        on_progress=events.append,
        timeout_s=5,
        poll_s=0.01,
    )
    kwargs.update(overrides)
    s = HeadlessCopilotSession(**kwargs)
    await s.start()
    return s, FakeClient.instances[-1].sessions[-1], events


# ── Tests ─────────────────────────────────────────────────────────────


def test_start_builds_session_like_vibe() -> None:
    async def go() -> None:
        s, fs, _ = await _started()
        kw = fs.kwargs
        assert fs.session_id == "job-1__aaaaaaaa"
        assert kw["model"] == "claude-opus-5"
        assert kw["streaming"] is True
        assert kw["available_tools"] == []
        assert kw["infinite_sessions"] == {"enabled": False}
        assert kw["reasoning_effort"] == "medium"  # from list_models capabilities
        assert kw["provider"] is None  # claude-* → GitHub direct
        assert kw["on_permission_request"] is copilot.PermissionHandler.approve_all
        sm = kw["system_message"]
        assert sm["mode"] == "customize"
        assert sm["sections"]["custom_instructions"] == {"action": "replace", "content": "SYSTEM"}
        assert sm["sections"]["code_change_rules"] == {"action": "remove"}
        assert "CONTINUATION RULE" in sm["sections"]["identity"]["content"]
        assert "on_pre_tool_use" in kw["hooks"]
        client = FakeClient.instances[-1]
        assert client.started
        assert client.kwargs["use_logged_in_user"] is True
        assert client.kwargs["github_token"] is None
        await s.close()
        assert fs.disconnected and client.stopped

    run(go())


def test_reasoning_dropped_for_unsupported_model() -> None:
    async def go() -> None:
        s, fs, _ = await _started(model="gpt-4.1")
        assert fs.kwargs["reasoning_effort"] is None
        await s.close()

    run(go())


def test_usage_accumulates_and_skips_ghosts() -> None:
    async def go() -> None:
        s, fs, events = await _started()
        fs.script = [
            ev("assistant.turn_start"),
            ev("assistant.usage", input_tokens=0, output_tokens=0, model="claude-opus-5"),  # ghost
            ev("assistant.usage", input_tokens=100, output_tokens=20,
               cache_read_tokens=5, cache_write_tokens=7, model="claude-opus-5"),
            ev("session.usage_info", current_tokens=500, messages_length=3, token_limit=200000),  # no tokens
            ev("assistant.usage", input_tokens=50, output_tokens=None, model=None),
            ev("session.idle"),
        ]
        res = await s.send("build")
        assert isinstance(res, TurnResult)
        u = res.usage
        assert (u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens) == (150, 20, 5, 7)
        assert u.calls == 2
        assert u.model == "claude-opus-5"
        assert res.model == "claude-opus-5"
        assert res.stop_reason == "idle" and res.error is None
        usage_events = [e for e in events if e["type"] == "usage"]
        assert len(usage_events) == 2
        assert usage_events[-1]["input_tokens"] == 150
        assert fs.sent[0] == ("build", {"mode": "immediate"})

    run(go())


def test_text_accumulates_to_idle_and_code_delta_counts() -> None:
    async def go() -> None:
        s, fs, events = await _started()
        fs.script = [
            ev("assistant.turn_start"),
            ev("assistant.intent", intent="Building the game"),
            ev("assistant.reasoning_delta", delta_content="think"),
            ev("assistant.message_delta", delta_content="Here you go:\n```html\n<!DOCTYPE html>"),
            ev("assistant.message_delta", delta_content="<h1>hi</h1>"),
            ev("assistant.message_delta", delta_content="</html>\n```\nDone!"),
            ev("assistant.message_delta", delta_content=" bye"),
            ev("session.idle"),
        ]
        res = await s.send("build")
        assert res.text == "Here you go:\n```html\n<!DOCTYPE html><h1>hi</h1></html>\n```\nDone! bye"
        types = [e["type"] for e in events]
        assert types[:2] == ["intent", "reasoning_delta"]
        code = [e for e in events if e["type"] == "code_delta"]
        assert [c["chars"] for c in code] == [len("<!DOCTYPE html>"), len("<h1>hi</h1>"), len("</html>\n")]
        assert code[-1]["total"] == len("<!DOCTYPE html><h1>hi</h1></html>\n")
        assert any(e["type"] == "code_end" for e in events)
        # nothing counted after the fence closed
        assert all(c["total"] <= len("<!DOCTYPE html><h1>hi</h1></html>\n") for c in code)

    run(go())


def test_continuation_preamble_suppressed_until_new_fence() -> None:
    async def go() -> None:
        s, fs, events = await _started()
        fs.script = [
            ev("assistant.turn_start"),
            ev("assistant.message_delta", delta_content="```html\n<html>"),
            # token limit → SDK auto-continues with a new turn
            ev("assistant.turn_start"),
            ev("assistant.message_delta", delta_content="Continuing where I stopped!\n"),
            ev("assistant.message_delta", delta_content="```html\n</html>"),
            ev("assistant.message_delta", delta_content="\n```"),
            ev("session.idle"),
        ]
        res = await s.send("build")
        assert "Continuing where I stopped!" in res.text  # kept in text
        code = [e for e in events if e["type"] == "code_delta"]
        assert [c["chars"] for c in code] == [len("<html>"), len("</html>"), 1]
        assert s._turn_count == 2

    run(go())


def test_session_error_sets_error() -> None:
    async def go() -> None:
        s, fs, events = await _started()
        fs.script = [
            ev("assistant.message_delta", delta_content="partial"),
            ev("session.error", message="rate limited", error_type="model"),
        ]
        res = await s.send("build")
        assert res.stop_reason == "error"
        assert res.error == "rate limited"
        assert res.text == "partial"
        assert events[-1] == {"type": "error", "text": "rate limited"}

    run(go())


def test_timeout_returns_partial_with_error() -> None:
    async def go() -> None:
        s, fs, _ = await _started(timeout_s=0.05, poll_s=0.01)
        fs.script = [ev("assistant.message_delta", delta_content="half a game")]  # never idles
        res = await s.send("build")
        assert res.stop_reason == "timeout"
        assert res.error and "timeout" in res.error
        assert res.text == "half a game"
        assert res.elapsed_s >= 0.04

    run(go())


def test_truncate_uses_last_user_event_id() -> None:
    async def go() -> None:
        s, fs, _ = await _started()
        assert await s.truncate_last_exchange() is False  # nothing captured yet
        fs.script = [
            SimpleNamespace(type="user.message", data=SimpleNamespace(content="build"), id="evt-42"),
            ev("session.idle"),
        ]
        await s.send("build")
        assert await s.truncate_last_exchange() is True
        params = fs.rpc.history.calls[0]
        assert getattr(params, "event_id", None) == "evt-42" or params == {"event_id": "evt-42"}
        assert await s.truncate_last_exchange() is False  # id consumed
        # failure path
        fs.script = [
            SimpleNamespace(type="user.message", data=SimpleNamespace(content="x"), id="evt-43"),
            ev("session.idle"),
        ]
        await s.send("again")
        fs.rpc.history.fail = True
        assert await s.truncate_last_exchange() is False

    run(go())


def test_reset_conversation_creates_fresh_session_same_config() -> None:
    async def go() -> None:
        s, fs, _ = await _started()
        await s.reset_conversation()
        client = FakeClient.instances[-1]
        assert fs.disconnected
        assert len(client.sessions) == 2
        new = client.sessions[-1]
        assert new.session_id.startswith("job-1__") and new.session_id != fs.session_id
        assert new.kwargs["system_message"] == fs.kwargs["system_message"]
        assert new.kwargs["model"] == "claude-opus-5"

    run(go())


def test_list_model_ids() -> None:
    async def go() -> None:
        models = await list_model_ids()
        assert models[0]["id"] == "claude-opus-5" and models[0]["supports_reasoning"] is True
        assert models[1]["id"] == "gpt-4.1" and models[1]["supports_reasoning"] is False
        assert FakeClient.instances[-1].stopped

    run(go())


def test_config_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    assert config.needs_github_direct("claude-opus-5")
    assert config.needs_github_direct("claude-sonnet-4")
    assert not config.needs_github_direct("gpt-5.4")
    rule = config._get_language_rule("he")
    assert 'lang="he"' in rule and 'dir="rtl"' in rule
    assert "Do NOT put dir=\"rtl\" on the <html> or <body>" in rule
    assert "write_file" in config.BLOCKED_TOOLS
    # static fallback before the SDK is queried
    config.reset_reasoning_cache()
    assert config.model_supports_reasoning("claude-opus-5")
    assert not config.model_supports_reasoning("gpt-4.1")
    # APIM provider only for non-claude models
    monkeypatch.setattr(config, "APIM_BASE_URL", "https://apim.example/openai")
    monkeypatch.setattr(config, "APIM_SUBSCRIPTION_KEY", "k")
    assert config.provider_for_model("claude-opus-5") is None
    p = config.provider_for_model("gpt-5.4")
    assert p and p["type"] == "azure" and p["azure"]["api_version"] == config.APIM_API_VERSION


# ── Extensions: tools / credits / system_mode / billing ───────────────


def _fake_tool(name: str, terminal: bool = False) -> SimpleNamespace:
    return SimpleNamespace(name=name, description=name, handler=lambda *_: None, is_terminal=terminal)


def test_tools_passed_through_and_terminal_tool_ends_turn_without_text() -> None:
    async def go() -> None:
        submit = _fake_tool("submit_game", terminal=True)
        helper = _fake_tool("lint_html")
        s, fs, events = await _started(tools=[submit, helper])
        kw = fs.kwargs
        assert kw["tools"] == [submit, helper]
        assert kw["available_tools"] == [
            "custom:submit_game", "submit_game", "custom:lint_html", "lint_html",
        ]
        # deny-hook blocks only BLOCKED_TOOLS, never the custom tools
        allow = await s._on_pre_tool_use({"toolName": "submit_game"}, None)
        deny = await s._on_pre_tool_use({"toolName": "write_file"}, None)
        assert allow["permissionDecision"] == "allow"
        assert deny["permissionDecision"] == "deny"
        # terminal tool: no assistant text, only tool events, then idle
        fs.script = [
            ev("assistant.turn_start"),
            ev("tool.execution_start", tool_call_id="c1", tool_name="submit_game", arguments={"html": "<html/>"}),
            ev("tool.execution_complete", tool_call_id="c1", success=True),
            ev("session.idle"),
        ]
        res = await s.send("build")
        assert res.text == ""
        assert res.stop_reason == "idle" and res.error is None
        tool_events = [e for e in events if e["type"] == "tool"]
        assert tool_events == [
            {"type": "tool", "name": "submit_game", "status": "start", "call_id": "c1"},
            {"type": "tool", "name": "submit_game", "status": "done", "call_id": "c1", "success": True},
        ]
        assert s._tool_names == {}

    run(go())


def test_no_tools_keeps_empty_allowlist_and_no_tools_kwarg() -> None:
    async def go() -> None:
        s, fs, _ = await _started()
        assert fs.kwargs["available_tools"] == []
        assert "tools" not in fs.kwargs
        assert "session_limits" not in fs.kwargs
        await s.close()

    run(go())


def test_max_ai_credits_sets_session_limits_and_exhausted_event_maps_to_credit_limit() -> None:
    async def go() -> None:
        s, fs, events = await _started(max_ai_credits=2.5)
        assert fs.kwargs["session_limits"] == {"max_ai_credits": 2.5}
        fs.script = [
            ev("assistant.message_delta", delta_content="partial"),
            ev("session_limits_exhausted.requested", request_id="r1", max_ai_credits=2.5, used_ai_credits=2.6),
        ]
        res = await s.send("build")
        assert res.stop_reason == "error"
        assert res.error == CREDIT_LIMIT_ERROR == "credit_limit"
        assert res.text == "partial"
        assert events[-1]["type"] == "error" and events[-1]["text"] == "credit_limit"
        # state resets per turn
        fs.script = [ev("session.idle")]
        assert (await s.send("again")).error is None

    run(go())


def test_credit_limit_via_abort_reason_and_session_error_and_send_exception() -> None:
    async def go() -> None:
        s, fs, _ = await _started(max_ai_credits=1)
        fs.script = [ev("abort", reason=SimpleNamespace(value="autopilot_credit_limit"))]
        assert (await s.send("a")).error == "credit_limit"

        fs.script = [ev("session.error", message="Session AI credit limit exceeded", error_type="limit")]
        res = await s.send("b")
        assert res.error == "credit_limit" and res.stop_reason == "error"

        fs.script = [ev("session.error", message="rate limited", error_type="model")]
        assert (await s.send("c")).error == "rate limited"  # unrelated errors untouched

        fs.send_error = RuntimeError("max AI credits exceeded for session")
        res = await s.send("d")
        assert res.error == "credit_limit" and res.stop_reason == "error" and res.text == ""

        fs.send_error = RuntimeError("connection closed")
        assert (await s.send("e")).error == "connection closed"

    run(go())


def test_system_mode_replace() -> None:
    async def go() -> None:
        s, fs, _ = await _started(system_mode="replace")
        assert fs.kwargs["system_message"] == {"mode": "replace", "content": "SYSTEM"}
        await s.close()

    run(go())
    with pytest.raises(ValueError):
        HeadlessCopilotSession(
            model="m", reasoning_effort=None, system_message="x", session_id="s", system_mode="bogus",  # type: ignore[arg-type]
        )


def test_model_billing_exposed_from_list_models() -> None:
    async def go() -> None:
        s, _, _ = await _started()
        assert s.model_billing is not None
        assert s.model_billing.token_prices.input_price == 5.0
        s2, _, _ = await _started(model="gpt-4.1")  # no billing on that fake model
        assert s2.model_billing is None
        s3, _, _ = await _started(model="unknown-model")
        assert s3.model_billing is None

    run(go())
