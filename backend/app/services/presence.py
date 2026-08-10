"""Who is online, who is in a lesson, and who is stuck — right now.

Feeds the teacher's live classroom strip and the presence dot on every roster
card. Three signals, all of them things the server already sees:

1. **Connections.** `realtime`'s subscribe/unsubscribe hooks. The learner page
   holds an SSE connection for the coach, so "has a connection" is a free and
   honest online signal — no client heartbeat to trust or forge.
2. **xAPI verbs.** `enter`/`answered`/`attempted` → in a lesson; `exit` or a
   component `completed` → back to browsing.
3. **Struggle.** The detectors `triggers.evaluate` already runs, with the same
   raw evidence dict, so the teacher sees exactly what the coach reacted to.

**The in-process dict is the authority; Mongo is a courtesy.**
Presence is inherently process-local — it is derived from connections held by
*this* worker — so writing every event through to the database would add write
amplification to the ingest hot path in exchange for a number that would still
be wrong under multiple workers. Instead the snapshot is persisted only on
*transitions* (online ↔ in_lesson ↔ offline, struggle set/cleared), which are
rare, so a teacher opening the dashboard after a restart still sees "last seen 10
minutes ago" rather than a blank.

**Disconnect is not "gone".** Laptops sleep and proxies reap idle sockets, so a
dropped connection starts a `OFFLINE_GRACE_SECONDS` timer rather than flipping
the dot. And the UI must always render "last seen X ago" alongside the status:
absence is not an event, and a bare green dot claims more than we know.
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any, Optional

from app.services import realtime

COLLECTION = "learner_presence"

STATUS_OFFLINE = "offline"
STATUS_ONLINE = "online"
STATUS_IN_LESSON = "in_lesson"

# A dropped SSE connection is usually a sleeping laptop or a proxy reaping an
# idle socket, not a child leaving. Wait it out before saying they are gone.
OFFLINE_GRACE_SECONDS = 45.0

# Verbs that mean "working inside content right now".
_IN_LESSON_VERBS = {"entered", "answered", "attempted", "played", "interacted", "experienced"}
# Verbs that mean "done with this piece of content".
_LEFT_LESSON_VERBS = {"exited", "completed", "terminated", "suspended"}

_TOPIC_PREFIX = "learner:"

# learner_id → presence document (the authority).
_state: dict[str, dict[str, Any]] = {}
# learner_id → pending offline timer.
_offline_timers: dict[str, asyncio.TimerHandle] = {}
# learner_id → (monotonic_deadline, teacher_ids); avoids a group lookup per frame.
_teacher_cache: dict[str, tuple[float, list[str]]] = {}
_TEACHER_CACHE_TTL = 30.0


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _blank(learner_id: str) -> dict[str, Any]:
    return {
        "_id": learner_id,
        "learner_id": learner_id,
        "status": STATUS_OFFLINE,
        "connections": 0,
        "component_id": None,
        "unit_id": None,
        "objective_id": None,
        # Human labels for the ids above, resolved from the catalog at event
        # time — what the live strip renders instead of "in a lesson".
        "subject": None,
        "unit_title": None,
        "objective_title": None,
        "session_id": None,
        "last_seen_at": None,
        "lesson_entered_at": None,
        "struggling": None,
        "help_requested_at": None,
    }


def _entry(learner_id: str) -> dict[str, Any]:
    return _state.setdefault(learner_id, _blank(learner_id))


def snapshot(learner_id: str) -> dict[str, Any]:
    """This learner's presence. Never None — an unknown learner is offline."""
    return dict(_state.get(learner_id) or _blank(learner_id))


async def snapshot_for_group(group_id: str) -> list[dict[str, Any]]:
    """Presence for every learner enrolled in a group, offline ones included.

    A live strip that only lists who is online cannot answer "is anyone missing?"
    — the absent learners are the point.
    """
    from app.brain import org
    return [snapshot(learner_id) for learner_id in await org.learners_in_group(group_id)]


# ── change propagation ───────────────────────────────────────────────────────

def _schedule(coroutine) -> None:
    """Run an async side effect from a sync caller, or drop it if there is no
    loop (a worker or a sync test). Presence is best-effort by construction."""
    try:
        asyncio.get_running_loop().create_task(coroutine)
    except RuntimeError:
        coroutine.close()


async def _teachers_for(learner_id: str) -> list[str]:
    cached = _teacher_cache.get(learner_id)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    from app.brain import org
    teacher_ids = await org.teachers_for_learner(learner_id)
    _teacher_cache[learner_id] = (time.monotonic() + _TEACHER_CACHE_TTL, teacher_ids)
    return teacher_ids


async def _broadcast(learner_id: str) -> None:
    """Push the new presence to exactly the teachers who may see this learner.

    Recipients are resolved at publish time from the live roster, which is what
    makes it impossible to leak a presence frame to a teacher outside the
    learner's groups — the same rule the alert fanout uses.
    """
    frame = {"type": "presence", "presence": snapshot(learner_id)}
    for teacher_id in await _teachers_for(learner_id):
        realtime.publish(f"teacher:{teacher_id}", frame)


async def _persist(learner_id: str) -> None:
    from app.brain.repository import _get_collection_named
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return
    try:
        document = snapshot(learner_id)
        await handle.update_one(
            {"_id": learner_id}, {"$set": document}, upsert=True
        )
    except Exception as exc:  # pragma: no cover - presence must never break ingest
        print(f"⚠️ presence persist failed for {learner_id}: {type(exc).__name__}")


def _changed(learner_id: str, *, persist: bool) -> None:
    _schedule(_broadcast(learner_id))
    if persist:
        _schedule(_persist(learner_id))


# ── connections ──────────────────────────────────────────────────────────────

def _cancel_offline_timer(learner_id: str) -> None:
    handle = _offline_timers.pop(learner_id, None)
    if handle is not None:
        handle.cancel()


def note_connection(learner_id: str) -> None:
    """A learner opened a live connection (first tab)."""
    _cancel_offline_timer(learner_id)
    entry = _entry(learner_id)
    entry["connections"] = realtime.subscriber_count(f"{_TOPIC_PREFIX}{learner_id}") or 1
    entry["last_seen_at"] = _now()
    # Reconnecting mid-lesson must not demote them out of the lesson they are
    # still sitting in — only a real exit does that.
    if entry["status"] == STATUS_OFFLINE:
        entry["status"] = STATUS_ONLINE
    _changed(learner_id, persist=True)


def note_disconnection(learner_id: str) -> None:
    """The learner's last connection dropped. Start the grace timer."""
    entry = _entry(learner_id)
    entry["connections"] = 0
    entry["last_seen_at"] = _now()

    def _go_offline() -> None:
        _offline_timers.pop(learner_id, None)
        current = _entry(learner_id)
        if current["connections"]:      # reconnected inside the grace window
            return
        current["status"] = STATUS_OFFLINE
        current["struggling"] = None    # a struggle you cannot see is not actionable
        _changed(learner_id, persist=True)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:                # no loop: flip immediately, nothing to wait on
        _go_offline()
        return
    _cancel_offline_timer(learner_id)
    _offline_timers[learner_id] = loop.call_later(OFFLINE_GRACE_SECONDS, _go_offline)


def _on_topic(topic: str, handler) -> None:
    if topic.startswith(_TOPIC_PREFIX):
        handler(topic[len(_TOPIC_PREFIX):])


_installed = False


def install_hooks() -> None:
    """Wire presence to the bus. Called once from the app lifespan."""
    global _installed
    if _installed:
        return
    realtime.on_subscribe(lambda topic: _on_topic(topic, note_connection))
    realtime.on_unsubscribe(lambda topic: _on_topic(topic, note_disconnection))
    _installed = True


# ── activity ─────────────────────────────────────────────────────────────────

def note_activity(learner_id: str) -> None:
    """Any sign of life that is not an xAPI verb (a chat turn). Memory only —
    this fires often and says nothing a teacher's screen needs to re-render."""
    entry = _entry(learner_id)
    entry["last_seen_at"] = _now()
    if entry["status"] == STATUS_OFFLINE:
        entry["status"] = STATUS_ONLINE
        _changed(learner_id, persist=False)


def _stamp_labels(entry: dict[str, Any]) -> None:
    """Resolve the ids into what a teacher can actually read.

    "In a lesson" is not information; "מתמטיקה · מערכת צירים" is. The catalog is
    an in-memory snapshot after boot, so this is a dict lookup, not I/O — and it
    is best-effort by design: a unit the catalog does not know simply shows no
    label, never an error in the presence path.
    """
    try:
        from app.services import kata_catalog

        unit = kata_catalog.get_unit(str(entry.get("unit_id") or "")) or {}
        entry["subject"] = unit.get("subject") or entry.get("subject")
        entry["unit_title"] = unit.get("title") or entry.get("unit_title")
        objective_id = str(entry.get("objective_id") or "")
        if objective_id:
            title = kata_catalog.localized_objective_title(objective_id)
            if title and title != objective_id:
                entry["objective_title"] = title
    except Exception:      # pragma: no cover — labels are decoration, presence is not
        pass


def note_event(learner_id: str, event: dict[str, Any]) -> None:
    """Fold an ingested xAPI event into presence.

    Called from `events.ingest_statement` after the event is stored, so presence
    can never claim activity that was not recorded.
    """
    entry = _entry(learner_id)
    verb = str(event.get("verb") or "").lower()
    previous = entry["status"]

    entry["last_seen_at"] = _now()
    if event.get("session_id"):
        entry["session_id"] = event["session_id"]

    if verb in _IN_LESSON_VERBS:
        entry["status"] = STATUS_IN_LESSON
        entry["component_id"] = event.get("component_id") or entry["component_id"]
        entry["unit_id"] = event.get("unit_id") or entry["unit_id"]
        entry["objective_id"] = event.get("objective_id") or entry["objective_id"]
        _stamp_labels(entry)
        if previous != STATUS_IN_LESSON:
            entry["lesson_entered_at"] = _now()
    elif verb in _LEFT_LESSON_VERBS:
        entry["status"] = STATUS_ONLINE
        entry["lesson_entered_at"] = None
        entry["struggling"] = None      # they moved on; the struggle is stale
    elif previous == STATUS_OFFLINE:
        entry["status"] = STATUS_ONLINE

    # Only a real transition is worth a frame and a write. A stream of `answered`
    # events inside one lesson would otherwise be a write per keystroke-ish.
    if entry["status"] != previous:
        _changed(learner_id, persist=True)


# ── struggle + help ──────────────────────────────────────────────────────────

def note_struggle(learner_id: str, kind: str, evidence: Optional[dict[str, Any]] = None) -> None:
    """A detector fired. Carries the same raw evidence the coach reacted to, so
    the teacher's card can show *why* — never a bare "struggling" badge."""
    entry = _entry(learner_id)
    if (entry.get("struggling") or {}).get("kind") == kind:
        return                          # already showing; don't re-ring
    entry["struggling"] = {"kind": kind, "since": _now(), "evidence": evidence or {}}
    entry["last_seen_at"] = _now()
    _changed(learner_id, persist=True)


def clear_struggle(learner_id: str) -> None:
    entry = _entry(learner_id)
    if entry.get("struggling") is None:
        return
    entry["struggling"] = None
    _changed(learner_id, persist=True)


def note_help_requested(learner_id: str) -> None:
    entry = _entry(learner_id)
    entry["help_requested_at"] = _now()
    entry["last_seen_at"] = _now()
    _changed(learner_id, persist=True)


def clear_help_requested(learner_id: str) -> None:
    entry = _entry(learner_id)
    if not entry.get("help_requested_at"):
        return
    entry["help_requested_at"] = None
    _changed(learner_id, persist=True)


def reset_for_tests() -> None:
    global _installed
    for handle in _offline_timers.values():
        handle.cancel()
    _offline_timers.clear()
    _state.clear()
    _teacher_cache.clear()
    _installed = False
