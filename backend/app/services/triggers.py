"""Trigger engine (§5.5) — proactivity from REAL events, deterministic.

In-process pub/sub (asyncio queues) — the honest single-instance shape for the
pilot (R15); the seam swaps for Service Bus / change streams at scale with no
agent/brain contract change. `evaluate` is called on every ingested event and
detects idle/misconception/success from real data (never invented).
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Optional

# learner_id → set of subscriber queues (proactive push channel — an interface).
_subscribers: dict[str, set[asyncio.Queue]] = {}

MISCONCEPTION_STREAK = 3   # K consecutive fails on the same objective


def _publish(learner_id: str, trigger: dict[str, Any]) -> None:
    for queue in list(_subscribers.get(learner_id, ())):
        try:
            queue.put_nowait(trigger)
        except asyncio.QueueFull:  # pragma: no cover
            pass


async def evaluate(learner_id: str, event: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Detect a proactive trigger from the just-ingested event; publish if any."""
    from app.services.events import get_recent_events   # lazy: avoid import cycle

    verb = event.get("verb")
    objective_id = event.get("objective_id")
    result = event.get("result") or {}
    trigger: Optional[dict[str, Any]] = None

    if verb in ("answered", "attempted") and result.get("success") is False and objective_id:
        recent = await get_recent_events(learner_id, objective_id, limit=6)  # newest first
        streak = 0
        for e in recent:
            if e.get("verb") in ("answered", "attempted"):
                if (e.get("result") or {}).get("success") is False:
                    streak += 1
                else:
                    break
        if streak >= MISCONCEPTION_STREAK:
            trigger = {"type": "misconception", "objective_id": objective_id,
                       "misconception": event.get("misconception")}
    elif verb == "completed" and result.get("success") is True:
        trigger = {"type": "success", "objective_id": objective_id}

    if trigger:
        _publish(learner_id, trigger)
    return trigger


def publish_idle(learner_id: str, objective_id: Optional[str] = None) -> None:
    """Client-reported idle (no interaction for N s) — absence isn't an event (R5)."""
    _publish(learner_id, {"type": "idle", "objective_id": objective_id})


async def subscribe(learner_id: str, heartbeat: float = 20.0) -> AsyncGenerator[dict[str, Any], None]:
    """Yield triggers for a learner (SSE). Heartbeats keep the connection alive."""
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(learner_id, set()).add(queue)
    try:
        while True:
            try:
                yield await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield {"type": "_heartbeat"}
    finally:
        subs = _subscribers.get(learner_id)
        if subs:
            subs.discard(queue)
            if not subs:
                _subscribers.pop(learner_id, None)
