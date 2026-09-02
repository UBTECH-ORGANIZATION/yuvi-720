"""The teacher assistant endpoints.

Kept thin on purpose: authorize, delegate to the agent, persist the turn. Every
security property lives in `teacher_tools.registry.dispatch`, so there is
nothing here that a second endpoint could accidentally bypass.

`grounded` and `tools` go back to the client on every answer, because the trace
IS the explainability surface (anti-hallucination layer 5) — an answer with an
empty trace must be visibly ungrounded to the teacher, not silently plausible.

Threads reuse `agents.sessions` unchanged: it is already role-generic, and its
`agent_conversations` / `agent_messages` collections already carry titles and
cursor pagination. The teacher id sits in the `learner_id` field — every query
is keyed on it, which is what makes one teacher's threads unreachable from
another's session. What is stored is the model's own text, so a persisted
message holds `{{student:<id>}}` tokens and never a child's name.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.agents import teacher_assistant
from app.auth.dependencies import require_teacher_session

router = APIRouter(prefix="/api/teacher/assistant", tags=["teacher"])

_NO_STORE = {"Cache-Control": "private, no-store"}
_STREAM_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
}

MAX_MESSAGE = 2000
HISTORY_TURNS = teacher_assistant.HISTORY_TURNS
ROLE = "teacher_assistant"


class AssistantRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE)
    language: Optional[str] = Field(default=None, max_length=8)
    #: What the teacher is looking at. Advisory context for the model — it is
    #: never trusted for authorization, which is resolved from the session.
    screen: Optional[dict[str, Any]] = None
    history: Optional[list[dict[str, Any]]] = None
    conversation_id: Optional[str] = Field(default=None, max_length=80)


class ActionOutcomeRequest(BaseModel):
    """The receipt for an action the teacher took from a chat message."""

    action_id: str = Field(max_length=120)
    status: str = Field(pattern=r"^(done|dismissed|failed)$")
    #: A short human line for the completed row — "יעד נוצר ל-6 תלמידים".
    #: Rendered as-is, so it is length-capped and never interpolated as HTML.
    summary: Optional[str] = Field(default=None, max_length=200)


def _clean_history(history: Optional[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Only role and content survive from client history.

    Anything else the client sends is discarded rather than replayed into a
    prompt.
    """
    return [
        {"role": turn.get("role"), "content": str(turn.get("content") or "")}
        for turn in (history or [])[-HISTORY_TURNS:]
        if isinstance(turn, dict) and turn.get("role") in {"user", "assistant"}
    ]


@router.get("/tools")
async def list_tools(session=Depends(require_teacher_session)) -> JSONResponse:
    """What the assistant can fetch — powers the client's capability hints."""
    from app.agents import teacher_tools

    return JSONResponse(
        content={"tools": teacher_tools.manifest(),
                 "max_rounds": teacher_tools.MAX_ROUNDS,
                 "max_tool_calls": teacher_tools.MAX_TOOL_CALLS},
        headers=_NO_STORE,
    )


@router.post("")
async def ask(
    payload: AssistantRequest, session=Depends(require_teacher_session)
) -> JSONResponse:
    """Answer in one shot. The non-streaming fallback for `/stream`."""
    from app.core.localization import normalize_language

    message = (payload.message or "").strip()
    if not message:
        return JSONResponse(content={"error": "empty_message"}, status_code=400,
                            headers=_NO_STORE)

    result = await teacher_assistant.run_assistant(
        session["sub"],
        message,
        language=normalize_language(payload.language),
        screen=payload.screen or {},
        history=_clean_history(payload.history),
        session_id=session.get("sid"),
    )

    await _persist(
        session["sub"], message, result,
        conversation_id=payload.conversation_id,
        language=normalize_language(payload.language),
    )
    return JSONResponse(content=result, headers=_NO_STORE)


@router.post("/stream")
async def ask_stream(
    payload: AssistantRequest, session=Depends(require_teacher_session)
) -> StreamingResponse:
    """Answer out loud.

    A grounded answer costs up to four tool rounds before the model writes its
    first word; blocking on all of it made every question feel broken. The agent
    still decides what may be said early — see `run_assistant_stream`.
    """
    from app.agents import sessions
    from app.core.localization import normalize_language

    teacher_id = session["sub"]
    message = (payload.message or "").strip()
    language = normalize_language(payload.language)
    conversation_id = sessions.normalize_session_id(payload.conversation_id)

    async def event_generator():
        if not message:
            yield f"data: {json.dumps({'error': 'empty_message'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Name the thread while the answer is being written, not after it.
        title_task = await _start_title_task(teacher_id, conversation_id, message, language)

        result: dict[str, Any] = {}
        try:
            async for event in teacher_assistant.run_assistant_stream(
                teacher_id,
                message,
                language=language,
                screen=payload.screen or {},
                history=_clean_history(payload.history),
                session_id=session.get("sid"),
            ):
                if "done" in event:
                    # Nested under `answer`, NOT spread into the frame. The
                    # final payload has a `text` field holding the WHOLE reply,
                    # and a client that reads any frame's `text` as a fragment
                    # would append the answer a second time on top of itself.
                    result = event["done"]
                    yield f"data: {json.dumps({'answer': result}, ensure_ascii=False)}\n\n"
                else:
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:      # pragma: no cover — the client must not hang
            print(f"⚠️ teacher assistant stream failed: {type(exc).__name__}")
            result = {"text": None, "text_key": teacher_assistant.UNAVAILABLE,
                      "tools": [], "grounded": False}
            yield f"data: {json.dumps({'answer': result}, ensure_ascii=False)}\n\n"

        title, title_source = await _resolve_title(title_task, language)
        if title:
            yield f"data: {json.dumps({'title': title}, ensure_ascii=False)}\n\n"

        await _persist(
            teacher_id, message, result,
            conversation_id=conversation_id,
            language=language,
            title=title,
            title_source=title_source,
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(), media_type="text/event-stream", headers=_STREAM_HEADERS,
    )


# ── threads ────────────────────────────────────────────────────────────────


@router.get("/conversations")
async def conversations(
    limit: int = Query(default=12, ge=1, le=30),
    cursor: str | None = Query(default=None, max_length=400),
    session=Depends(require_teacher_session),
) -> JSONResponse:
    """Page through this teacher's own threads, newest first."""
    from app.agents import sessions

    return JSONResponse(
        content=await sessions.list_conversations(
            session["sub"], role=ROLE, limit=limit, cursor=cursor
        ),
        headers=_NO_STORE,
    )


@router.post("/conversations", status_code=201)
async def create_conversation(session=Depends(require_teacher_session)) -> JSONResponse:
    """Start a new empty thread without storing state in the browser."""
    from app.agents import sessions

    return JSONResponse(
        status_code=201,
        content=await sessions.create_conversation(session["sub"], role=ROLE),
        headers=_NO_STORE,
    )


@router.get("/conversations/{conversation_id}/messages")
async def conversation_messages(
    conversation_id: str,
    limit: int = Query(default=20, ge=1, le=50),
    cursor: str | None = Query(default=None, max_length=400),
    session=Depends(require_teacher_session),
) -> JSONResponse:
    """Page backward through one thread for scroll-up loading."""
    from app.agents import sessions

    return JSONResponse(
        content=await sessions.list_messages(
            session["sub"],
            sessions.normalize_session_id(conversation_id),
            role=ROLE,
            limit=limit,
            cursor=cursor,
        ),
        headers=_NO_STORE,
    )


@router.post("/conversations/{conversation_id}/messages/{message_id}/outcome")
async def record_outcome(
    conversation_id: str,
    message_id: str,
    payload: ActionOutcomeRequest,
    session=Depends(require_teacher_session),
) -> JSONResponse:
    """Record what the teacher did with an action this answer offered.

    Deliberately dumb: it stores a result the browser already produced by
    calling a real, dependency-guarded endpoint. Nothing here writes a goal, a
    note or a kudos — this is the receipt, not the transaction.
    """
    from app.agents import sessions

    stored = await sessions.record_action_outcome(
        session["sub"],
        sessions.normalize_session_id(conversation_id),
        message_id,
        payload.action_id,
        {"status": payload.status, "summary": payload.summary or ""},
        role=ROLE,
    )
    if not stored:
        raise HTTPException(status_code=404, detail="Message not found")
    return JSONResponse(content={"ok": True}, headers=_NO_STORE)


@router.delete("/conversations/{conversation_id}")
async def delete_conversation(
    conversation_id: str, session=Depends(require_teacher_session)
) -> JSONResponse:
    """Soft-delete a thread this teacher owns."""
    from app.agents import sessions

    deleted = await sessions.soft_delete_conversation(
        session["sub"], sessions.normalize_session_id(conversation_id), role=ROLE,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return JSONResponse(content={"ok": True}, headers=_NO_STORE)


# ── persistence ────────────────────────────────────────────────────────────


async def _start_title_task(
    teacher_id: str, conversation_id: str, message: str, language: str,
) -> Optional[asyncio.Task]:
    """Name a thread once, on its first turn, from the teacher's own words."""
    try:
        from app.agents import sessions
        from app.agents.conversation_titles import (
            TEACHER_TITLE_FALLBACK, generate_conversation_title,
        )
        from app.services.ai_usage import UsageContext

        if not await sessions.conversation_needs_title(teacher_id, conversation_id, role=ROLE):
            return None
        basis = await sessions.get_first_user_message(
            teacher_id, conversation_id, role=ROLE
        ) or message
        return asyncio.create_task(generate_conversation_title(
            basis,
            language,
            UsageContext(
                actor_id=teacher_id,
                actor_type="teacher",
                endpoint="/api/teacher/assistant/stream",
                feature="feature_6_teacher_view",
                operation="teacher_assistant.title",
                source="teacher_assistant",
            ),
            fallback=TEACHER_TITLE_FALLBACK,
        ))
    except Exception as exc:      # pragma: no cover — an unnamed thread is fine
        print(f"⚠️ teacher assistant title skipped: {type(exc).__name__}: {exc}")
        return None


async def _resolve_title(
    task: Optional[asyncio.Task], language: str,
) -> tuple[Optional[str], Optional[str]]:
    if task is None:
        return None, None
    try:
        return await task
    except Exception as exc:      # Title generation must never eat the answer.
        print(f"⚠️ teacher assistant title generation failed: {exc}")
        from app.agents.conversation_titles import TEACHER_TITLE_FALLBACK

        return TEACHER_TITLE_FALLBACK.get(language) or TEACHER_TITLE_FALLBACK["he"], "fallback"


async def _persist(
    teacher_id: str,
    message: str,
    result: dict[str, Any],
    *,
    conversation_id: Optional[str] = None,
    language: str = "he",
    title: Optional[str] = None,
    title_source: Optional[str] = None,
) -> None:
    """Keep the transcript. Best-effort: a storage blip never eats the answer."""
    if not result:
        return
    try:
        from app.agents import sessions

        actions = result.get("actions") or []
        await sessions.append_turn(
            teacher_id,
            ROLE,
            message,
            result.get("text") or f"[{result.get('text_key')}]",
            session_id=sessions.normalize_session_id(conversation_id),
            conversation_title=title,
            title_source=title_source,
            # The buttons this answer offered, so a reopened thread shows what
            # was on the table — and, once `outcomes` is stamped, what was taken.
            assistant_meta={"actions": actions} if actions else None,
        )
    except Exception as exc:      # pragma: no cover — persistence is not critical
        print(f"⚠️ teacher assistant transcript skipped: {type(exc).__name__}")
