"""Administrator allowlist and signed-cookie helpers."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import jwt

from .config import Settings


_ALGORITHM = "HS256"
_ISSUER = "yuvilab-spark-admin"
_AUDIENCE = "yuvilab-spark-admin-ui"
_TOKEN_LIFETIME = timedelta(hours=12)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_allowed_admin(email: str, settings: Settings) -> bool:
    return bool(settings.admin_emails) and normalize_email(email) in settings.admin_emails


def create_admin_token(
    *,
    email: str,
    name: str,
    settings: Settings,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": normalize_email(email),
        "name": name[:160],
        "role": "admin",
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": now,
        "exp": now + _TOKEN_LIFETIME,
    }
    return jwt.encode(payload, settings.admin_secret_key, algorithm=_ALGORITHM)


def decode_admin_token(token: str, settings: Settings) -> Optional[dict[str, Any]]:
    try:
        payload = jwt.decode(
            token,
            settings.admin_secret_key,
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            audience=_AUDIENCE,
        )
    except jwt.PyJWTError:
        return None
    email = payload.get("sub")
    if payload.get("role") != "admin" or not isinstance(email, str):
        return None
    if not is_allowed_admin(email, settings):
        return None
    return payload
