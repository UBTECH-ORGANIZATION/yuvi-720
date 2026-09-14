"""The short-lived login transaction: state, nonce, PKCE verifier.

Carried in a signed cookie rather than server memory so a login survives an App
Service restart or a swap between instances — there is no sticky session and no
shared cache on the auth path.

The cookie is the CSRF defence: an attacker who plants a `code` in the victim's
browser has no matching `state`, so the callback rejects it before any token
is exchanged.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import jwt

from app.core.env import signing_secret

TX_COOKIE_NAME = "spark_oidc_tx"
TX_LIFETIME = timedelta(minutes=10)

_ALGORITHM = "HS256"
_ISSUER = "yuvilab-spark"
_AUDIENCE = "yuvilab-spark-oidc-tx"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def new_verifier() -> str:
    return _b64url(secrets.token_bytes(48))


def code_challenge(verifier: str) -> str:
    return _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def sanitize_return_to(value: Optional[str]) -> str:
    """Only same-site relative paths. An absolute URL here would turn the login
    endpoint into an open redirect that borrows our domain's credibility."""
    candidate = (value or "").strip()
    if not candidate.startswith("/") or candidate.startswith("//"):
        return "/"
    parsed = urlparse(candidate)
    if parsed.scheme or parsed.netloc:
        return "/"
    return candidate


def create_transaction(*, return_to: Optional[str] = None) -> dict[str, str]:
    verifier = new_verifier()
    return {
        "state": secrets.token_urlsafe(32),
        "nonce": secrets.token_urlsafe(32),
        "code_verifier": verifier,
        "code_challenge": code_challenge(verifier),
        "return_to": sanitize_return_to(return_to),
    }


def encode_transaction(transaction: dict[str, str]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "state": transaction["state"],
        "nonce": transaction["nonce"],
        "cv": transaction["code_verifier"],
        "rt": transaction["return_to"],
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": now,
        "exp": now + TX_LIFETIME,
    }
    return jwt.encode(payload, signing_secret(), algorithm=_ALGORITHM)


def decode_transaction(token: Optional[str]) -> Optional[dict[str, Any]]:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            signing_secret(),
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            audience=_AUDIENCE,
        )
    except jwt.PyJWTError:
        return None
    if not isinstance(payload.get("state"), str) or not payload["state"]:
        return None
    return payload
