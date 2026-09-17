"""Login / logout / session + per-user preferences."""

from __future__ import annotations

import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from pydantic import BaseModel, Field, field_validator

from app.auth.dependencies import COOKIE_NAME, current_user, optional_user
from app.auth.device import application_version, device_from_request
from app.auth.passwords import burn_timing, verify_password
from app.auth.repository import (
    ALLOWED_PREFERENCES,
    TOUR_SLUGS,
    get_user_by_id,
    get_user_by_username,
    mark_tours_completed,
    public_user,
    touch_last_login,
    update_preferences,
)
from app.auth.tokens import TOKEN_LIFETIME, create_session_token
from app.core.env import password_login_allowed
from app.services.lrs import reporter as lrs_reporter
from app.services.lrs import session_registry
from learner_state import update_learner_state  # type: ignore

router = APIRouter(prefix="/api/auth", tags=["auth"])

_NO_STORE = {"Cache-Control": "private, no-store"}


class LoginRequest(BaseModel):
    username: str = Field(max_length=120)
    password: str = Field(max_length=256)


class PreferencesRequest(BaseModel):
    theme: Optional[str] = Field(default=None, pattern="^(light|dark|system)$")
    # Epoch ms of the click that chose `theme`. Sent when the browser promotes a
    # choice made before login, so the newer of (cookie, user document) wins.
    theme_updated_at: Optional[int] = Field(default=None, ge=0)
    language: Optional[str] = Field(default=None, pattern="^(he|en|ar)$")
    reduced_motion: Optional[bool] = None
    # Tours the client has just finished. Sent as a list, applied as a union —
    # see `mark_tours_completed`. Bounded so a crafted PATCH cannot make the
    # server iterate an arbitrarily long body.
    tours_completed: Optional[list[str]] = Field(default=None, max_length=20)
    # Roster view + visible columns. Bounded and pattern-checked for the same
    # reason as the tour list: these round-trip on every /api/auth/me.
    teacher_roster_view: Optional[str] = Field(default=None, pattern="^(table|cards)$")
    teacher_roster_columns: Optional[list[str]] = Field(default=None, max_length=12)
    # The class a teacher is currently looking at. Stored so the choice survives
    # a reload and a new tab; it is a view preference, not an access grant —
    # every teacher endpoint still re-checks the group against org scoping, so a
    # stale or crafted id here buys nothing.
    teacher_group_id: Optional[str] = Field(default=None, max_length=128)
    # The rest of that same scope: which sub-group and which subject the teacher
    # is currently looking through. Same standing as the class — a view
    # preference, re-checked server-side on every request that honours it. A
    # sub-group can be deleted between sessions, so the client must resolve a
    # dangling id to "the whole class" rather than to an empty roster.
    teacher_subgroup_id: Optional[str] = Field(default=None, max_length=128)
    teacher_subject: Optional[str] = Field(default=None, max_length=64)
    # The stretch of time the dashboard is read over. Pattern-checked against
    # the exact four the client offers rather than left open: this decides the
    # window every one of that screen's numbers is computed over, so an
    # arbitrary string here would reach the analytics layer as a day count.
    teacher_period: Optional[str] = Field(default=None, pattern="^(day|3day|week|month)$")
    # The class-book unwrap ledger: {group_id: "YYYY-MM-DD", the day of that
    # edition}. The client sends the full merged map. Bounded and shape-checked
    # because preferences round-trip on every /api/auth/me.
    teacher_book_seen: Optional[dict[str, str]] = None

    @field_validator("teacher_book_seen")
    @classmethod
    def _bounded_book_seen(cls, value: Optional[dict[str, str]]) -> Optional[dict[str, str]]:
        if value is None:
            return None
        if len(value) > 50:
            raise ValueError("too_many_groups")
        for group_id, week in value.items():
            if not group_id or len(group_id) > 128:
                raise ValueError("bad_group_id")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", week):
                raise ValueError("bad_week")
        return value


# Preferences whose null is a value rather than an absence. See `patch_preferences`.
CLEARABLE_PREFERENCES = {"teacher_subgroup_id", "teacher_subject"}


def _cookie_is_secure() -> bool:
    public_url = os.environ.get("PUBLIC_APP_URL") or os.environ.get("FRONTEND_URL") or ""
    return public_url.startswith("https://")


async def _moe_logout_url(user_id: Optional[str]) -> Optional[str]:
    """Where to send the browser after a Ministry-provisioned account logs out.

    Password accounts get `None` and stay on our own landing page.
    """
    if not user_id:
        return None
    from app.auth.moe import client as moe_client
    from app.auth.moe import config as moe_config

    if not moe_config.is_enabled():
        return None
    document = await get_user_by_id(user_id)
    if not document or document.get("identity_provider") != "moe":
        return None
    try:
        return await moe_client.build_end_session_url(None)
    except Exception as exc:
        print(f"⚠️ MoE logout URL unavailable: {type(exc).__name__}")
        return None


# Kept under their former names: tests and the OIDC callback import them here.
_device_from_request = device_from_request


@router.post("/login")
async def login(
    payload: LoginRequest, request: Request, response: Response
) -> dict[str, Any]:
    if not password_login_allowed():
        # In the cloud the Ministry's OIDC provider is the only way in. A 404
        # rather than a 403 so the endpoint does not even advertise that a
        # password path exists somewhere — and it fires before any lookup, so a
        # seeded or leaked password is never even compared against real data.
        raise HTTPException(status_code=404, detail="not_found")

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
    # The registry closes any session this user still had open (a re-login
    # ends the previous visit), records the new one and reports `enter`.
    await session_registry.open(
        user["user_id"], moe_session_id,
        roles=user["roles"], device=device_from_request(request),
    )
    return {"authenticated": True, "user": user}


@router.post("/logout")
async def logout(response: Response, session=Depends(optional_user)) -> dict[str, Any]:
    redirect_url: Optional[str] = None
    if session and session.get("sid"):
        # The registry files the one `exit` (gross duration from its recorded
        # start); a cookie minted before the registry existed is measured
        # from the token's own start instead.
        await session_registry.close(
            session["sid"],
            reason="logout",
            user_id=session["sub"],
            fallback_started_at=datetime.fromtimestamp(
                float(session.get("iat") or time.time()), tz=timezone.utc
            ),
        )
    if session:
        # Dropping our cookie alone would leave the Ministry session alive, so
        # the next "log in" would silently sign the same child straight back in
        # — on a shared classroom machine that is the wrong child.
        redirect_url = await _moe_logout_url(session.get("sub"))
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)
    return {"ok": True, "redirect_url": redirect_url}


@router.post("/session/suspend")
async def session_suspend(session=Depends(optional_user)) -> dict[str, Any]:
    """MoE 720 session `suspend` — the tab lost focus (frontend beacon)."""
    if session and session.get("sid"):
        # Reported on the transition only: a second beacon for the same pause
        # (visibilitychange + pagehide, two tabs) is not a second suspend.
        if await session_registry.suspend(session["sid"]):
            await lrs_reporter.report_session_suspend(session["sub"], session["sid"])
    return {"ok": True}


@router.post("/session/resume")
async def session_resume(response: Response, session=Depends(optional_user)) -> dict[str, Any]:
    """MoE 720 session `resume` — the tab regained focus (frontend beacon).

    A tab that comes back after the idle window returns to a session that has
    already exited: the auth dependency reopened a new one (with its own
    `enter`), so no `resume` is filed for it — and the cookie is re-minted to
    carry the new id.
    """
    if session and session.get("sid"):
        if _session_moved(session):
            _reissue_cookie(response, session)
        elif await session_registry.resume(session["sid"]):
            # Only a suspended session resumes — never a resume without its suspend.
            await lrs_reporter.report_session_resume(session["sub"], session["sid"])
    return {"ok": True}


@router.post("/session/ping")
async def session_ping(response: Response, session=Depends(current_user)) -> dict[str, Any]:
    """A sign of life from an open tab (every few minutes while visible), so
    the idle sweeper can tell a closed browser from a quiet one."""
    if session.get("sid"):
        await session_registry.touch(session["sid"], force=True)
        if _session_moved(session):
            _reissue_cookie(response, session)
    response.headers.update(_NO_STORE)
    return {"ok": True, "session_id": session.get("sid")}


def _session_moved(session: dict[str, Any]) -> bool:
    """True when the auth dependency resolved this cookie to a newer session."""
    jwt_sid = session.get("jwt_sid")
    return bool(jwt_sid and session.get("sid") and jwt_sid != session["sid"])


def _reissue_cookie(response: Response, session: dict[str, Any]) -> None:
    """Re-mint the cookie so it carries the session the LRS is now told about."""
    token = create_session_token(
        user_id=session["sub"],
        username=str(session.get("username") or ""),
        roles=list(session.get("roles") or []),
        session_id=session["sid"],
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
    if _session_moved(session):
        _reissue_cookie(response, session)
    # session_id: the MoE LRS sid — the frontend suspend/resume beacon uses it.
    return {"authenticated": True, "user": user, "session_id": session.get("sid")}


@router.patch("/preferences")
async def patch_preferences(
    payload: PreferencesRequest,
    response: Response,
    session=Depends(current_user),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    # `exclude_none` is the rule for everything here: a preference is a
    # value-or-default, and a client sending an absent field as an explicit null
    # means "no opinion", not "erase the theme".
    #
    # Scope is the exception, because for scope null IS a value — "the whole
    # class", "every subject" — and it is the value a teacher reaches for most:
    # clearing a filter, switching class, or the client resolving a sub-group
    # that has since been deleted. Without this, the ✕ on a scope chip cleared
    # the screen and not the document, so the filter came back on the next load.
    sent = payload.model_fields_set
    updates = {
        key: value
        for key, value in payload.model_dump().items()
        if key in ALLOWED_PREFERENCES
        and (value is not None or (key in CLEARABLE_PREFERENCES and key in sent))
    }
    # A stamp on its own means nothing — it only dates a theme choice.
    if "theme" not in updates:
        updates.pop("theme_updated_at", None)

    # Tours are append-only and slug-validated, so they leave the generic `$set`
    # lane entirely. An unknown slug is a hard 400 rather than a silent drop: a
    # client that thinks it recorded a tour and did not would re-open it forever.
    tours = updates.pop("tours_completed", None)
    if tours is not None:
        unknown = sorted({slug for slug in tours if slug not in TOUR_SLUGS})
        if unknown:
            raise HTTPException(status_code=400, detail=f"unknown_tour:{unknown[0]}")

    if not updates and tours is None:
        raise HTTPException(status_code=400, detail="no_supported_preferences")

    preferences: dict[str, Any] = {}
    if updates:
        preferences = await update_preferences(session["sub"], updates)
    if tours is not None:
        # Last, and it returns the full set — so a tour-only PATCH costs one
        # write and no read at all.
        preferences = await mark_tours_completed(session["sub"], tours)
    if "language" in updates:
        # Mirror into learner_state so the existing I18nProvider path keeps
        # resolving the same value.
        await update_learner_state(session["sub"], {"language": updates["language"]})
    return {"preferences": preferences}
