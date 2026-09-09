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

**Scale-out.** The in-process fan-out is still the delivery layer: a publish
reaches every subscriber on THIS instance immediately. When the cache store is
Redis, a bridge relays every published frame to one Redis channel and every
instance re-delivers what the others published, so a learner's events on
instance A reach their teacher's stream on instance B. Frames carry the
origin instance's id and an instance never re-delivers its own. Without
Redis the bridge is simply absent and `server.py` warns about
`WEB_CONCURRENCY > 1` as before.

**Presence hooks.** `on_subscribe`/`on_unsubscribe` fire on the first connection
to a topic and after the last one goes away, which is what lets presence say
"online" without the client having to announce it. Callbacks are best-effort: a
failing hook must never take down someone's stream, so exceptions are swallowed
here rather than propagated into the generator.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator, Callable, Optional

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


def _deliver(topic: str, event: dict[str, Any]) -> int:
    delivered = 0
    for queue in list(_subscribers.get(topic, ())):
        try:
            queue.put_nowait(event)
            delivered += 1
        except asyncio.QueueFull:  # pragma: no cover
            pass
    return delivered


def publish(topic: str, event: dict[str, Any]) -> int:
    """Fan an event out to every connection on `topic`.

    Returns the number of LOCAL queues it reached — 0 is the normal case
    (nobody is looking here), never an error. Synchronous on purpose: it is
    called from the ingest path and from timer callbacks, neither of which can
    await — so the relay to the other instances is scheduled, not awaited.
    """
    delivered = _deliver(topic, event)
    if _bridge.active:
        _bridge.relay(topic, event)
    return delivered


# ── the bridge ─────────────────────────────────────────────────────────────

import json
from uuid import uuid4

_ORIGIN = uuid4().hex


class _Bridge:
    """One Redis channel per environment. Every instance publishes to it and
    listens on it; frames carry the origin so an instance skips its own."""

    def __init__(self) -> None:
        self.active = False
        self._task: Optional[asyncio.Task] = None
        self._client: Any = None      # publishes, on the store's short-timeout client
        self._listener: Any = None    # subscribes, on its own connection with NO socket timeout
        self._channel = ""
        self.relayed = 0
        self.received = 0

    def relay(self, topic: str, event: dict[str, Any]) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:  # a timer callback outside the loop: nothing to relay from
            return
        loop.create_task(self._publish(topic, event))

    async def _publish(self, topic: str, event: dict[str, Any]) -> None:
        if self._client is None:
            return
        try:
            payload = json.dumps({"o": _ORIGIN, "t": topic, "e": event}, ensure_ascii=False, default=str)
            await asyncio.wait_for(self._client.publish(self._channel, payload), timeout=0.5)
            self.relayed += 1
        except Exception as exc:  # the local delivery already happened; the relay is best effort
            print(f"⚠️ realtime relay failed: {type(exc).__name__}")

    def on_message(self, raw: Any) -> int:
        """Deliver a frame another instance published. Returns local deliveries."""
        try:
            frame = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
        except Exception:
            return 0
        if not isinstance(frame, dict) or frame.get("o") == _ORIGIN:
            return 0
        topic, event = frame.get("t"), frame.get("e")
        if not isinstance(topic, str) or not isinstance(event, dict):
            return 0
        self.received += 1
        return _deliver(topic, event)

    async def _listen(self) -> None:
        backoff = 1.0
        while True:
            try:
                # A subscriber waits on the socket for as long as the channel
                # is quiet, so it cannot share the store's 150 ms socket
                # timeout: that connection would drop on every silence.
                pubsub = self._listener.pubsub(ignore_subscribe_messages=True)
                await pubsub.subscribe(self._channel)
                backoff = 1.0
                async for message in pubsub.listen():
                    if message and message.get("type") == "message":
                        self.on_message(message.get("data"))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"⚠️ realtime bridge listener dropped ({type(exc).__name__}); retrying in {backoff:.0f}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def start(self) -> bool:
        from app.core import cache as cache_config
        from app.services import cache_store

        client = cache_store.raw_client()
        if client is None:
            self.active = False
            return False
        import redis.asyncio as redis_asyncio

        self._client = client
        self._listener = redis_asyncio.from_url(
            cache_config.connection_string(), socket_timeout=None,
            socket_connect_timeout=5, health_check_interval=30, decode_responses=False,
        )
        self._channel = cache_config.key_prefix() + "bus"
        self._task = asyncio.create_task(self._listen())
        self.active = True
        return True

    async def stop(self) -> None:
        self.active = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        if self._listener is not None:
            try:
                await self._listener.aclose()
            except Exception:
                pass
            self._listener = None
        self._client = None


_bridge = _Bridge()


async def start_bridge() -> bool:
    """Called from the lifespan. True when the store is Redis and the relay
    is running; False means single-instance delivery, as before."""
    return await _bridge.start()


async def stop_bridge() -> None:
    await _bridge.stop()


def bridge_active() -> bool:
    return _bridge.active


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
                # `asyncio.timeout` rather than `asyncio.wait_for`: on Python
                # 3.11 (what the Dockerfile ships) `wait_for` swallows the
                # CancelledError when the inner future has already resolved,
                # so a client disconnecting in the same tick as an incoming
                # event would keep this generator alive and never reach the
                # `_detach` below — a subscriber leak.
                async with asyncio.timeout(heartbeat):
                    event = await queue.get()
            except asyncio.TimeoutError:
                event = {"type": "_heartbeat"}
            yield event
    finally:
        _detach(topics, queue)


def reset_for_tests() -> None:
    """Drop all subscribers and hooks. Tests only."""
    _subscribers.clear()
    _subscribe_hooks.clear()
    _unsubscribe_hooks.clear()
