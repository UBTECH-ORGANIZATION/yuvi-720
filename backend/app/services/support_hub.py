"""In-process WebSocket rooms for the support chat.

Each service (product backend and admin console) runs its own hub, so a message
written on one side reaches the other through the signed internal notify hook in
``app.routes.support`` rather than a shared broker. Payloads carry identifiers
only; every receiver re-reads Mongo before showing anything.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket

ADMIN_ROOM = "admin"

_rooms: dict[str, set[WebSocket]] = {}
_lock = asyncio.Lock()


def teacher_room(teacher_id: str) -> str:
    return f"teacher:{teacher_id}"


async def join(room: str, socket: WebSocket) -> None:
    async with _lock:
        _rooms.setdefault(room, set()).add(socket)


async def leave(room: str, socket: WebSocket) -> None:
    async with _lock:
        sockets = _rooms.get(room)
        if sockets is None:
            return
        sockets.discard(socket)
        if not sockets:
            _rooms.pop(room, None)


async def broadcast(room: str, event: dict[str, Any]) -> int:
    """Send one event to a room and drop sockets that have gone away."""
    async with _lock:
        sockets = list(_rooms.get(room, ()))
    dead: list[WebSocket] = []
    for socket in sockets:
        try:
            await socket.send_json(event)
        except Exception:
            dead.append(socket)
    for socket in dead:
        await leave(room, socket)
    return len(sockets) - len(dead)


def room_size(room: str) -> int:
    return len(_rooms.get(room, ()))
