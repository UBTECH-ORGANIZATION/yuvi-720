"""OAuth2 client-credentials token for the MoE LRS, cached in-memory.

Verified live against staging (2026-07-20): the token endpoint requires a
form-encoded POST body (`application/x-www-form-urlencoded`) — the Postman
collection's query-string style is rejected with 400 "Missing or duplicate
parameters". The response nests `expires_in` under `token_details` (3600s).
Token cached until ~60s before expiry; a single-flight lock prevents a
thundering herd of refreshes when many statements queue at once.
"""

from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx

from app.services.lrs import config

_lock = asyncio.Lock()
_token: Optional[str] = None
_expires_at: float = 0.0

_REFRESH_MARGIN_SECONDS = 60
_DEFAULT_TTL_SECONDS = 300  # if the server omits expires_in


class LrsAuthError(RuntimeError):
    """Token fetch failed — carries no secrets, safe to log."""


async def get_access_token(force_refresh: bool = False) -> str:
    global _token, _expires_at
    if not force_refresh and _token and time.time() < _expires_at:
        return _token
    async with _lock:
        # Re-check: another coroutine may have refreshed while we waited.
        if not force_refresh and _token and time.time() < _expires_at:
            return _token
        form = {
            "grant_type": "client_credentials",
            "client_id": config.client_id(),
            "client_secret": config.client_secret(),
            "scope": config.scope(),
        }
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(config.timeout_seconds())
            ) as client:
                response = await client.post(config.token_url(), data=form)
                response.raise_for_status()
                payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise LrsAuthError(
                f"token endpoint returned {exc.response.status_code}"
            ) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise LrsAuthError(f"token fetch failed: {type(exc).__name__}") from exc

        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise LrsAuthError("token response missing access_token")
        # Staging nests expires_in under token_details; accept either shape.
        ttl = payload.get("expires_in") or (payload.get("token_details") or {}).get(
            "expires_in"
        )
        ttl_seconds = int(ttl) if isinstance(ttl, (int, float)) else _DEFAULT_TTL_SECONDS
        _token = token
        _expires_at = time.time() + max(30, ttl_seconds - _REFRESH_MARGIN_SECONDS)
        return _token


def invalidate_token() -> None:
    """Drop the cached token (e.g. after a 401) so the next call refreshes."""
    global _token, _expires_at
    _token = None
    _expires_at = 0.0
