"""FastAPI guards that derive identity from the session cookie.

The identity NEVER comes from the request body or query string. That is the
whole point of this module: before it existed, every route accepted a
client-supplied `learner_id` and silently fell back to `demo-learner`.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException, Request

from app.auth.tokens import decode_session_token
from app.brain import org

COOKIE_NAME = "spark_session"

ROLE_LEARNER = "learner"
ROLE_TEACHER = "teacher"
ROLE_ADMIN = "admin"


def _session_from_request(request: Request) -> Optional[dict[str, Any]]:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    return decode_session_token(token)


async def optional_user(request: Request) -> Optional[dict[str, Any]]:
    """Session payload, or None when unauthenticated. Never raises."""
    return _session_from_request(request)


async def current_user(request: Request) -> dict[str, Any]:
    session = _session_from_request(request)
    if session is None:
        raise HTTPException(status_code=401, detail="authentication_required")
    return session


async def require_learner(request: Request) -> str:
    """Return the session learner id, 403 if the account lacks the learner role."""
    session = await current_user(request)
    if ROLE_LEARNER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="learner_role_required")
    return session["sub"]


async def require_learner_session(request: Request) -> dict[str, Any]:
    """Like `require_learner`, but returns the full session payload — for
    routes that also need the MoE LRS `sid` claim for outbound reporting."""
    session = await current_user(request)
    if ROLE_LEARNER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="learner_role_required")
    return session


async def require_teacher(request: Request) -> str:
    """Return the session teacher id, 403 if the account lacks the teacher role."""
    session = await current_user(request)
    if ROLE_TEACHER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="teacher_role_required")
    return session["sub"]


async def require_teacher_session(request: Request) -> dict[str, Any]:
    """Like `require_teacher`, but returns the full session payload (incl. the
    MoE LRS `sid`) for routes that report outbound 720 events."""
    session = await current_user(request)
    if ROLE_TEACHER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="teacher_role_required")
    return session


async def require_admin(request: Request) -> str:
    """Return the session user id for an administrator.

    Two gates, deliberately. The JWT role is the cheap route gate; `org.is_admin`
    re-checks the `org_admins` grant in the database, so a revoked admin loses
    access on the very next request even though their 12-hour token still says
    `admin` (see `app/auth/tokens.py`).
    """
    session = await current_user(request)
    user_id = session["sub"]
    if ROLE_ADMIN not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="admin_role_required")
    if not await org.is_admin(user_id):
        raise HTTPException(status_code=403, detail="admin_grant_required")
    return user_id


async def require_admin_session(request: Request) -> dict[str, Any]:
    """Like `require_admin`, but returns the full session payload."""
    await require_admin(request)
    return await current_user(request)


async def assert_can_read_learner(actor: dict[str, Any], learner_id: str) -> None:
    """Allow self-reads, plus teachers scoped to their own groups.

    Composes the existing org scoping (`app.brain.org`) rather than inventing a
    second permission model. Async because scope is read from the database per
    request, never from the session token — revocation must land immediately.
    """
    actor_id = actor.get("sub")
    if actor_id == learner_id:
        return
    roles = actor.get("roles") or []
    if ROLE_TEACHER in roles and await org.teacher_can_access_learner(actor_id, learner_id):
        return
    if ROLE_ADMIN in roles and await org.is_admin(actor_id):
        return
    raise HTTPException(status_code=403, detail="forbidden")
