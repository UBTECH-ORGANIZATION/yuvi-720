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


async def require_teacher(request: Request) -> str:
    """Return the session teacher id, 403 if the account lacks the teacher role."""
    session = await current_user(request)
    if ROLE_TEACHER not in (session.get("roles") or []):
        raise HTTPException(status_code=403, detail="teacher_role_required")
    return session["sub"]


def assert_can_read_learner(actor: dict[str, Any], learner_id: str) -> None:
    """Allow self-reads, plus teachers scoped to their own groups.

    Composes the existing org scoping (`app.brain.org`) rather than inventing a
    second permission model.
    """
    actor_id = actor.get("sub")
    if actor_id == learner_id:
        return
    roles = actor.get("roles") or []
    if ROLE_TEACHER in roles and org.teacher_can_access_learner(actor_id, learner_id):
        return
    raise HTTPException(status_code=403, detail="forbidden")
