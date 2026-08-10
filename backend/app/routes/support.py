"""Fault/issue reporting from inside the app and from the public report page."""

from __future__ import annotations

import re
import time
from collections import deque
from typing import Any, Deque, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.auth.dependencies import current_user
from app.services import support
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


class PublicTicketRequest(TicketRequest):
    contact_email: str = Field(default="", max_length=200)
    reporter_name: str = Field(default="", max_length=120)
    # Hidden honeypot field; real people leave it empty.
    company: str = Field(default="", max_length=200)


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
