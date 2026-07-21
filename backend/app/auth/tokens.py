"""Signed session tokens for the learner/teacher app.

Structurally mirrors `admin/backend/auth.py` (HS256 JWT in an httpOnly cookie)
but is a distinct issuer/audience/cookie so the two apps never cross-accept.

Roles are embedded in the token, so a role change only takes effect on the next
login. Same tradeoff the admin app makes; acceptable for a small account set.

The signing secret is the app-wide `SECRET_KEY`, shared with the xAPI launch
tokens in `app.services.events`. Rotating it invalidates both.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt

_ALGORITHM = "HS256"
_ISSUER = "yuvilab-spark"
_AUDIENCE = "yuvilab-spark-ui"
TOKEN_LIFETIME = timedelta(hours=12)

_DEV_SECRET = "yuvi720-dev-secret"


def _secret() -> str:
    secret = os.environ.get("SECRET_KEY")
    if secret:
        return secret
    if (os.environ.get("ENVIRONMENT") or "").lower() in {"production", "prod"}:
        raise RuntimeError("SECRET_KEY must be set in production")
    return _DEV_SECRET


def create_session_token(
    *, user_id: str, username: str, roles: list[str], session_id: Optional[str] = None
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "username": username,
        "roles": list(roles),
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": now,
        "exp": now + TOKEN_LIFETIME,
    }
    if session_id:
        # MoE LRS sessionId — one visit, minted at login; every outbound 720
        # statement of this visit carries it, and exit reports the duration.
        payload["sid"] = session_id
    return jwt.encode(payload, _secret(), algorithm=_ALGORITHM)


def decode_session_token(token: str) -> Optional[dict[str, Any]]:
    try:
        payload = jwt.decode(
            token,
            _secret(),
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            audience=_AUDIENCE,
        )
    except jwt.PyJWTError:
        return None
    if not isinstance(payload.get("sub"), str) or not payload["sub"]:
        return None
    if not isinstance(payload.get("roles"), list):
        return None
    return payload
