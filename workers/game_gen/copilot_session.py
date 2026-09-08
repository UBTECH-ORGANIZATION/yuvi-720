"""Headless GitHub Copilot SDK session wrapper for the game_gen worker.

Ported from vibe-coding-kids ``src/backend/agent/session.py``
(``CopilotSessionWrapper``) and the client bootstrap in
``agent_service.AgentService.start`` / ``_headless_copilot_generate``, onto
github-copilot-sdk 1.0.13.

Kept from vibe (proven logic):
  * session creation with ``SystemMessageCustomizeConfig(mode="customize")``
    identity / code_change_rules / custom_instructions overrides
  * ``send(prompt, mode="immediate")`` + poll-until-``session.idle`` loop
  * text accumulation from ``assistant.message_delta`` with the
    ``assistant.message`` fallback
  * SDK auto-continuation handling (``assistant.turn_start`` count > 1 →
    suppress the preamble until a new ```html / <!DOCTYPE appears)
  * token usage capture from ``assistant.usage`` / ``session.usage_info``
    with the 0/0 "ghost event" skip
  * ``user.message`` event-id capture → ``rpc.history.truncate``
  * ``reset_conversation`` (fresh SDK session, same config)

Stripped: ask_user / HITL, steering, WebSocket ``StreamEvent``s,
``DynamicProgress`` checklists, i18n error strings, fix-loop model switching.
Progress is reported as plain dicts through ``on_progress``.

Extensions beyond vibe (all opt-in via constructor kwargs):
  * ``tools`` — custom ``copilot.define_tool`` objects (a terminal one ends
    the turn via ``session.idle`` even with no assistant text); tool
    start/complete events are forwarded as ``{"type": "tool", ...}``
  * ``max_ai_credits`` — ``session_limits={"max_ai_credits": ...}``; a
    limit-exhausted signal yields ``TurnResult(error="credit_limit")``
  * ``system_mode`` — ``"customize"`` (vibe) or ``"replace"``
  * ``model_billing`` — the chosen model's ``ModelBilling`` from
    ``list_models()`` for ``game_gen.usage.estimate_cost_usd``
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from . import config

logger = logging.getLogger("game_gen.copilot")

ProgressCallback = Callable[[dict[str, Any]], None]

# Identity section override.  Vibe's kid-facing persona is replaced with a
# neutral generator identity; the CONTINUATION RULE is kept verbatim because
# it is what makes SDK auto-continuation produce a usable single code block.
_IDENTITY_OVERRIDE = (
    "You are an expert web developer that creates complete, self-contained, "
    "interactive HTML/CSS/JS projects. You return the FULL project as a single "
    "```html ... ``` code block in your response. NEVER write files. "
    "Do NOT reveal your model name/version or internal infrastructure details.\n\n"
    "CONTINUATION RULE: If your previous output was cut off (truncated mid-code) and "
    "a new turn starts, you MUST continue writing from EXACTLY where you stopped. "
    "NEVER restart from the beginning. NEVER re-write HTML/CSS/JS you already produced. "
    "Just pick up from the exact character where you were cut off and finish the code."
)

_BLOCKED_TOOL_CONTEXT = (
    "Do not write files. Return the code inside ```html ... ``` in your response."
)

# Events vibe deliberately did not log as "unhandled".
CREDIT_LIMIT_ERROR = "credit_limit"

_QUIET_EVENTS = frozenset({
    "hook.start", "hook.end",
    "pending_messages.modified", "session.info",
    "assistant.streaming_delta",  # 1.0.13: byte-count progress only, no text
    "session.model_change",
    "session.start", "session.resume", "session.title_changed",
    "assistant.message", "assistant.reasoning",
    "tool.execution_progress", "tool.execution_partial_result",
    "session.session_limits_changed",
})


@dataclass
class TurnUsage:
    """Token usage for one ``send()`` call (sum over SDK usage events)."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model: str = ""
    calls: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "model": self.model,
            "calls": self.calls,
        }


@dataclass
class TurnResult:
    """Outcome of one ``send()`` call."""

    text: str
    usage: TurnUsage
    model: str
    elapsed_s: float
    stop_reason: str | None = None  # "idle" | "error" | "timeout"
    error: str | None = None


def _event_type(event: Any) -> str:
    etype = getattr(event, "type", "")
    return etype.value if hasattr(etype, "value") else str(etype)


def _data_str(data: Any, *names: str) -> str:
    for name in names:
        value = getattr(data, name, None)
        if value:
            return str(value)
    return ""


class HeadlessCopilotSession:
    """One Copilot SDK session driven without a UI.

    Lifecycle: ``await start()`` → ``await send(prompt)`` (repeatable) →
    ``await close()``.  ``truncate_last_exchange()`` drops the last
    user→assistant exchange from SDK history; ``reset_conversation()``
    swaps in a fresh SDK session with the same configuration.
    """

    def __init__(
        self,
        *,
        model: str,
        reasoning_effort: str | None,
        system_message: str,
        session_id: str,
        on_progress: ProgressCallback | None = None,
        timeout_s: float = 900,
        poll_s: float = 2.0,
        client: Any = None,
        tools: list[Any] | None = None,
        max_ai_credits: float | None = None,
        system_mode: Literal["customize", "replace"] = "customize",
    ) -> None:
        if system_mode not in ("customize", "replace"):
            raise ValueError(f"system_mode must be 'customize' or 'replace', got {system_mode!r}")
        self.model = model
        self.requested_reasoning_effort = reasoning_effort
        self.system_message = system_message
        self.session_id = session_id
        self.on_progress = on_progress
        self.timeout_s = timeout_s
        self.poll_s = poll_s
        self.tools = list(tools) if tools else []
        self.max_ai_credits = max_ai_credits
        self.system_mode = system_mode
        self.model_billing: Any = None  # ModelBilling of ``model`` (set in start())

        self._client: Any = client
        self._owns_client = client is None
        self._session: Any = None
        self._session_kwargs: dict[str, Any] = {}

        # Per-turn state (reset in send()).
        self.full_response = ""
        self._done = asyncio.Event()
        self._error: str | None = None
        self._usage = TurnUsage(model=model)
        self._turn_count = 0
        self._continuation_mode = False
        self._continuation_start_pos = 0
        self._in_code_block = False
        self._code_block_done = False
        self._code_chars = 0
        self._reasoning_started = False
        self._credit_exhausted = False
        self._tool_names: dict[str, str] = {}  # tool_call_id -> tool_name
        self._last_user_event_id: str | None = None

    # ── Lifecycle ────────────────────────────────────────────────────

    async def start(self) -> None:
        """Create the client (unless injected) and the SDK session."""
        import copilot

        if self._client is None:
            self._client = _build_client(copilot)
            await self._client.start()
            logger.info("Copilot client started (model=%s)", self.model)

        await config.populate_reasoning_models(self._client)
        self.model_billing = await _lookup_model_billing(self._client, self.model)

        supports_reasoning = config.model_supports_reasoning(self.model)
        effective_reasoning = (
            self.requested_reasoning_effort if supports_reasoning else None
        )
        provider = config.provider_for_model(self.model)
        if provider:
            logger.info("Using APIM gateway %s (model=%s)", provider["base_url"], self.model)
        else:
            logger.info("Using GitHub Copilot directly (model=%s)", self.model)

        if self.system_mode == "replace":
            system_message_cfg: dict[str, Any] = {
                "mode": "replace",
                "content": self.system_message,
            }
        else:
            system_message_cfg = {
                "mode": "customize",
                "sections": {
                    "identity": {"action": "replace", "content": _IDENTITY_OVERRIDE},
                    "code_change_rules": {"action": "remove"},
                    "custom_instructions": {"action": "replace", "content": self.system_message},
                },
            }

        # ``available_tools`` is an allowlist over the *merged* catalog, so
        # custom tools must be listed or the model never sees them.  The SDK's
        # ToolSet convention is ``custom:<name>``; the bare name is included
        # too for runtimes that match unprefixed entries (vibe's ask_user style).
        available_tools: list[str] = []
        for tool in self.tools:
            name = getattr(tool, "name", None)
            if name:
                available_tools.extend((f"custom:{name}", name))

        self._session_kwargs = {
            "on_permission_request": copilot.PermissionHandler.approve_all,
            "model": self.model,
            "streaming": True,
            "system_message": system_message_cfg,
            "available_tools": available_tools,
            "reasoning_effort": effective_reasoning,
            "infinite_sessions": {"enabled": False},
            "hooks": {
                "on_pre_tool_use": self._on_pre_tool_use,
                "on_error_occurred": self._on_error_occurred,
            },
            "provider": provider,
            "on_event": self._on_event,
        }
        if self.tools:
            self._session_kwargs["tools"] = self.tools
        if self.max_ai_credits is not None:
            self._session_kwargs["session_limits"] = {"max_ai_credits": float(self.max_ai_credits)}
        await self._create_session()

    async def _create_session(self) -> None:
        self._session = await self._client.create_session(
            session_id=self.session_id, **self._session_kwargs
        )
        logger.info("Copilot session created: %s", self.session_id)

    async def reset_conversation(self) -> None:
        """Destroy the current SDK session and create a fresh one (same config).

        Clears message history — dramatically reducing input tokens on
        follow-up turns that re-send the full code anyway.
        """
        if self._session is not None:
            try:
                await self._session.disconnect()
            except Exception as exc:
                logger.debug("disconnect during reset failed: %s", exc)
            self._session = None
        old_id = self.session_id
        self.session_id = f"{old_id.split('__')[0]}__{uuid.uuid4().hex[:8]}"
        self._last_user_event_id = None
        await self._create_session()
        logger.info("Session conversation reset %s -> %s", old_id, self.session_id)

    async def close(self) -> None:
        """Disconnect the session and stop the client if we own it."""
        if self._session is not None:
            try:
                await self._session.disconnect()
            except Exception as exc:
                logger.debug("session disconnect failed: %s", exc)
            self._session = None
        if self._owns_client and self._client is not None:
            try:
                await self._client.stop()
            except Exception as exc:
                logger.debug("client stop failed: %s", exc)
            self._client = None

    # ── Turn ─────────────────────────────────────────────────────────

    async def send(self, prompt: str) -> TurnResult:
        """Send a prompt and wait for ``session.idle`` / ``session.error`` / timeout."""
        if self._session is None:
            raise RuntimeError("HeadlessCopilotSession.start() must be awaited before send()")

        self._reset_turn_state()
        started = time.monotonic()

        try:
            await self._session.send(prompt, mode="immediate")
        except Exception as exc:
            err = CREDIT_LIMIT_ERROR if _is_credit_limit_error(str(exc)) else str(exc)
            logger.error("[%s] send failed: %s", self.session_id[:8], exc)
            return TurnResult(
                text="", usage=self._usage, model=self.model,
                elapsed_s=round(time.monotonic() - started, 3),
                stop_reason="error", error=err,
            )

        elapsed = 0.0
        heartbeat = 0.0
        stop_reason = "idle"
        while not self._done.is_set():
            try:
                await asyncio.wait_for(self._done.wait(), timeout=self.poll_s)
                break
            except asyncio.TimeoutError:
                pass
            elapsed += self.poll_s
            heartbeat += self.poll_s
            if heartbeat >= 30:
                logger.info(
                    "[%s] waiting %.0fs | response so far: %d chars",
                    self.session_id[:8], elapsed, len(self.full_response),
                )
                heartbeat = 0.0
            if elapsed >= self.timeout_s:
                stop_reason = "timeout"
                self._error = f"timeout after {self.timeout_s:.0f}s"
                logger.warning(
                    "[%s] timeout — using partial response (%d chars)",
                    self.session_id[:8], len(self.full_response),
                )
                break

        if self._credit_exhausted:
            self._error = CREDIT_LIMIT_ERROR
        if self._done.is_set() and self._error:
            stop_reason = "error"

        result = TurnResult(
            text=self.full_response,
            usage=self._usage,
            model=self._usage.model or self.model,
            elapsed_s=round(time.monotonic() - started, 3),
            stop_reason=stop_reason,
            error=self._error,
        )
        logger.info(
            "[%s] turn %s: %d chars, %din/%dout, %.1fs",
            self.session_id[:8], stop_reason, len(result.text),
            result.usage.input_tokens, result.usage.output_tokens, result.elapsed_s,
        )
        return result

    def _reset_turn_state(self) -> None:
        self.full_response = ""
        self._done = asyncio.Event()
        self._error = None
        self._usage = TurnUsage(model=self.model)
        self._turn_count = 0
        self._continuation_mode = False
        self._continuation_start_pos = 0
        self._in_code_block = False
        self._code_block_done = False
        self._code_chars = 0
        self._reasoning_started = False
        self._credit_exhausted = False
        self._tool_names = {}

    # ── History ──────────────────────────────────────────────────────

    async def truncate_last_exchange(self) -> bool:
        """Remove the last user→assistant exchange from SDK history.

        Uses ``session.rpc.history.truncate`` with the event id captured from
        the most recent ``user.message`` event.  Returns True on success.
        """
        if self._session is None or not self._last_user_event_id:
            return False
        try:
            params = _truncate_request(self._last_user_event_id)
            result = await self._session.rpc.history.truncate(params)
            removed = getattr(result, "events_removed", 0)
            logger.info("[%s] truncated %s events from history", self.session_id[:8], removed)
            self._last_user_event_id = None
            return True
        except Exception as exc:
            logger.warning("[%s] truncate failed: %s", self.session_id[:8], exc)
            return False

    # ── Hooks ────────────────────────────────────────────────────────

    async def _on_pre_tool_use(self, input_data: dict, invocation: Any) -> dict:
        tool_name = input_data.get("toolName", "")
        if tool_name in config.BLOCKED_TOOLS:
            logger.info("[%s] blocked tool: %s", self.session_id[:8], tool_name)
            return {
                "permissionDecision": "deny",
                "additionalContext": _BLOCKED_TOOL_CONTEXT,
            }
        if tool_name:
            logger.debug("[%s] tool: %s", self.session_id[:8], tool_name)
        return {"permissionDecision": "allow"}

    async def _on_error_occurred(self, input_data: dict, invocation: Any) -> dict:
        error = input_data.get("error", "Unknown error")
        recoverable = input_data.get("recoverable", False)
        context = input_data.get("errorContext", "system")
        logger.warning("[%s] error (%s): %s", self.session_id[:8], context, error)
        if recoverable:
            return {"errorHandling": "retry", "retryCount": 2}
        return {"errorHandling": "skip"}

    # ── Event mapping (vibe's _on_event, emitting plain dicts) ───────

    def _emit(self, payload: dict[str, Any]) -> None:
        if self.on_progress is None:
            return
        try:
            self.on_progress(payload)
        except Exception as exc:  # never let a consumer break the event loop
            logger.warning("on_progress raised: %s", exc)

    def _on_event(self, event: Any) -> None:
        etype = _event_type(event)
        data = getattr(event, "data", None)
        sid = self.session_id[:8]

        if etype == "assistant.intent":
            intent = _data_str(data, "intent")
            if intent:
                logger.info("[%s] intent: %s", sid, intent)
                self._emit({"type": "intent", "text": intent})

        elif etype == "assistant.reasoning_delta":
            if not self._reasoning_started:
                self._reasoning_started = True
                logger.debug("[%s] reasoning started", sid)
            delta = _data_str(data, "delta_content", "content")
            if delta:
                self._emit({"type": "reasoning_delta", "text": delta})

        elif etype == "assistant.reasoning":
            # Full block (non-streaming fallback); skip if deltas already streamed.
            text = _data_str(data, "reasoning_text", "content")
            if text and not self._reasoning_started:
                self._reasoning_started = True
                self._emit({"type": "reasoning_delta", "text": text})

        elif etype == "assistant.message_delta":
            delta = _data_str(data, "delta_content", "content")
            if not delta:
                return
            self.full_response += delta
            self._track_code_block(delta)

        elif etype == "assistant.message":
            content = _data_str(data, "content")
            if content and not self.full_response:
                self.full_response = content

        elif etype == "assistant.turn_start":
            self._reasoning_started = False
            self._turn_count += 1
            if self._turn_count > 1:
                # SDK auto-continuation after a token limit: suppress the
                # preamble ("continuing from where I stopped…") until the
                # model re-opens the code block.
                self._continuation_mode = True
                self._continuation_start_pos = len(self.full_response)
                self._in_code_block = False
                self._code_block_done = False
                logger.info("[%s] turn started (continuation — turn %d)", sid, self._turn_count)
            else:
                logger.debug("[%s] turn started", sid)

        elif etype == "assistant.turn_end":
            logger.debug("[%s] turn ended", sid)

        elif etype == "assistant.tool_call_delta":
            # The game arrives as the `submit_game` tool's input: streaming it
            # is how the kid watches the code being written.
            delta = _data_str(data, "input_delta")
            if delta:
                self._emit({"type": "tool_delta", "name": _data_str(data, "tool_name") or "", "text": delta})

        elif etype == "tool.execution_start":
            name = _data_str(data, "tool_name")
            call_id = _data_str(data, "tool_call_id")
            if name:
                if call_id:
                    self._tool_names[call_id] = name
                logger.info("[%s] tool start: %s", sid, name)
                self._emit({"type": "tool", "name": name, "status": "start", "call_id": call_id or None})

        elif etype == "tool.execution_complete":
            call_id = _data_str(data, "tool_call_id")
            name = self._tool_names.pop(call_id, "") or _data_str(data, "tool_name")
            success = getattr(data, "success", None)
            logger.info("[%s] tool done: %s (success=%s)", sid, name or call_id, success)
            self._emit({
                "type": "tool", "name": name, "status": "done",
                "call_id": call_id or None,
                "success": bool(success) if success is not None else None,
            })

        elif etype == "session_limits_exhausted.requested":
            # The runtime wants a user decision (add credits / stop).  Headless
            # has nobody to ask: record the limit and end the turn.
            used = getattr(data, "used_ai_credits", None)
            limit = getattr(data, "max_ai_credits", None)
            logger.error("[%s] AI credit limit reached (%s/%s)", sid, used, limit)
            self._credit_exhausted = True
            self._error = CREDIT_LIMIT_ERROR
            self._emit({"type": "error", "text": CREDIT_LIMIT_ERROR, "used": used, "limit": limit})
            self._done.set()

        elif etype == "abort":
            reason = getattr(data, "reason", None)
            reason_str = reason.value if hasattr(reason, "value") else str(reason or "")
            logger.warning("[%s] turn aborted: %s", sid, reason_str)
            if "credit_limit" in reason_str:
                self._credit_exhausted = True
                self._error = CREDIT_LIMIT_ERROR
            elif not self._error:
                self._error = f"aborted: {reason_str or 'unknown'}"
            self._done.set()

        elif etype in ("assistant.usage", "session.usage_info"):
            self._capture_usage(data)

        elif etype == "user.message":
            eid = getattr(event, "id", None) or getattr(data, "id", None)
            if eid:
                self._last_user_event_id = str(eid)

        elif etype == "session.idle":
            self._done.set()

        elif etype == "session.error":
            err = _data_str(data, "message", "error") or "session error"
            code = _data_str(data, "error_code", "error_type")
            logger.error("[%s] session error: %s (%s)", sid, err, code)
            if _is_credit_limit_error(f"{code} {err}"):
                self._credit_exhausted = True
                err = CREDIT_LIMIT_ERROR
            self._error = err
            self._emit({"type": "error", "text": err})
            self._done.set()

        elif etype not in _QUIET_EVENTS:
            logger.debug("[%s] unhandled event: %s", sid, etype)

    def _capture_usage(self, data: Any) -> None:
        inp = getattr(data, "input_tokens", None) or 0
        out = getattr(data, "output_tokens", None) or 0
        cache_r = getattr(data, "cache_read_tokens", None) or 0
        cache_w = getattr(data, "cache_write_tokens", None) or 0
        # Skip ghost events with 0 tokens (SDK fires these at turn start;
        # session.usage_info carries no per-call token fields at all).
        if int(inp) == 0 and int(out) == 0:
            return
        mdl = getattr(data, "model", None) or self._usage.model or self.model
        self._usage.input_tokens += int(inp)
        self._usage.output_tokens += int(out)
        self._usage.cache_read_tokens += int(cache_r)
        self._usage.cache_write_tokens += int(cache_w)
        self._usage.calls += 1
        if mdl:
            self._usage.model = str(mdl)
        logger.info(
            "[%s] usage: +%din +%dout (model=%s)", self.session_id[:8], int(inp), int(out), mdl,
        )
        self._emit({"type": "usage", **self._usage.as_dict()})

    def _track_code_block(self, delta: str) -> None:
        """Detect the ```html fence and emit ``code_delta`` char counts.

        Mirrors vibe's live code streaming, but reports only sizes (the text
        itself is returned in ``TurnResult.text``).
        """
        if self._continuation_mode:
            continuation_text = self.full_response[self._continuation_start_pos:]
            has_code_marker = "```html" in continuation_text
            has_raw_html = "<!DOCTYPE" in continuation_text.upper()
            if (has_code_marker or has_raw_html) and not self._in_code_block:
                self._continuation_mode = False
                logger.info(
                    "[%s] continuation preamble ended — %s found",
                    self.session_id[:8], "```html" if has_code_marker else "<!DOCTYPE",
                )
            elif not self._in_code_block:
                return  # still in preamble; text is accumulated but not counted

        if not self._in_code_block and not self._code_block_done and "```html" in self.full_response:
            marker_pos = self.full_response.rfind("```html")
            after_marker = self.full_response[marker_pos + 7:]
            if after_marker.startswith("\n"):
                after_marker = after_marker[1:]
            self._in_code_block = True
            self._code_chars = len(after_marker)
            logger.info("[%s] code streaming started (%d initial chars)", self.session_id[:8], len(after_marker))
            if after_marker:
                self._emit({"type": "code_delta", "chars": len(after_marker), "total": self._code_chars})
        elif self._in_code_block:
            if "```" in delta and not delta.strip().startswith("```html"):
                final_chunk = delta[: delta.find("```")]
                if final_chunk:
                    self._code_chars += len(final_chunk)
                    self._emit({"type": "code_delta", "chars": len(final_chunk), "total": self._code_chars})
                self._in_code_block = False
                self._code_block_done = True
                logger.info("[%s] code streaming ended (%d total chars)", self.session_id[:8], self._code_chars)
                self._emit({"type": "code_end", "total": self._code_chars})
            else:
                self._code_chars += len(delta)
                self._emit({"type": "code_delta", "chars": len(delta), "total": self._code_chars})


# ── Client / helpers ─────────────────────────────────────────────────


def _build_client(copilot_mod: Any) -> Any:
    """Construct a ``CopilotClient`` the way vibe's ``AgentService.start`` did.

    SDK 1.0.13 replaced ``SubprocessConfig`` with keyword options on the
    client plus a ``RuntimeConnection`` for the CLI path.
    """
    token = config.github_token()
    connection = None
    if config.COPILOT_CLI_PATH:
        connection = copilot_mod.RuntimeConnection.for_stdio(path=config.COPILOT_CLI_PATH)
    if token:
        logger.info("Copilot auth: token (%s...)", token[:6])
    else:
        logger.info("Copilot auth: logged-in CLI user")
    return copilot_mod.CopilotClient(
        connection=connection,
        log_level=config.COPILOT_LOG_LEVEL,
        github_token=token,
        use_logged_in_user=config.use_logged_in_user(),
    )


def _is_credit_limit_error(text: str) -> bool:
    """Heuristic over SDK error text/codes for the ``max_ai_credits`` limit."""
    t = text.lower()
    return "credit" in t and ("limit" in t or "exhaust" in t or "exceed" in t)


async def _lookup_model_billing(client: Any, model: str) -> Any:
    """``ModelBilling`` for ``model`` from ``client.list_models()`` (cached by SDK), or None."""
    try:
        for m in await client.list_models():
            if getattr(m, "id", None) == model:
                return getattr(m, "billing", None)
    except Exception as exc:
        logger.warning("model billing lookup failed: %s", exc)
    return None


def _truncate_request(event_id: str) -> Any:
    """Build ``HistoryTruncateRequest`` (falls back to a dict for older SDKs)."""
    try:
        from copilot.generated.rpc import HistoryTruncateRequest

        return HistoryTruncateRequest(event_id=event_id)
    except Exception:
        return {"event_id": event_id}


async def list_model_ids(client: Any = None) -> list[dict[str, Any]]:
    """Return ``[{id, name, supports_reasoning, ...}]`` from ``client.list_models()``.

    Creates (and stops) a throwaway client unless one is passed in.
    """
    import copilot

    owns = client is None
    if owns:
        client = _build_client(copilot)
        await client.start()
    try:
        models = await client.list_models()
    finally:
        if owns:
            try:
                await client.stop()
            except Exception as exc:
                logger.debug("client stop failed: %s", exc)

    out: list[dict[str, Any]] = []
    for m in models:
        supports = getattr(getattr(m, "capabilities", None), "supports", None)
        out.append({
            "id": m.id,
            "name": getattr(m, "name", m.id),
            "supports_reasoning": bool(getattr(supports, "reasoning_effort", False)),
            "supported_reasoning_efforts": getattr(m, "supported_reasoning_efforts", None),
            "default_reasoning_effort": getattr(m, "default_reasoning_effort", None),
        })
    return out


__all__ = [
    "CREDIT_LIMIT_ERROR",
    "HeadlessCopilotSession",
    "TurnResult",
    "TurnUsage",
    "list_model_ids",
]
