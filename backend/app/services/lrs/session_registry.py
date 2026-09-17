"""One row per MoE 720 session (`lrs_sessions`) — and the only place `exit` is born.

The spec's session family is enter / suspend / resume / exit, and the ministry's
test script closes a session four ways: logout (TC-SES-04), the tab closed
(SES-05), the browser gone (SES-06), and signing in again (SES-08). Before this
registry the only `exit` came from the logout button, with a duration computed
from the JWT — a child who closed the laptop lid never left, as far as the LRS
could tell, and a re-login stacked a second live session on the first.

The registry keeps, per session id: when it started, the last sign of life
(enter, resume, any authenticated request, the 5-minute ping), whether it is
suspended, and whether it has exited. From that, one rule and one knob
(`LRS_SESSION_IDLE_MINUTES`, default 30) close everything the logout button
never sees: a session with no sign of life for the idle window is closed AT
its last sign of life — the `suspend` that a closing tab beacons, or the last
ping of a browser that was killed — with the gross duration measured to that
moment, not to the minute the sweeper noticed.

`exit` is emitted only through `close()`, which claims the row atomically and
builds the statement with a session-derived id, so two closers (logout racing
the sweeper, two app instances) can never file two exits. A session already
exited stays exited: activity after a timeout is a NEW session, reopened by
`effective_sid()` from the auth dependency with a fresh `enter`, and the
cookie follows.

Mongo with the same JSON fallback as the outbox for a dev machine without a
database — never the production path.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.lrs import config
from app.services.lrs import reporter

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "lrs_sessions.json"

DEFAULT_IDLE_MINUTES = 30
SWEEP_INTERVAL_SECONDS = 60
# A request touches the row at most this often — the registry is bookkeeping,
# not a request log.
TOUCH_THROTTLE_SECONDS = 60


def idle_minutes() -> int:
    """`LRS_SESSION_IDLE_MINUTES` — how long a session may show no sign of life
    before it is considered over (default 30; never below 1)."""
    try:
        return max(1, int(os.getenv("LRS_SESSION_IDLE_MINUTES", "") or DEFAULT_IDLE_MINUTES))
    except ValueError:
        return DEFAULT_IDLE_MINUTES


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _statement_time(dt: datetime) -> str:
    """The statement `timestamp` shape the builders use (whole seconds, Z)."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _collection():
    return _get_collection_named("lrs_sessions")


_indexes_ensured = False


async def _ensure_indexes(collection) -> None:
    global _indexes_ensured
    if _indexes_ensured:
        return
    _indexes_ensured = True
    try:
        await collection.create_index([("user_id", 1), ("exited_at", 1)])
        await collection.create_index([("exited_at", 1), ("last_seen_at", 1)])
    except Exception:  # pragma: no cover — best effort
        pass


# ── JSON fallback (dev only) ─────────────────────────────────────────────────
def _fallback_read() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _fallback_write(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ lrs_sessions fallback write failed: {exc}")


def reset_for_tests() -> None:
    """Forget the in-process caches and the JSON fallback."""
    _touched.clear()
    _effective.clear()
    try:
        _FALLBACK.unlink()
    except OSError:
        pass


# ── Row access (Mongo, else JSON) ────────────────────────────────────────────
def _row(
    sid: str,
    user_id: str,
    *,
    roles: Optional[list[str]],
    device: Optional[dict[str, Any]],
    started_at: datetime,
    predecessor_sid: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "_id": sid,
        "user_id": user_id,
        "roles": list(roles or []),
        "device": device or None,
        "started_at": _iso(started_at),
        "last_seen_at": _iso(started_at),
        "suspended_at": None,
        "resumed_at": None,
        "exited_at": None,
        "exit_reason": None,
        "exit_statement_id": None,
        "predecessor_sid": predecessor_sid,
        "successor_sid": None,
    }


async def _insert(row: dict[str, Any]) -> bool:
    """Insert once; False when the id already exists."""
    collection = _collection()
    if collection is not None:
        try:
            await _ensure_indexes(collection)
            result = await collection.update_one(
                {"_id": row["_id"]}, {"$setOnInsert": row}, upsert=True
            )
            return bool(result.upserted_id)
        except Exception as exc:
            print(f"⚠️ lrs_sessions write failed, using fallback: {exc}")
    data = _fallback_read()
    if row["_id"] in data:
        return False
    data[row["_id"]] = row
    _fallback_write(data)
    return True


async def load(sid: str) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is not None:
        try:
            return await collection.find_one({"_id": sid})
        except Exception as exc:
            print(f"⚠️ lrs_sessions read failed, using fallback: {exc}")
    return _fallback_read().get(sid)


async def _update(sid: str, fields: dict[str, Any], *, only_open: bool = True) -> None:
    query: dict[str, Any] = {"_id": sid}
    if only_open:
        query["exited_at"] = None
    collection = _collection()
    if collection is not None:
        try:
            await collection.update_one(query, {"$set": fields})
            return
        except Exception as exc:
            print(f"⚠️ lrs_sessions update failed, using fallback: {exc}")
    data = _fallback_read()
    row = data.get(sid)
    if row and (not only_open or row.get("exited_at") is None):
        row.update(fields)
        _fallback_write(data)


async def _claim(sid: str, fields: dict[str, Any], *, guard: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Atomically set `fields` on the row matching `guard`; the row BEFORE the
    change, or None when someone else claimed it first."""
    collection = _collection()
    if collection is not None:
        try:
            return await collection.find_one_and_update(
                {"_id": sid, **guard}, {"$set": fields}
            )
        except Exception as exc:
            print(f"⚠️ lrs_sessions claim failed, using fallback: {exc}")
    data = _fallback_read()
    row = data.get(sid)
    if not row or any(row.get(key) != value for key, value in guard.items()):
        return None
    before = dict(row)
    row.update(fields)
    _fallback_write(data)
    return before


async def _open_rows_for_user(user_id: str) -> list[dict[str, Any]]:
    collection = _collection()
    if collection is not None:
        try:
            return [
                row async for row in collection.find({"user_id": user_id, "exited_at": None})
            ]
        except Exception as exc:
            print(f"⚠️ lrs_sessions read failed, using fallback: {exc}")
    return [
        row for row in _fallback_read().values()
        if row.get("user_id") == user_id and row.get("exited_at") is None
    ]


async def _idle_rows(before: datetime, limit: int = 200) -> list[dict[str, Any]]:
    cutoff = _iso(before)
    collection = _collection()
    if collection is not None:
        try:
            cursor = collection.find(
                {"exited_at": None, "last_seen_at": {"$lte": cutoff}}
            ).sort("last_seen_at", 1).limit(limit)
            return [row async for row in cursor]
        except Exception as exc:
            print(f"⚠️ lrs_sessions sweep read failed, using fallback: {exc}")
    return [
        row for row in _fallback_read().values()
        if row.get("exited_at") is None and str(row.get("last_seen_at") or "") <= cutoff
    ][:limit]


# ── Lifecycle ────────────────────────────────────────────────────────────────
async def open(
    user_id: str,
    sid: str,
    *,
    roles: Optional[list[str]] = None,
    device: Optional[dict[str, Any]] = None,
    predecessor_sid: Optional[str] = None,
    at: Optional[datetime] = None,
) -> None:
    """A sign-in: close whatever session this user still had open (TC-SES-08 —
    a re-login ends the previous session, it does not stack on it), record
    the new one, point the user document at it, and report `enter`."""
    now = at or _now()
    if predecessor_sid is None:
        await close_open_for_user(user_id, reason="relogin", at=now)
    await _insert(_row(
        sid, user_id, roles=roles, device=device, started_at=now,
        predecessor_sid=predecessor_sid,
    ))
    _touched[sid] = time.monotonic()
    try:
        from app.auth.repository import set_current_moe_session

        await set_current_moe_session(user_id, sid)
    except Exception as exc:  # the pointer is a convenience, never a gate
        print(f"⚠️ current session pointer not updated ({type(exc).__name__})")
    await reporter.report_session_enter(user_id, sid, device)


async def close(
    sid: str,
    *,
    reason: str,
    at: Optional[datetime] = None,
    user_id: Optional[str] = None,
    fallback_started_at: Optional[datetime] = None,
) -> bool:
    """End a session: the ONE emitter of `exit`.

    Claims the row atomically (a second closer finds it exited and does
    nothing), measures the gross duration from the recorded start to `at`, and
    files the statement with `at` as its timestamp. A session this registry
    never saw (a cookie minted before the registry shipped) is closed from the
    JWT's `iat` when the caller passes it. Returns True when this call was the
    one that closed the session.
    """
    ended = at or _now()
    row = await _claim(
        sid,
        {"exited_at": _iso(ended), "exit_reason": reason},
        guard={"exited_at": None},
    )
    if row is None:
        existing = await load(sid)
        if existing is not None or not (user_id and fallback_started_at):
            return False
        # Unknown to the registry — record it as already exited so a retry
        # cannot file a second exit, then report from the caller's start.
        inserted = await _insert({
            **_row(sid, user_id, roles=None, device=None, started_at=fallback_started_at),
            "exited_at": _iso(ended),
            "exit_reason": reason,
        })
        if not inserted:
            return False
        row = {"user_id": user_id, "started_at": _iso(fallback_started_at)}
    started = _parse(row.get("started_at")) or fallback_started_at or ended
    duration = max(0.0, (ended - started).total_seconds())
    owner = str(row.get("user_id") or user_id or "")
    _effective.pop(sid, None)
    _touched.pop(sid, None)
    try:
        from app.auth.repository import get_user_by_id, set_current_moe_session

        user = await get_user_by_id(owner) if owner else None
        if user and user.get("current_moe_session_id") == sid:
            await set_current_moe_session(owner, None)
    except Exception as exc:
        print(f"⚠️ current session pointer not cleared ({type(exc).__name__})")
    if owner:
        await reporter.report_session_exit(
            owner, sid, duration, timestamp=_statement_time(ended)
        )
    return True


async def close_open_for_user(user_id: str, *, reason: str, at: Optional[datetime] = None) -> int:
    """Close every session this user still has open (re-login). Each is closed
    at its own last sign of life — the old tab, if it is still there, will get
    a 401 on its next call and start over."""
    closed = 0
    for row in await _open_rows_for_user(user_id):
        last = _parse(row.get("suspended_at")) or _parse(row.get("last_seen_at")) or (at or _now())
        if await close(str(row["_id"]), reason=reason, at=min(last, at or _now())):
            closed += 1
    return closed


async def suspend(sid: str, at: Optional[datetime] = None) -> None:
    now = at or _now()
    await _update(sid, {"suspended_at": _iso(now), "last_seen_at": _iso(now)})
    _touched[sid] = time.monotonic()


async def resume(sid: str, at: Optional[datetime] = None) -> None:
    now = at or _now()
    await _update(sid, {"suspended_at": None, "resumed_at": _iso(now), "last_seen_at": _iso(now)})
    _touched[sid] = time.monotonic()


_touched: dict[str, float] = {}


async def touch(sid: str, at: Optional[datetime] = None, *, force: bool = False) -> None:
    """A sign of life. Throttled per process so a busy lesson page does not
    write the row on every request."""
    last = _touched.get(sid)
    if not force and last is not None and time.monotonic() - last < TOUCH_THROTTLE_SECONDS:
        return
    _touched[sid] = time.monotonic()
    await _update(sid, {"last_seen_at": _iso(at or _now())})


# ── Timeout sweeper ──────────────────────────────────────────────────────────
async def sweep(now: Optional[datetime] = None) -> int:
    """Close every session whose last sign of life is older than the idle
    window — at that sign of life. Returns how many were closed."""
    current = now or _now()
    closed = 0
    for row in await _idle_rows(current - timedelta(minutes=idle_minutes())):
        ended = _parse(row.get("suspended_at")) or _parse(row.get("last_seen_at")) or current
        if await close(str(row["_id"]), reason="timeout", at=ended):
            closed += 1
    return closed


async def run_sweeper() -> None:
    """Background loop started at app startup (guarded by `config.is_enabled`)."""
    while True:
        try:
            await sweep()
        except Exception as exc:  # the sweeper must never die
            print(f"⚠️ lrs session sweeper error: {exc}")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)


# ── The session a request really belongs to ──────────────────────────────────
_effective: dict[str, tuple[float, str]] = {}
EFFECTIVE_CACHE_SECONDS = 60


async def effective_sid(payload: dict[str, Any], *, device: Optional[dict[str, Any]] = None) -> Optional[str]:
    """The live session id for a request carrying this JWT.

    The cookie's `sid` was minted at sign-in and lives twelve hours; the
    session the LRS knows about may have ended long before (idle timeout,
    re-login from another tab). Activity after that belongs to a NEW session:
    the exited row is given a successor exactly once (atomic claim), the
    successor is opened with its own `enter`, and every later request follows
    the chain. Cheap on the hot path: one lookup per sid per minute, and a
    request on a live session only touches its last-seen time.
    """
    sid = payload.get("sid")
    if not sid or not config.is_enabled():
        return sid
    cached = _effective.get(sid)
    if cached and time.monotonic() - cached[0] < EFFECTIVE_CACHE_SECONDS:
        await touch(cached[1])
        return cached[1]
    user_id = str(payload.get("sub") or "")
    row = await load(sid)
    if row is None:
        # Minted before the registry shipped (or the fallback file was lost):
        # adopt it from the token's own start so timeout and exit can work.
        started = _parse(payload.get("iat")) or _now()
        await _insert(_row(sid, user_id, roles=payload.get("roles"), device=device, started_at=started))
        await touch(sid, force=True)
        _effective[sid] = (time.monotonic(), sid)
        return sid
    if row.get("exited_at") is None:
        await touch(sid)
        _effective[sid] = (time.monotonic(), sid)
        return sid
    successor = row.get("successor_sid")
    if not successor:
        candidate = str(uuid.uuid4())
        claimed = await _claim(sid, {"successor_sid": candidate}, guard={"successor_sid": None})
        if claimed is not None:
            await open(
                user_id, candidate,
                roles=payload.get("roles"), device=device or row.get("device"),
                predecessor_sid=sid,
            )
            successor = candidate
        else:
            successor = (await load(sid) or {}).get("successor_sid") or sid
    # The successor may itself have expired since — one more hop resolves it.
    resolved = successor
    hop = await load(successor)
    if hop is not None and hop.get("exited_at") is not None:
        resolved = await effective_sid({**payload, "sid": successor}, device=device) or successor
    else:
        await touch(successor)
    _effective[sid] = (time.monotonic(), resolved)
    return resolved
