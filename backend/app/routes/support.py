"""Fault/issue reporting from inside the app and from the public report page."""

from __future__ import annotations

import re
import time
from collections import deque
from typing import Any, Deque, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Query,
    Request,
    Response,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import COOKIE_NAME, require_teacher_session, current_user
from app.auth.tokens import decode_session_token
from app.services import support, support_hub, support_media, support_notify
from learner_state import normalize_learner_id  # type: ignore

router = APIRouter(prefix="/api/support", tags=["support"])

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NO_STORE = {"Cache-Control": "private, no-store"}

_PUBLIC_WINDOW_SECONDS = 600
_PUBLIC_MAX_PER_WINDOW = 5
_public_hits: dict[str, Deque[float]] = {}


class ReportContext(BaseModel):
    model_config = ConfigDict(extra="ignore")

    route: str = Field(default="", max_length=300)
    user_agent: str = Field(default="", max_length=300)
    viewport: str = Field(default="", max_length=40)
    language: str = Field(default="", max_length=10)
    theme: str = Field(default="", max_length=20)
    app_version: str = Field(default="", max_length=40)
    occurred_at: str = Field(default="", max_length=40)


class TicketRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=4000)
    category: str = Field(default=support.DEFAULT_TICKET_CATEGORY, max_length=40)
    severity: str = Field(default=support.DEFAULT_TICKET_SEVERITY, max_length=40)
    context: Optional[ReportContext] = None
    attachments: list[str] = Field(default_factory=list, max_length=support_media.MAX_PER_TICKET)


class PublicTicketRequest(TicketRequest):
    contact_email: str = Field(default="", max_length=200)
    reporter_name: str = Field(default="", max_length=120)
    # Hidden honeypot field; real people leave it empty.
    company: str = Field(default="", max_length=200)


class ConversationRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    subject: str = Field(default="", max_length=160)
    message: str = Field(default="", max_length=support.MAX_MESSAGE_LENGTH)
    linked_ticket_id: Optional[str] = Field(default=None, max_length=40)


class MessageRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    body: str = Field(min_length=1, max_length=support.MAX_MESSAGE_LENGTH)


def _client_key(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "unknown")


def _public_rate_limited(key: str) -> bool:
    now = time.monotonic()
    hits = _public_hits.setdefault(key, deque())
    while hits and now - hits[0] > _PUBLIC_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= _PUBLIC_MAX_PER_WINDOW:
        return True
    hits.append(now)
    if len(_public_hits) > 2000:
        _public_hits.clear()
    return False


def _context_dict(context: Optional[ReportContext]) -> dict[str, Any]:
    return context.model_dump() if context is not None else {}


def _owned_attachments(names: list[str], owner_id: str) -> list[str]:
    """Keep only well-formed blob names this reporter actually uploaded."""
    return [
        name for name in names[: support_media.MAX_PER_TICKET]
        if support_media.is_safe_blob_name(name) and support_media.owner_of(name) == owner_id
    ]


@router.post("/tickets", status_code=201)
async def submit_ticket(data: TicketRequest, actor: dict = Depends(current_user)):
    """File a fault report on behalf of the signed-in learner or teacher."""
    roles = actor.get("roles") or []
    # The reporter type is derived from the session, never from the request body.
    reporter_type = "teacher" if "teacher" in roles else "learner"
    reporter_id = normalize_learner_id(actor.get("sub"))
    document = support.build_ticket_document(
        source="in_app",
        reporter_type=reporter_type,
        reporter_id=reporter_id,
        reporter_name=str(actor.get("username") or "") if reporter_type == "teacher" else "",
        contact_email="",
        category=data.category,
        severity=data.severity,
        title=data.title.strip(),
        description=data.description.strip(),
        context=_context_dict(data.context),
        attachments=_owned_attachments(data.attachments, reporter_id),
    )
    ticket_id = await support.create_ticket(document)
    if ticket_id is None:
        return JSONResponse(
            content={"error": "support_unavailable"}, status_code=503, headers=_NO_STORE
        )
    return JSONResponse(
        content={"ticket": support.ticket_payload(document)}, status_code=201, headers=_NO_STORE
    )


@router.get("/tickets/mine")
async def my_tickets(actor: dict = Depends(current_user)):
    """Return the caller's own reports so they can follow the handling status."""
    reporter_id = normalize_learner_id(actor.get("sub"))
    tickets = await support.list_tickets_for_reporter(reporter_id)
    return JSONResponse(content={"tickets": tickets}, headers=_NO_STORE)


@router.post("/attachments", status_code=201)
async def upload_attachment(
    file: UploadFile = File(...), actor: dict = Depends(current_user)
):
    """Store one screenshot in the private container and return its blob name."""
    owner_id = normalize_learner_id(actor.get("sub"))
    data = await file.read(support_media.MAX_BYTES + 1)
    try:
        result = await support_media.upload(owner_id, data)
    except support_media.AttachmentError as exc:
        code = str(exc)
        status = 503 if code == "attachments_unavailable" else 422
        return JSONResponse(content={"error": code}, status_code=status, headers=_NO_STORE)
    return JSONResponse(content=result, status_code=201, headers=_NO_STORE)


@router.get("/attachments/{owner}/{name}")
async def read_attachment(owner: str, name: str, actor: dict = Depends(current_user)):
    """Serve an attachment to its uploader only; administrators use their own console."""
    blob_name = f"{owner}/{name}"
    if not support_media.is_safe_blob_name(blob_name):
        return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)
    if support_media.owner_of(blob_name) != normalize_learner_id(actor.get("sub")):
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    result = await support_media.download(blob_name)
    if result is None:
        return JSONResponse(content={"error": "not_found"}, status_code=404, headers=_NO_STORE)
    data, content_type = result
    return Response(
        content=data,
        media_type=content_type,
        headers={
            **_NO_STORE,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": f'attachment; filename="{name}"',
        },
    )


@router.post("/public/tickets", status_code=201)
async def submit_public_ticket(data: PublicTicketRequest, request: Request):
    """Accept a fault report from someone who is not signed in."""
    if data.company.strip():
        # Bot filled the honeypot: accept silently without storing anything.
        return JSONResponse(content={"ok": True}, status_code=201, headers=_NO_STORE)

    if _public_rate_limited(_client_key(request)):
        return JSONResponse(
            content={"error": "too_many_reports"}, status_code=429, headers=_NO_STORE
        )

    email = data.contact_email.strip()
    if email and not EMAIL_PATTERN.match(email):
        return JSONResponse(
            content={"error": "invalid_email"}, status_code=422, headers=_NO_STORE
        )

    document = support.build_ticket_document(
        source="public",
        reporter_type="guest",
        reporter_id=None,
        reporter_name=data.reporter_name.strip(),
        contact_email=email,
        category=data.category,
        severity=data.severity,
        title=data.title.strip(),
        description=data.description.strip(),
        context=_context_dict(data.context),
    )
    ticket_id = await support.create_ticket(document)
    if ticket_id is None:
        return JSONResponse(
            content={"error": "support_unavailable"}, status_code=503, headers=_NO_STORE
        )
    return JSONResponse(content={"ok": True}, status_code=201, headers=_NO_STORE)


# --- teacher support chat ----------------------------------------------------
# Human support, teachers only. A learner never reaches these endpoints.


async def _owned_conversation(conversation_id: str, teacher_id: str) -> Optional[dict[str, Any]]:
    return await support.get_conversation(conversation_id, teacher_id=teacher_id)


async def _announce(conversation_id: str, teacher_id: str, kind: str) -> None:
    """Push to local teacher sockets and tell the admin service to do the same."""
    event = {"type": kind, "conversation_id": conversation_id, "teacher_id": teacher_id}
    await support_hub.broadcast(support_hub.teacher_room(teacher_id), event)
    support_notify.notify_peer(event)


@router.get("/conversations")
async def teacher_conversations(
    session: dict = Depends(require_teacher_session),
    limit: int = Query(default=20, ge=1, le=support.MAX_CONVERSATION_PAGE),
    cursor: Optional[str] = Query(default=None, max_length=400),
):
    result = await support.list_conversations(
        teacher_id=str(session.get("sub")), limit=limit, cursor=cursor
    )
    return JSONResponse(content=result, headers=_NO_STORE)


@router.post("/conversations", status_code=201)
async def open_conversation(
    data: ConversationRequest, session: dict = Depends(require_teacher_session)
):
    teacher_id = str(session.get("sub"))
    conversation = await support.create_conversation(
        teacher_id,
        teacher_name=str(session.get("username") or ""),
        subject=data.subject.strip(),
        linked_ticket_id=data.linked_ticket_id,
    )
    if data.message.strip():
        await support.append_message(
            conversation["id"],
            author_role="teacher",
            author_id=teacher_id,
            author_name=str(session.get("username") or ""),
            body=data.message,
        )
    await _announce(conversation["id"], teacher_id, "conversation.created")
    return JSONResponse(
        content={"conversation": conversation}, status_code=201, headers=_NO_STORE
    )


@router.get("/conversations/{conversation_id}/messages")
async def teacher_messages(
    conversation_id: str,
    session: dict = Depends(require_teacher_session),
    limit: int = Query(default=50, ge=1, le=support.MAX_CONVERSATION_PAGE),
    cursor: Optional[str] = Query(default=None, max_length=400),
):
    teacher_id = str(session.get("sub"))
    if await _owned_conversation(conversation_id, teacher_id) is None:
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    result = await support.list_messages(conversation_id, limit=limit, cursor=cursor)
    await support.mark_read(conversation_id, reader_role="teacher")
    return JSONResponse(content=result, headers=_NO_STORE)


@router.post("/conversations/{conversation_id}/messages", status_code=201)
async def teacher_reply(
    conversation_id: str,
    data: MessageRequest,
    session: dict = Depends(require_teacher_session),
):
    teacher_id = str(session.get("sub"))
    if await _owned_conversation(conversation_id, teacher_id) is None:
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    message = await support.append_message(
        conversation_id,
        author_role="teacher",
        author_id=teacher_id,
        author_name=str(session.get("username") or ""),
        body=data.body,
    )
    if message is None:
        return JSONResponse(
            content={"error": "support_unavailable"}, status_code=503, headers=_NO_STORE
        )
    await _announce(conversation_id, teacher_id, "message.created")
    return JSONResponse(content={"message": message}, status_code=201, headers=_NO_STORE)


@router.post("/conversations/{conversation_id}/read", status_code=204)
async def teacher_mark_read(
    conversation_id: str, session: dict = Depends(require_teacher_session)
):
    teacher_id = str(session.get("sub"))
    if await _owned_conversation(conversation_id, teacher_id) is None:
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    await support.mark_read(conversation_id, reader_role="teacher")
    return Response(status_code=204, headers=_NO_STORE)


@router.websocket("/ws")
async def teacher_socket(websocket: WebSocket):
    """Live thread updates for one teacher. Identity comes from the session cookie."""
    session = decode_session_token(websocket.cookies.get(COOKIE_NAME) or "")
    if session is None or "teacher" not in (session.get("roles") or []):
        await websocket.close(code=4401)
        return
    room = support_hub.teacher_room(str(session.get("sub")))
    await websocket.accept()
    await support_hub.join(room, websocket)
    try:
        while True:
            # The client never sends commands; this only detects a closed socket.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except RuntimeError:
        pass
    finally:
        await support_hub.leave(room, websocket)


internal_router = APIRouter(prefix="/internal/support", tags=["support-internal"])


class NotifyEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = Field(max_length=60)
    conversation_id: str = Field(max_length=60)
    teacher_id: str = Field(default="", max_length=120)


@internal_router.post("/notify", status_code=204)
async def receive_peer_notify(event: NotifyEvent, request: Request):
    """Relay an admin-side event to this service's teacher sockets."""
    if not support_notify.token_matches(request.headers.get("X-Support-Token")):
        return JSONResponse(content={"error": "forbidden"}, status_code=403, headers=_NO_STORE)
    # The payload is only a pointer; the client refetches the thread over HTTP.
    conversation = await support.get_conversation(event.conversation_id)
    if conversation is None:
        return Response(status_code=204, headers=_NO_STORE)
    teacher_id = str(conversation.get("teacher_id") or "")
    if teacher_id:
        await support_hub.broadcast(
            support_hub.teacher_room(teacher_id),
            {"type": event.type, "conversation_id": event.conversation_id},
        )
    return Response(status_code=204, headers=_NO_STORE)
