"""OpenID discovery + JWKS, cached in process.

The Ministry publishes `.well-known/openid-configuration`; we read the
endpoints from there rather than hardcoding them, so a tenant move is their
change and not ours. Both caches fall back to the documented dev endpoints, so
a discovery outage degrades to "still works" instead of "nobody can log in".
"""

from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from app.auth.moe import config

_metadata: Optional[dict[str, Any]] = None
_metadata_expires_at: float = 0.0
_jwks: Optional[dict[str, Any]] = None
_jwks_expires_at: float = 0.0

_FALLBACK_METADATA: dict[str, Any] = {
    "issuer": config.DEFAULT_ISSUER,
    "authorization_endpoint": config.DEFAULT_AUTHORIZE_ENDPOINT,
    "token_endpoint": config.DEFAULT_TOKEN_ENDPOINT,
    "userinfo_endpoint": config.DEFAULT_USERINFO_ENDPOINT,
    "jwks_uri": config.DEFAULT_JWKS_ENDPOINT,
    "end_session_endpoint": config.DEFAULT_END_SESSION_ENDPOINT,
}


def reset_cache() -> None:
    global _metadata, _metadata_expires_at, _jwks, _jwks_expires_at
    _metadata = None
    _metadata_expires_at = 0.0
    _jwks = None
    _jwks_expires_at = 0.0


async def _get_json(url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=config.http_timeout_seconds()) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


async def metadata() -> dict[str, Any]:
    global _metadata, _metadata_expires_at
    now = time.time()
    if _metadata is not None and now < _metadata_expires_at:
        return _metadata
    try:
        document = await _get_json(config.discovery_url())
    except Exception as exc:
        # The status matters: a timeout is an outage, a 403 on an anonymous
        # document means something is refusing us before the Ministry sees it.
        status = getattr(getattr(exc, "response", None), "status_code", None)
        suffix = f" HTTP {status}" if status else ""
        print(
            "⚠️ MoE OIDC discovery failed, using documented endpoints: "
            f"{type(exc).__name__}{suffix}"
        )
        document = dict(_FALLBACK_METADATA)
    _metadata = {**_FALLBACK_METADATA, **document}
    _metadata_expires_at = now + config.jwks_ttl_seconds()
    return _metadata


async def endpoint(name: str) -> str:
    document = await metadata()
    return str(document.get(name) or _FALLBACK_METADATA.get(name) or "")


async def jwks(*, force_refresh: bool = False) -> dict[str, Any]:
    """Signing keys. `force_refresh` is the answer to an unknown `kid` — the
    Ministry rotating a key must not lock everyone out until the TTL expires."""
    global _jwks, _jwks_expires_at
    now = time.time()
    if _jwks is not None and not force_refresh and now < _jwks_expires_at:
        return _jwks
    uri = await endpoint("jwks_uri")
    _jwks = await _get_json(uri)
    _jwks_expires_at = now + config.jwks_ttl_seconds()
    return _jwks
