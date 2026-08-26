"""Establishing a signed-in session, independent of how the person proved who
they are.

Password login and ministry (הזדהות אחידה) login must produce byte-identical
sessions — same cookie, same claims, same MoE `sid`, same LRS `enter`. Keeping
that in one place is what stops the two paths from drifting, which is how a
second login route usually ends up silently not reporting to the LRS.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

from fastapi import Request, Response

from app.auth.dependencies import COOKIE_NAME
from app.auth.repository import set_current_moe_session, touch_last_login
from app.auth.tokens import TOKEN_LIFETIME, create_session_token

NO_STORE = {"Cache-Control": "private, no-store"}


def cookie_is_secure() -> bool:
    public_url = os.environ.get("PUBLIC_APP_URL") or os.environ.get("FRONTEND_URL") or ""
    return public_url.startswith("https://")


def device_from_request(request: Request) -> dict[str, str]:
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


async def establish_session(
    *, request: Request, response: Response, user: dict[str, Any]
) -> str:
    """Mint the session cookie and open the MoE reporting session.

    Returns the MoE LRS `sessionId` — one visit, carried by every outbound 720
    statement until `exit` reports its duration at logout.
    """
    from app.services.lrs import reporter as lrs_reporter

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
        secure=cookie_is_secure(),
        max_age=int(TOKEN_LIFETIME.total_seconds()),
        path="/",
    )
    response.headers.update(NO_STORE)
    await touch_last_login(user["user_id"])
    await set_current_moe_session(user["user_id"], moe_session_id)
    await lrs_reporter.report_session_enter(
        user["user_id"], moe_session_id, device_from_request(request)
    )
    return moe_session_id
