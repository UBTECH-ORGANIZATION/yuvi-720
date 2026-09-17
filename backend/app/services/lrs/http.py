"""One pooled HTTP client for everything the LRS package sends.

Every token fetch and every statement used to open its own connection
(`async with httpx.AsyncClient()` per call). On App Service that is the
classic SNAT-port storm: a burst of statements — a lomda relaying a screen,
the sweeper draining a queue — opens dozens of short-lived connections to
one host, the instance runs out of outbound ports, and the next connect
fails. The ledger then shows the pattern seen on Dev: nearly every FIRST
attempt failing (`LrsAuthError` on the token fetch, or a transport error on
the POST) and the sweeper's retry succeeding once ports are free again.

A single client with keep-alive reuses a handful of connections instead.
"""

from __future__ import annotations

from typing import Optional

import httpx

from app.services.lrs import config

_client: Optional[httpx.AsyncClient] = None


def shared_client() -> httpx.AsyncClient:
    """The package's pooled client (created on first use)."""
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(config.timeout_seconds()),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4, keepalive_expiry=30.0),
        )
    return _client


async def close_shared_client() -> None:
    """Shutdown hook — and what the tests call between transports."""
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()
    _client = None


def reset_for_tests() -> None:
    """Drop the client without awaiting (a test swaps the transport)."""
    global _client
    _client = None
