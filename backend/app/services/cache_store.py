"""The read cache: versioned keys, compressed JSON, and a store that fails open.

## What a key looks like

    spark:{env}:v1:{scope}:{ident}:{version}:{name}:{args}

`scope` is one of a few nouns (``learner``, ``grp``, ``teacher``, ``kata``,
``comp``), `ident` the id inside it, and `version` the current value of an
``INCR`` counter kept per (scope, ident). Invalidating "everything about this
class" is one ``INCR``; the old keys are simply never asked for again and
expire on their own. No ``SCAN``, no pattern delete, no key ever without a
TTL (24 h at most), so a missed bump is a bounded staleness, never a leak.

## Why compressed

The learner catalog response is ~200 KB of JSON per learner; multiplied by a
school that is the whole cache. zlib level 1 shrinks this shape six to ten
times for a fraction of a millisecond, so every value is stored compressed
and marked with a one-byte header.

## Why it fails open

Every existing cache in this codebase degrades rather than raises, and this
one is no different: a timeout, a refused connection, a serialisation error
— any of them is a miss, logged once per minute, and the handler computes.
With Redis down the app is exactly as fast as it was before Redis.

## Modes

`app.core.cache.cache_mode()` decides: ``redis`` (a real client, bounded
pool, short timeouts), ``memory`` (a dict with expiry, for a laptop without
Redis), ``off`` (every call is a miss — CI, and the default when nothing is
configured outside production).
"""

from __future__ import annotations

import asyncio
import functools
import json
import os
import time
import zlib
from typing import Any, Awaitable, Callable, Optional, TypeVar

from app.core import cache as cache_config

T = TypeVar("T")

_MISS = object()
_COMPRESSED = b"\x01"
_PLAIN = b"\x00"
_MAX_TTL = 24 * 60 * 60
_COMPRESS_ABOVE = 512  # bytes; smaller values are not worth the round trip of zlib

# Timeouts are milliseconds, overridable for a laptop far from the cache.
_CONNECT_MS = int(os.environ.get("SPARK_CACHE_CONNECT_MS") or 300)
_OP_MS = int(os.environ.get("SPARK_CACHE_TIMEOUT_MS") or 150)
_POOL = 20


class _Stats:
    hits = 0
    misses = 0
    errors = 0
    last_error_at = 0.0


stats = _Stats()


# ── backends ─────────────────────────────────────────────────────────────


class MemoryBackend:
    """A dict with expiry. One process, lost on restart — what a laptop
    without Redis gets, and what the cache-layer tests drive."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[float, bytes]] = {}

    def _alive(self, key: str) -> Optional[bytes]:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            self._data.pop(key, None)
            return None
        return value

    async def get(self, key: str) -> Optional[bytes]:
        return self._alive(key)

    async def set(self, key: str, value: bytes, ttl: int) -> None:
        self._data[key] = (time.monotonic() + ttl, value)

    async def delete(self, *keys: str) -> None:
        for key in keys:
            self._data.pop(key, None)

    async def incr(self, key: str, ttl: int) -> int:
        current = self._alive(key)
        value = (int(current) if current else 0) + 1
        self._data[key] = (time.monotonic() + ttl, str(value).encode())
        return value

    async def close(self) -> None:
        self._data.clear()

    def __len__(self) -> int:
        return len(self._data)


class RedisBackend:
    """One client, bounded pool, short timeouts. The 2026-08-30 Cosmos stampede
    is the reason the pool is bounded here too."""

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis_asyncio  # imported lazily: memory/off modes need no client

        self._client = redis_asyncio.from_url(
            url,
            max_connections=_POOL,
            socket_connect_timeout=_CONNECT_MS / 1000,
            socket_timeout=_OP_MS / 1000,
            retry_on_timeout=False,
            health_check_interval=30,
            decode_responses=False,
        )

    async def get(self, key: str) -> Optional[bytes]:
        return await self._client.get(key)

    async def set(self, key: str, value: bytes, ttl: int) -> None:
        await self._client.set(key, value, ex=ttl)

    async def delete(self, *keys: str) -> None:
        if keys:
            await self._client.delete(*keys)

    async def incr(self, key: str, ttl: int) -> int:
        pipe = self._client.pipeline(transaction=False)
        pipe.incr(key)
        pipe.expire(key, ttl)
        value, _ = await pipe.execute()
        return int(value)

    async def close(self) -> None:
        await self._client.aclose()

    @property
    def raw(self):
        """The underlying client, for the pub/sub and lock layers that come
        after the read cache."""
        return self._client


_backend: Any = None
_mode: Optional[str] = None


def _get_backend() -> Any:
    """The process-wide backend, created on first use after the guard."""
    global _backend, _mode
    mode = cache_config.cache_mode()
    if _backend is not None and _mode == mode:
        return _backend
    cache_config.verify_configuration()
    if mode == cache_config.REDIS:
        _backend = RedisBackend(cache_config.connection_string())
    elif mode == cache_config.MEMORY:
        _backend = MemoryBackend()
    else:
        _backend = None
    _mode = mode
    return _backend


def enabled() -> bool:
    return cache_config.cache_mode() != cache_config.OFF


async def reset() -> None:
    """Test hook and shutdown: drop the backend so the next use re-reads the
    configuration."""
    global _backend, _mode
    if _backend is not None:
        try:
            await _backend.close()
        except Exception:  # pragma: no cover - closing is best effort
            pass
    _backend = None
    _mode = None
    stats.hits = stats.misses = stats.errors = 0


# ── the failing-open seam ────────────────────────────────────────────────


def _note_error(exc: BaseException) -> None:
    stats.errors += 1
    now = time.monotonic()
    if now - stats.last_error_at > 60:  # one line a minute, not one per request
        stats.last_error_at = now
        print(f"⚠️ cache unavailable, computing instead: {type(exc).__name__}: {exc}")


async def _guarded(coro: Awaitable[T], fallback: T) -> T:
    try:
        return await asyncio.wait_for(coro, timeout=(_CONNECT_MS + _OP_MS) / 1000)
    except Exception as exc:  # any failure is a miss, never a 500
        _note_error(exc)
        return fallback


# ── encoding ─────────────────────────────────────────────────────────────


def encode(value: Any) -> bytes:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
    if len(raw) > _COMPRESS_ABOVE:
        return _COMPRESSED + zlib.compress(raw, 1)
    return _PLAIN + raw


def decode(blob: bytes) -> Any:
    if blob[:1] == _COMPRESSED:
        return json.loads(zlib.decompress(blob[1:]).decode("utf-8"))
    return json.loads(blob[1:].decode("utf-8"))


# ── keys and versions ────────────────────────────────────────────────────


def _k(*parts: Any) -> str:
    return cache_config.key_prefix() + ":".join(str(p) for p in parts)


async def version(scope: str, ident: str) -> int:
    """The current version of a (scope, ident); 0 when nothing bumped it yet."""
    backend = _get_backend()
    if backend is None:
        return 0
    raw = await _guarded(backend.get(_k("ver", scope, ident)), None)
    return int(raw) if raw else 0


async def bump(scope: str, ident: str) -> int:
    """Invalidate everything cached under (scope, ident). One INCR.

    Cheap enough to call from the event fold on every answer: the cost of a
    bump is one round trip, and the cost of NOT bumping is a stale screen.
    """
    backend = _get_backend()
    if backend is None:
        return 0
    return await _guarded(backend.incr(_k("ver", scope, ident), _MAX_TTL), 0)


async def get(key_parts: tuple[Any, ...]) -> Any:
    """Raw read by full key parts; returns the sentinel `MISS` on a miss."""
    backend = _get_backend()
    if backend is None:
        return _MISS
    blob = await _guarded(backend.get(_k(*key_parts)), None)
    if blob is None:
        stats.misses += 1
        return _MISS
    try:
        value = decode(blob)
    except Exception as exc:  # a value another build wrote; treat as a miss
        _note_error(exc)
        stats.misses += 1
        return _MISS
    stats.hits += 1
    return value


async def put(key_parts: tuple[Any, ...], value: Any, ttl: int) -> None:
    backend = _get_backend()
    if backend is None:
        return
    ttl = max(1, min(int(ttl), _MAX_TTL))
    try:
        blob = encode(value)
    except Exception as exc:
        _note_error(exc)
        return
    await _guarded(backend.set(_k(*key_parts), blob, ttl), None)


async def drop(key_parts: tuple[Any, ...]) -> None:
    backend = _get_backend()
    if backend is None:
        return
    await _guarded(backend.delete(_k(*key_parts)), None)


MISS = _MISS


# ── the one helper handlers use ──────────────────────────────────────────


async def remember(
    scope: str,
    ident: str,
    name: str,
    args: str,
    ttl: int,
    compute: Callable[[], Awaitable[T]],
    *,
    versioned: bool = True,
) -> T:
    """Return the cached value for (scope, ident, name, args) or compute,
    store and return it. `versioned=False` is for global content (the Kata
    catalog, a questionnaire) whose freshness is carried in `args`."""
    if not enabled():
        return await compute()
    ver = await version(scope, ident) if versioned else 0
    parts = (scope, ident, ver, name, args)
    hit = await get(parts)
    if hit is not _MISS:
        return hit  # type: ignore[return-value]
    value = await compute()
    await put(parts, value, ttl)
    return value


def cached(
    scope: str,
    name: str,
    ttl: int,
    *,
    ident: Callable[..., str],
    args: Callable[..., str] = lambda *a, **k: "",
    versioned: bool = True,
):
    """Decorator form of :func:`remember` for an async function.

        @cached("grp", "snapshot", ttl=120,
                ident=lambda group_id, **_: group_id,
                args=lambda group_id, language="he", days=7, **_: f"{language}:{days}")
        async def group_insights(group_id, language="he", days=7): ...
    """

    def wrap(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def inner(*a: Any, **k: Any) -> T:
            return await remember(
                scope, ident(*a, **k), name, args(*a, **k), ttl,
                lambda: fn(*a, **k), versioned=versioned,
            )

        inner.__wrapped__ = fn  # type: ignore[attr-defined]
        return inner

    return wrap
