"""Notification routes. One set, both roles.

The recipient always comes from the session, never from the body. That is the
only thing standing between this and one user reading — or quietly dismissing —
another user's notifications, so it is not a parameter at any point.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import current_user
from app.services import notifications

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

_NO_STORE = {"Cache-Control": "private, no-store"}


async def _recipient(request: Request) -> str:
    """Any signed-in user. The read/unread/dismiss mechanics are identical for
    both roles — only the content differs, and `role` below scopes that."""
    session = await current_user(request)
    return session["sub"]


async def _role(request: Request, role: Optional[str]) -> Optional[str]:
    """Which inbox the caller is asking for, checked against what they actually
    are. One person can hold both roles — `gal` is a learner and a teacher — so
    the portal names the hat and the session decides whether they own it. An
    unknown or unheld role scopes to nothing rather than falling back to
    everything: silently widening the query is how mail leaks between hats.
    """
    if not role:
        return None
    session = await current_user(request)
    roles = set(session.get("roles") or [])
    if role == notifications.ROLE_TEACHER:
        return notifications.ROLE_TEACHER if ({"teacher", "admin"} & roles) else "__none__"
    if role == notifications.ROLE_LEARNER:
        return notifications.ROLE_LEARNER if "learner" in roles else "__none__"
    return "__none__"


def _ids(data: dict) -> list[str]:
    raw = data.get("ids") or data.get("notification_ids") or []
    return [str(value) for value in raw if value][:100]


@router.get("")
async def list_notifications(
    request: Request,
    unread_only: bool = Query(False),
    include_dismissed: bool = Query(False),
    limit: int = Query(30, ge=1, le=100),
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    scope = await _role(request, role)
    rows = await notifications.list_for(
        recipient_id, unread_only=unread_only,
        include_dismissed=include_dismissed, limit=limit, role=scope,
    )
    return JSONResponse(
        content={
            "notifications": rows,
            "unread": await notifications.unread_count(recipient_id, role=scope),
            "role": scope,
        },
        headers=_NO_STORE,
    )


@router.get("/unread-count")
async def read_unread_count(
    request: Request,
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    scope = await _role(request, role)
    return JSONResponse(
        content={"unread": await notifications.unread_count(recipient_id, role=scope)},
        headers=_NO_STORE,
    )


@router.post("/read")
async def mark_read(
    data: dict,
    request: Request,
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    scope = await _role(request, role)
    touched = await notifications.mark_read(recipient_id, _ids(data), role=scope)
    return JSONResponse(
        content={
            "updated": touched,
            "unread": await notifications.unread_count(recipient_id, role=scope),
        },
        headers=_NO_STORE,
    )


@router.post("/read-all")
async def mark_all_read(
    request: Request,
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    scope = await _role(request, role)
    touched = await notifications.mark_all_read(recipient_id, role=scope)
    return JSONResponse(content={"updated": touched, "unread": 0}, headers=_NO_STORE)


@router.post("/dismiss")
async def dismiss(
    data: dict,
    request: Request,
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    """Soft delete: stamps `dismissed_at`. The row survives, and
    `include_dismissed=true` brings it back — nothing a user was told ever
    silently disappears."""
    scope = await _role(request, role)
    touched = await notifications.dismiss(recipient_id, _ids(data), role=scope)
    return JSONResponse(
        content={
            "updated": touched,
            "unread": await notifications.unread_count(recipient_id, role=scope),
        },
        headers=_NO_STORE,
    )


@router.post("/dismiss-all")
async def dismiss_all(
    request: Request,
    role: Optional[str] = Query(None, max_length=16),
    recipient_id: str = Depends(_recipient),
):
    scope = await _role(request, role)
    touched = await notifications.dismiss_all(recipient_id, role=scope)
    return JSONResponse(content={"updated": touched, "unread": 0}, headers=_NO_STORE)
