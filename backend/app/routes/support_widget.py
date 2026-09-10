"""Server-to-server bridge between Spark and the standalone support service.

Spark never mints support tokens itself: it proves who the caller is with the normal
session cookie, then asks the support service for a short-lived widget token using a
shared service key. Token lifetime, revocation and the whole support data store stay
owned by the support service, so nothing about a support conversation lands in the
learning database.

Only a pseudonymous user reference is forwarded - never a name, username or e-mail.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import current_user

router = APIRouter(prefix="/api/support/widget", tags=["support-widget"])

_TIMEOUT = httpx.Timeout(6.0, connect=3.0)


def _service_base_url() -> str:
    return (os.environ.get("SUPPORT_SERVICE_BASE_URL") or "").rstrip("/")


def _service_key() -> str:
    return os.environ.get("SUPPORT_SERVICE_KEY") or ""


def _socket_url(base_url: str, ws_path: str) -> str:
    """Turn the support service base URL into the browser-facing socket URL."""

    override = (os.environ.get("SUPPORT_SERVICE_WS_URL") or "").rstrip("/")
    if override:
        return f"{override}{ws_path}"
    if base_url.startswith("https://"):
        return f"wss://{base_url[len('https://'):]}{ws_path}"
    if base_url.startswith("http://"):
        return f"ws://{base_url[len('http://'):]}{ws_path}"
    return f"{base_url}{ws_path}"


def _role_of(actor: dict[str, Any]) -> str:
    roles = actor.get("roles") or []
    return "teacher" if "teacher" in roles else "student"


@router.get("/config")
async def widget_config() -> dict[str, Any]:
    """Lets the client hide the help button entirely when support is not deployed."""

    return {"enabled": bool(_service_base_url() and _service_key())}


@router.post("/session", status_code=201)
async def open_session(actor: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    base_url = _service_base_url()
    if not base_url or not _service_key():
        raise HTTPException(status_code=503, detail="support_unavailable")

    user_ref = actor.get("sub")
    if not user_ref:
        raise HTTPException(status_code=401, detail="unauthenticated")

    payload = {
        "user_ref": str(user_ref),
        "user_role": _role_of(actor),
        "org_ref": actor.get("org_id") or actor.get("school_id"),
    }

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                f"{base_url}/internal/widget-token",
                headers={"x-support-service-key": _service_key()},
                json=payload,
            )
    except httpx.HTTPError as error:  # network hiccup, support host down
        raise HTTPException(status_code=503, detail="support_unavailable") from error

    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="support_unavailable")

    body = response.json()
    return {
        "token": body["token"],
        "session_id": body["session_id"],
        "ticket_id": body["ticket_id"],
        "expires_in": body["expires_in"],
        "socket_url": _socket_url(base_url, body.get("ws_path") or "/ws/widget"),
    }
