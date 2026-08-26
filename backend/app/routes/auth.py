"""Login / logout / session + per-user preferences."""

from __future__ import annotations

import time
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.auth.dependencies import COOKIE_NAME, current_user, optional_user
from app.auth.moe import config as moe_config
from app.auth.passwords import burn_timing, verify_password
from app.auth.repository import (
    ALLOWED_PREFERENCES,
    TOUR_SLUGS,
    get_user_by_id,
    get_user_by_username,
    mark_tours_completed,
    public_user,
    set_current_moe_session,
    touch_last_login,
    update_preferences,
)
from app.auth.session import NO_STORE as _NO_STORE, establish_session
from app.auth.tokens import TOKEN_LIFETIME, create_session_token
from app.services.lrs import reporter as lrs_reporter
from learner_state import update_learner_state  # type: ignore

router = APIRouter(prefix="/api/auth", tags=["auth"])


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
    # Which ministry school the person is currently working in. Same standing as
    # the teacher scope above: remembered for the UI, never trusted for access.
    active_institution: Optional[str] = Field(default=None, max_length=32)


# Preferences whose null is a value rather than an absence. See `patch_preferences`.
CLEARABLE_PREFERENCES = {"teacher_subgroup_id", "teacher_subject"}


@router.post("/login")
async def login(
    payload: LoginRequest, request: Request, response: Response
) -> dict[str, Any]:
    if not moe_config.local_login_enabled():
        # Production signs in through the ministry only. Password login stays
        # for the team's own machines, where the ministry IdP is unreachable.
        raise HTTPException(status_code=403, detail="local_login_disabled")

    document = await get_user_by_username(payload.username)
    if document is None:
        # Burn the same CPU as a real verify so response time cannot be used to
        # enumerate usernames.
        burn_timing()
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_password(payload.password, document.get("password")):
        raise HTTPException(status_code=401, detail="invalid_credentials")

    user = public_user(document)
    await establish_session(request=request, response=response, user=user)
    return {"authenticated": True, "user": user}


@router.post("/logout")
async def logout(response: Response, session=Depends(optional_user)) -> dict[str, Any]:
    ministry_account = bool(session) and session.get("sub", "").startswith("moe_")
    if session and session.get("sid"):
        duration_seconds = max(0.0, time.time() - float(session.get("iat") or time.time()))
        await lrs_reporter.report_session_exit(
            session["sub"], session["sid"], duration_seconds
        )
        await set_current_moe_session(session["sub"], None)
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)
    # Clearing our cookie leaves the ministry SSO session standing, so the next
    # click on the owl would sign the same person straight back in. Guidelines
    # §5.2.ח: send them through the ministry's logout page.
    logout_url = moe_config.logout_url() if ministry_account else ""
    return {"ok": True, "logout_url": logout_url or None}


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
    # Which sign-in methods this deployment offers. The landing page needs it
    # before anyone is authenticated, so it rides the unauthenticated answer too.
    methods = {
        "moe": moe_config.is_enabled(),
        "local": moe_config.local_login_enabled(),
    }
    if session is None:
        return {"authenticated": False, "user": None, "auth_methods": methods}
    document = await get_user_by_id(session["sub"])
    user = public_user(document)
    if user is None:
        # Account removed while a token was still live.
        response.delete_cookie(COOKIE_NAME, path="/")
        return {"authenticated": False, "user": None, "auth_methods": methods}
    # session_id: the MoE LRS sid — the frontend suspend/resume beacon uses it.
    return {
        "authenticated": True,
        "user": user,
        "session_id": session.get("sid"),
        "auth_methods": methods,
    }


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
