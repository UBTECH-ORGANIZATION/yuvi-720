"""WebSocket rooms and peer notification for the admin support console.

Mirrors ``backend/app/services/support_hub.py`` and ``support_notify.py``: this
service keeps its own in-process room and announces its writes to the product
backend over a signed HTTP hook, because the two run as separate App Services.
"""

from __future__ import annotations

import asyncio
import hmac
import os
from typing import Any, Optional

import httpx
from fastapi import WebSocket

ADMIN_ROOM = "admin"
_TIMEOUT = httpx.Timeout(3.0)

_sockets: set[WebSocket] = set()
_lock = asyncio.Lock()
_tasks: set[asyncio.Task] = set()   # hold task refs so they are not GC'd


async def join(socket: WebSocket) -> None:
    async with _lock:
        _sockets.add(socket)


async def leave(socket: WebSocket) -> None:
    async with _lock:
        _sockets.discard(socket)


async def broadcast(event: dict[str, Any]) -> int:
    async with _lock:
        sockets = list(_sockets)
    dead: list[WebSocket] = []
    for socket in sockets:
        try:
            await socket.send_json(event)
        except Exception:
            dead.append(socket)
    for socket in dead:
        await leave(socket)
    return len(sockets) - len(dead)


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
        print(f"⚠️ Admin support peer notify failed: {type(exc).__name__}")


def notify_peer(event: dict[str, Any]) -> None:
    """Fire and forget; a peer outage degrades to the client's reconnect refetch."""
    try:
        task = asyncio.create_task(_post(event))
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
