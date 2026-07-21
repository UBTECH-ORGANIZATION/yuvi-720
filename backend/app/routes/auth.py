"""Login / logout / session + per-user preferences."""

from __future__ import annotations

import os
import time
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.auth.dependencies import COOKIE_NAME, current_user, optional_user
from app.auth.passwords import burn_timing, verify_password
from app.auth.repository import (
    ALLOWED_PREFERENCES,
    get_user_by_id,
    get_user_by_username,
    public_user,
    set_current_moe_session,
    touch_last_login,
    update_preferences,
)
from app.auth.tokens import TOKEN_LIFETIME, create_session_token
from app.services.lrs import reporter as lrs_reporter
from learner_state import update_learner_state  # type: ignore

router = APIRouter(prefix="/api/auth", tags=["auth"])

_NO_STORE = {"Cache-Control": "private, no-store"}


class LoginRequest(BaseModel):
    username: str = Field(max_length=120)
    password: str = Field(max_length=256)


class PreferencesRequest(BaseModel):
    theme: Optional[str] = Field(default=None, pattern="^(light|dark|system)$")
    language: Optional[str] = Field(default=None, pattern="^(he|en|ar)$")
    reduced_motion: Optional[bool] = None


def _cookie_is_secure() -> bool:
    public_url = os.environ.get("PUBLIC_APP_URL") or os.environ.get("FRONTEND_URL") or ""
    return public_url.startswith("https://")


def _device_from_request(request: Request) -> dict[str, str]:
    """Best-effort device extensions for the MoE session `enter` statement."""
    ua = request.headers.get("user-agent", "")
    lowered = ua.lower()
    if "ipad" in lowered or "tablet" in lowered:
        device_type = "Tablet"
    elif "mobile" in lowered or "iphone" in lowered or "android" in lowered:
        device_type = "Mobile"
    else:
        device_type = "Desktop"
    if "windows" in lowered:
        operating_system = "Windows"
    elif "mac os" in lowered or "macintosh" in lowered:
        operating_system = "macOS"
    elif "android" in lowered:
        operating_system = "Android"
    elif "iphone" in lowered or "ipad" in lowered or "ios" in lowered:
        operating_system = "iOS"
    elif "linux" in lowered:
        operating_system = "Linux"
    else:
        operating_system = "Other"
    if "edg/" in lowered:
        browser = "Edge"
    elif "chrome/" in lowered:
        browser = "Chrome"
    elif "firefox/" in lowered:
        browser = "Firefox"
    elif "safari/" in lowered:
        browser = "Safari"
    else:
        browser = "Other"
    return {
        "deviceType": device_type,
        "platform": "Web",
        "operatingSystem": operating_system,
        "browser": browser,
    }


@router.post("/login")
async def login(
    payload: LoginRequest, request: Request, response: Response
) -> dict[str, Any]:
    document = await get_user_by_username(payload.username)
    if document is None:
        # Burn the same CPU as a real verify so response time cannot be used to
        # enumerate usernames.
        burn_timing()
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_password(payload.password, document.get("password")):
        raise HTTPException(status_code=401, detail="invalid_credentials")

    user = public_user(document)
    # MoE LRS session: one visit, minted here, carried by every outbound 720
    # statement of this visit; `exit` (logout) reports the gross duration.
    moe_session_id = str(uuid.uuid4())
    token = create_session_token(
        user_id=user["user_id"],
        username=user["username"],
        roles=user["roles"],
        session_id=moe_session_id,
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=_cookie_is_secure(),
        max_age=int(TOKEN_LIFETIME.total_seconds()),
        path="/",
    )
    response.headers.update(_NO_STORE)
    await touch_last_login(user["user_id"])
    await set_current_moe_session(user["user_id"], moe_session_id)
    await lrs_reporter.report_session_enter(
        user["user_id"], moe_session_id, _device_from_request(request)
    )
    return {"authenticated": True, "user": user}


@router.post("/logout")
async def logout(response: Response, session=Depends(optional_user)) -> dict[str, Any]:
    if session and session.get("sid"):
        duration_seconds = max(0.0, time.time() - float(session.get("iat") or time.time()))
        await lrs_reporter.report_session_exit(
            session["sub"], session["sid"], duration_seconds
        )
        await set_current_moe_session(session["sub"], None)
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)
    return {"ok": True}


@router.post("/session/suspend")
async def session_suspend(session=Depends(optional_user)) -> dict[str, Any]:
    """MoE 720 session `suspend` — the tab lost focus (frontend beacon)."""
    if session and session.get("sid"):
        await lrs_reporter.report_session_suspend(session["sub"], session["sid"])
    return {"ok": True}


@router.post("/session/resume")
async def session_resume(session=Depends(optional_user)) -> dict[str, Any]:
    """MoE 720 session `resume` — the tab regained focus (frontend beacon)."""
    if session and session.get("sid"):
        await lrs_reporter.report_session_resume(session["sub"], session["sid"])
    return {"ok": True}


@router.get("/me")
async def me(response: Response, session=Depends(optional_user)) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    if session is None:
        return {"authenticated": False, "user": None}
    document = await get_user_by_id(session["sub"])
    user = public_user(document)
    if user is None:
        # Account removed while a token was still live.
        response.delete_cookie(COOKIE_NAME, path="/")
        return {"authenticated": False, "user": None}
    # session_id: the MoE LRS sid — the frontend suspend/resume beacon uses it.
    return {"authenticated": True, "user": user, "session_id": session.get("sid")}


@router.patch("/preferences")
async def patch_preferences(
    payload: PreferencesRequest,
    response: Response,
    session=Depends(current_user),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    updates = {
        key: value
        for key, value in payload.model_dump(exclude_none=True).items()
        if key in ALLOWED_PREFERENCES
    }
    if not updates:
        raise HTTPException(status_code=400, detail="no_supported_preferences")

    preferences = await update_preferences(session["sub"], updates)
    if "language" in updates:
        # Mirror into learner_state so the existing I18nProvider path keeps
        # resolving the same value.
        await update_learner_state(session["sub"], {"language": updates["language"]})
    return {"preferences": preferences}
