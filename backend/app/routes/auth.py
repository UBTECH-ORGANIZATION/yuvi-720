"""Login / logout / session + per-user preferences."""

from __future__ import annotations

import os
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
    touch_last_login,
    update_preferences,
)
from app.auth.tokens import TOKEN_LIFETIME, create_session_token
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


@router.post("/login")
async def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
    document = await get_user_by_username(payload.username)
    if document is None:
        # Burn the same CPU as a real verify so response time cannot be used to
        # enumerate usernames.
        burn_timing()
        raise HTTPException(status_code=401, detail="invalid_credentials")
    if not verify_password(payload.password, document.get("password")):
        raise HTTPException(status_code=401, detail="invalid_credentials")

    user = public_user(document)
    token = create_session_token(
        user_id=user["user_id"],
        username=user["username"],
        roles=user["roles"],
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
    return {"authenticated": True, "user": user}


@router.post("/logout")
async def logout(response: Response) -> dict[str, Any]:
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers.update(_NO_STORE)
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
    return {"authenticated": True, "user": user}


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
