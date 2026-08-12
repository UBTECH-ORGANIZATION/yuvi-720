"""Signed, best-effort notification between the product backend and the admin
console.

The two services are separate App Services with their own WebSocket hubs, so a
message written on one side is announced to the other over HTTP. The payload
carries identifiers only — the receiver re-reads Mongo — and a failed notify is
never allowed to fail the write that triggered it.
"""

from __future__ import annotations

import asyncio
import hmac
import os
from typing import Any, Optional

import httpx

_TIMEOUT = httpx.Timeout(3.0)
_tasks: set[asyncio.Task] = set()   # hold task refs so they are not GC'd


def internal_token() -> str:
    return (os.environ.get("SUPPORT_INTERNAL_TOKEN") or "").strip()


def token_matches(candidate: Optional[str]) -> bool:
    expected = internal_token()
    if not expected:
        return False
    return hmac.compare_digest(expected, (candidate or "").strip())


def peer_base_url() -> str:
    return (os.environ.get("SUPPORT_PEER_BASE_URL") or "").strip().rstrip("/")


async def _post(event: dict[str, Any]) -> None:
    base = peer_base_url()
    token = internal_token()
    if not base or not token:
        return
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            await client.post(
                f"{base}/internal/support/notify",
                json=event,
                headers={"X-Support-Token": token},
            )
    except Exception as exc:
        print(f"⚠️ support peer notify failed: {type(exc).__name__}")


def notify_peer(event: dict[str, Any]) -> None:
    """Fire and forget; a peer outage degrades to the client's reconnect refetch."""
    try:
        task = asyncio.create_task(_post(event))
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
