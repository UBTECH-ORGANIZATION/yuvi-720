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

# A chat turn is a sign of life that fires on every message. Re-broadcast at
# most this often per learner: enough to keep the live view honest, cheap
# enough to sit on the chat hot path.
CHAT_FRAME_MIN_SECONDS = 60.0

# How often an ACTIVE learner's row is re-persisted even without a transition.
# This is what lets a teacher served by a different worker (or container) see
# them at all: the cross-process read merges the persisted rows, and rows that
# only update on transitions go stale the moment a child works quietly.
HEARTBEAT_PERSIST_SECONDS = 60.0

# Most-recently-seen learners loaded back into memory at boot. Bounded because
# this collection grows with every learner the deployment has ever served, and
# a boot must not read all of them.
REHYDRATE_LIMIT = 2000

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


def _seconds_since(stamp: Optional[str]) -> float:
    """Age of an ISO stamp in seconds; infinite when absent or unparseable —
    so a missing timestamp reads as "long ago", never as "just now"."""
    if not stamp:
        return float("inf")
    try:
        moment = datetime.fromisoformat(stamp)
    except ValueError:
        return float("inf")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - moment).total_seconds()


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
        # The catalog's name (and subject key) for the learning the client
        # reports being on (lesson screen only). Display-level, server-side.
        "surface_title": None,
        "surface_subject": None,
        # Where the learner is in the product, as reported by their own client.
        # Advisory only: it never sets `status`, because a client claim must not
        # be able to fake being in a lesson. Filled in by the surface signal.
        # `surface` is the coarse place the live model reasons over;
        # `surface_screen` is the exact screen the client named, so the live
        # view can say "בפורטל הלמידה" rather than a generic "בסביבה".
        "surface": None,
        "surface_screen": None,
        "surface_at": None,
        # Last chat turn. "In a chat with Yuvi" is derived from how recent this
        # is rather than reported, so it decays on its own — a reported flag
        # would stay true forever if the client never sent the closing one.
        "chat_at": None,
    }


def _entry(learner_id: str) -> dict[str, Any]:
    return _state.setdefault(learner_id, _blank(learner_id))


def snapshot(learner_id: str) -> dict[str, Any]:
    """This learner's presence. Never None — an unknown learner is offline."""
    return dict(_state.get(learner_id) or _blank(learner_id))


# A persisted row claiming "online" from another process is trusted only this
# long past its last sign of life. The other worker persists transitions and a
# 60s heartbeat while the learner is active, so a row older than this belongs
# to a process that died holding the connection — presenting its claim as
# current would show a phantom child online for the rest of the day.
STALE_ONLINE_SECONDS = 900.0

# A raised hand is a "right now" claim, same family as `status` — shown for at
# most this long. The durable coach_handoff alert in the teacher's inbox is the
# record that outlives the moment; the live strip waving a hand from days ago
# is a phantom (a stale persisted row with nothing left to lower it did exactly
# that: the clear's best-effort persist failed once and the wave was permanent).
HAND_STALE_SECONDS = 4 * 3600.0


def _cap_hand(row: dict[str, Any]) -> dict[str, Any]:
    if (
        row.get("help_requested_at")
        and _seconds_since(row["help_requested_at"]) > HAND_STALE_SECONDS
    ):
        row["help_requested_at"] = None
    return row


def _merged(learner_id: str, stored: Optional[dict[str, Any]]) -> dict[str, Any]:
    """One learner's presence across processes: memory when it is ours or
    fresher, else the persisted row another worker wrote — with its liveness
    claims capped by recency, never taken on faith."""
    memory = snapshot(learner_id)
    # A connection held by THIS process is the one thing we know first-hand.
    if stored is None or memory.get("connections"):
        return _cap_hand(memory)
    # ISO-8601 UTC stamps compare lexicographically; a missing one loses.
    if (memory.get("last_seen_at") or "") >= (stored.get("last_seen_at") or ""):
        return _cap_hand(memory)
    row = _blank(learner_id)
    for key in row:
        if key in stored and stored[key] is not None:
            row[key] = stored[key]
    row["_id"] = learner_id
    row["learner_id"] = learner_id
    if row["status"] != STATUS_OFFLINE and (
        _seconds_since(row.get("last_seen_at")) > STALE_ONLINE_SECONDS
    ):
        row["status"] = STATUS_OFFLINE
        row["connections"] = 0
        row["struggling"] = None
        row["lesson_entered_at"] = None
    return _cap_hand(row)


async def snapshot_for_group(group_id: str) -> list[dict[str, Any]]:
    """Presence for every learner enrolled in a group, offline ones included.

    A live strip that only lists who is online cannot answer "is anyone missing?"
    — the absent learners are the point.

    Merged with the persisted rows so a class split across workers (or served
    by a container this process is not) still reads truthfully: this is the
    read the teacher's poll lands on, and the in-process dict only knows about
    connections held HERE.
    """
    from app.brain import org
    from app.brain.repository import _get_collection_named

    learner_ids = await org.learners_in_group(group_id)
    stored_by_id: dict[str, dict[str, Any]] = {}
    handle = _get_collection_named(COLLECTION)
    if handle is not None:
        try:
            rows = await handle.find(
                {"_id": {"$in": learner_ids}}
            ).to_list(length=len(learner_ids) or 1)
            stored_by_id = {str(row["_id"]): row for row in rows or []}
        except Exception:  # pragma: no cover — degrade to process-local truth
            stored_by_id = {}
    return [_merged(learner_id, stored_by_id.get(learner_id)) for learner_id in learner_ids]


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
        entry = _state.get(learner_id)
        if entry is not None:
            entry["persisted_at"] = _now()
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


# Fields that survive a restart, because they describe something that happened
# rather than something that is true right now. An allow-list on purpose: a
# field added later must be considered before it can be resurrected as a
# liveness claim by a process that holds no connections.
_DURABLE_ON_BOOT = (
    "last_seen_at",
    "help_requested_at",
    "component_id", "unit_id", "objective_id",
    "subject", "unit_title", "objective_title",
    "session_id",
)


async def rehydrate() -> int:
    """Load the last persisted snapshots back into memory at boot.

    Presence is derived from connections held by *this* process, so a restart
    starts empty and every child reads offline until they happen to reconnect —
    in front of a teacher running a lesson. The snapshot written on transitions
    is the only thing that survives, so it is read back.

    What comes back is deliberately partial. `status`, `connections`,
    `struggling` and `lesson_entered_at` are all claims about *now*, and this
    process has no evidence for any of them, so they reset to the blank values:
    "offline, last seen 10 minutes ago" is honest, "in a lesson" would not be.
    Learners who already reconnected are left alone.
    """
    from app.brain.repository import _get_collection_named
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return 0
    try:
        rows = await (
            handle.find({}).sort("last_seen_at", -1).limit(REHYDRATE_LIMIT)
        ).to_list(length=REHYDRATE_LIMIT)
    except Exception as exc:  # pragma: no cover — a cold start must never fail here
        print(f"⚠️ presence rehydrate failed: {type(exc).__name__}")
        return 0

    loaded = 0
    for row in rows or []:
        learner_id = row.get("learner_id") or row.get("_id")
        if not learner_id or learner_id in _state:
            continue
        entry = _blank(str(learner_id))
        for field in _DURABLE_ON_BOOT:
            if row.get(field) is not None:
                entry[field] = row[field]
        _state[str(learner_id)] = entry
        loaded += 1
    return loaded


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
    """Any sign of life that is not an xAPI verb (a chat turn).

    Never persisted: this fires on every turn, and a chat is not a transition.
    It does re-broadcast, but at most once a minute per learner — without that
    a teacher watching the live view saw "last seen 40 minutes ago" beside a
    child who was mid-conversation with Yuvi, because nothing between the
    lesson verbs ever reached the screen.
    """
    entry = _entry(learner_id)
    previous_chat_at = entry.get("chat_at")
    now = _now()
    entry["last_seen_at"] = now
    entry["chat_at"] = now
    if entry["status"] == STATUS_OFFLINE:
        entry["status"] = STATUS_ONLINE
        _changed(learner_id, persist=False)
        _heartbeat_persist(learner_id, entry)
        return
    if _seconds_since(previous_chat_at) >= CHAT_FRAME_MIN_SECONDS:
        _changed(learner_id, persist=False)
    _heartbeat_persist(learner_id, entry)


def _heartbeat_persist(learner_id: str, entry: dict[str, Any]) -> None:
    """Re-persist an active row at most once a minute, without a frame.

    Not a transition — nothing changed for a teacher on THIS worker — but a
    teacher on another one only sees what reaches the database.
    """
    if _seconds_since(entry.get("persisted_at")) >= HEARTBEAT_PERSIST_SECONDS:
        entry["persisted_at"] = _now()
        _schedule(_persist(learner_id))


# What the live view calls each screen the client can report. Coarser than the
# client's ids on purpose: a teacher scanning thirty rows needs "lesson /
# studio / browsing", not eight route names. `chat` is deliberately absent —
# it is derived from `chat_at` recency, never reported, so it decays on its
# own instead of trusting the client to send a closing claim.
_SURFACE_OF_SCREEN = {
    # A lesson PAGE is a browsing-level fact: the client saying "I am on a
    # lesson screen" must never read as "in a lesson" — `whereOf` only grants
    # that from xAPI-fed status. Mapping it to "lesson" here sent these rows
    # to "unknown" instead (the client claim was recorded, then refused).
    # The exact screen still rides in `surface_screen`, so the teacher reads
    # "בדף שיעור" until real activity upgrades it.
    "learning_lesson": "browsing",
    "learning_create": "studio",
    # Dual-role accounts (a teacher who is also enrolled as a learner) report
    # from the teaching side too — without this they read "unknown" on the
    # live board the whole time they wear the other hat.
    "teacher_app": "browsing",
    "results": "browsing",
    "student_dashboard": "browsing",
    "mentoring": "browsing",
    "learning_portal": "browsing",
    "learning_world": "browsing",
}


def note_surface(
    learner_id: str,
    screen: str,
    unit_id: str | None = None,
    component_id: str | None = None,
) -> None:
    """Where the learner's own client says it is.

    Advisory by construction: it fills `surface`, never `status` — lesson state
    stays xAPI-authoritative, so a client report cannot fake being in a lesson.
    Only a *change* costs a frame and a write, and `surface_at` is stamped only
    then, so it reads "when they arrived here" — which is what the studio-budget
    and concentration work will consume — not "when they last reported".

    Change is judged on the exact SCREEN, not the coarse bucket: dashboard →
    results are both "browsing", but the live view names them apart, so a move
    between them must reach it. On the lesson screen the LEARNING is part of
    the place — the ids from the lesson URL resolve to a title through the
    catalog, so moving between two lessons (same screen) is still a move. The
    title, not the ids, is what gets stored: it is display-only, resolved
    against the catalog the server trusts, never text the client sent.
    """
    surface = _SURFACE_OF_SCREEN.get(screen, "unknown")
    surface_screen = screen if screen in _SURFACE_OF_SCREEN else None
    surface_title, surface_subject = (
        _surface_labels(unit_id, component_id)
        if screen == "learning_lesson" else (None, None)
    )
    entry = _entry(learner_id)
    if (
        entry.get("surface") == surface
        and entry.get("surface_screen") == surface_screen
        and entry.get("surface_title") == surface_title
        and entry.get("surface_subject") == surface_subject
    ):
        return
    entry["surface"] = surface
    entry["surface_screen"] = surface_screen
    entry["surface_title"] = surface_title
    entry["surface_subject"] = surface_subject
    entry["surface_at"] = _now()
    entry["last_seen_at"] = _now()
    _changed(learner_id, persist=True)


def _surface_labels(
    unit_id: str | None, component_id: str | None,
) -> tuple[str | None, str | None]:
    """The catalog's name and subject key for the learning the client is on.

    The name is the LEARNING OBJECTIVE's ("מערכת צירים - מספרים חיוביים"),
    not the exercise's — a teacher scanning locations thinks in objectives;
    "תרגול בסיסי + סטנדרטי ב" says nothing about where the child is. Unit and
    component titles are only the fallback when no objective resolves.

    Same best-effort rule as `_stamp_labels`: a dict lookup against the boot
    snapshot, and an id the catalog does not know simply yields no labels —
    never an error, and never the client's own words.
    """
    try:
        from app.services import kata_catalog

        component = (
            kata_catalog.get_component(str(component_id)) or {} if component_id else {}
        )
        unit = kata_catalog.get_unit(str(unit_id)) or {} if unit_id else {}
        title = None
        objective_id = str(component.get("objective_id") or unit.get("objective_id") or "")
        if objective_id:
            objective_title = kata_catalog.localized_objective_title(objective_id)
            if objective_title and objective_title != objective_id:
                title = objective_title
        title = title or unit.get("title") or component.get("title")
        subject = component.get("subject") or unit.get("subject")
        return (str(title) if title else None, str(subject) if subject else None)
    except Exception:      # pragma: no cover — labels are decoration
        return (None, None)


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
    else:
        _heartbeat_persist(learner_id, entry)


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
    """Lower the hand — unconditionally, and always write through.

    No early return when this process's entry already reads lowered: the stale
    copy may live only in the persisted row (another worker raised it, or our
    own clear's best-effort persist failed once), and skipping the write here
    leaves a hand nothing can ever lower again.
    """
    entry = _entry(learner_id)
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
