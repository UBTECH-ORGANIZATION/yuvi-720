"""The generic realtime bus — one pub/sub for the whole product.

Extracted from `triggers.py`, which grew the original learner-only channel. It
stayed learner-only for a while and that was fine; then the teacher app needed
alerts, presence needed connect/disconnect, and student notifications needed a
channel of their own. Three more copies of the same twenty lines would have been
three more places to get subscriber cleanup wrong.

**Topics**, not ids::

    learner:{learner_id}   proactive coach nudges (the original channel)
    user:{user_id}         notifications addressed to a person, either role
    teacher:{teacher_id}   alerts and presence frames for one teacher
    group:{group_id}       anything scoped to a class

A connection subscribes to several topics at once and gets one merged stream.
That matters on the client: HTTP/1.1 allows ~6 connections per origin, so the
learner page multiplexes `learner:` and `user:` down one EventSource instead of
spending two of that budget.

**Scale-out seam.** This module is in-process, which is the honest shape for a
single-instance pilot. Everything that fans out goes through `publish`, so
swapping in Service Bus or a Redis fanout is one file — no caller changes. Under
`WEB_CONCURRENCY > 1` today, a publish only reaches subscribers on the same
worker; `server.py` warns about that at boot.

**Presence hooks.** `on_subscribe`/`on_unsubscribe` fire on the first connection
to a topic and after the last one goes away, which is what lets presence say
"online" without the client having to announce it. Callbacks are best-effort: a
failing hook must never take down someone's stream, so exceptions are swallowed
here rather than propagated into the generator.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Callable

# topic → set of subscriber queues.
_subscribers: dict[str, set[asyncio.Queue]] = {}

# A slow or wedged consumer must not grow without bound. 256 frames is far more
# than any real client is behind by; past that the connection is broken in
# practice and dropping is more honest than eating memory.
_QUEUE_MAXSIZE = 256

SubscribeHook = Callable[[str], None]

_subscribe_hooks: list[SubscribeHook] = []
_unsubscribe_hooks: list[SubscribeHook] = []


def on_subscribe(callback: SubscribeHook) -> None:
    """Called with the topic when it gains its FIRST subscriber."""
    _subscribe_hooks.append(callback)


def on_unsubscribe(callback: SubscribeHook) -> None:
    """Called with the topic when it loses its LAST subscriber."""
    _unsubscribe_hooks.append(callback)


def _fire(hooks: list[SubscribeHook], topic: str) -> None:
    for hook in hooks:
        try:
            hook(topic)
        except Exception as exc:  # pragma: no cover - defensive
            print(f"⚠️ realtime hook failed for {topic}: {exc}")


def publish(topic: str, event: dict[str, Any]) -> int:
    """Fan an event out to every connection on `topic`.

    Returns the number of queues it reached — 0 is the normal case (nobody is
    looking), never an error. Synchronous on purpose: it is called from the
    ingest path and from timer callbacks, neither of which can await.
    """
    delivered = 0
    for queue in list(_subscribers.get(topic, ())):
        try:
            queue.put_nowait(event)
            delivered += 1
        except asyncio.QueueFull:  # pragma: no cover
            pass
    return delivered


def subscriber_count(topic: str) -> int:
    return len(_subscribers.get(topic, ()))


def _attach(topics: tuple[str, ...], queue: asyncio.Queue) -> None:
    for topic in topics:
        existing = _subscribers.setdefault(topic, set())
        first = not existing
        existing.add(queue)
        if first:
            _fire(_subscribe_hooks, topic)


def _detach(topics: tuple[str, ...], queue: asyncio.Queue) -> None:
    for topic in topics:
        subscribers = _subscribers.get(topic)
        if not subscribers:
            continue
        subscribers.discard(queue)
        if not subscribers:
            _subscribers.pop(topic, None)
            _fire(_unsubscribe_hooks, topic)


async def subscribe(
    *topics: str, heartbeat: float = 20.0
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield events for `topics` as one merged stream (SSE).

    A `{"type": "_heartbeat"}` frame every `heartbeat` seconds of silence keeps
    proxies and load balancers from reaping an idle connection — the wire format
    the existing learner stream already uses, so the client is unchanged.
    """
    queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAXSIZE)
    _attach(topics, queue)
    try:
        while True:
            try:
                yield await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                yield {"type": "_heartbeat"}
    finally:
        _detach(topics, queue)


def reset_for_tests() -> None:
    """Drop all subscribers and hooks. Tests only."""
    _subscribers.clear()
    _subscribe_hooks.clear()
    _unsubscribe_hooks.clear()
