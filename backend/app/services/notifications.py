"""Notifications — discrete addressed messages, for either role.

Deliberately one collection and one endpoint set for learners and teachers.
`recipient_role` only drives rendering; the read/unread/dismiss semantics are
identical, and two parallel implementations would have drifted within a month.

Distinct from `teacher_alerts`, which are *stateful conditions* that dedupe,
recur and resolve. A notification is a thing that happened once: "your teacher
set you a goal", "your goal was approved, here are 12 sparks".

Three rules run through this file:

**Text is never stored.** A row carries `title_key` + `params`, and the client
renders it. A user can switch language at any moment, and a stored Hebrew
sentence would be frozen in a language they no longer read. Same reasoning as
the `REASON`/`REC` dictionaries in `insights.py`.

**Dismissal is a soft delete.** `dismissed_at` is stamped; the document stays.
The notification is the record of what someone was told and when — a safety
escalation dismissed unread is exactly the row you need later. Deterministic ids
also mean a hard delete would let the same event re-fire and ring the bell
again, and the repo already does it this way (`mentoring` goals carry `deleted`,
`agent_conversations` has `soft_delete_conversation`).

**Every notification is a deep link.** `actions[0].route` points at the object
itself, so clicking a row navigates to the thing rather than to a list the user
then has to search.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.services import realtime

COLLECTION = "notifications"

KIND_GOAL_ASSIGNED = "goal_assigned"
KIND_GOAL_APPROVED = "goal_approved"
KIND_TEACHER_NOTE = "teacher_note"
KIND_KUDOS = "kudos"
KIND_ALERT = "alert"

KIND_TASK_ASSIGNED = "task_assigned"

# The two directions of the direct-message channel. Two kinds and not one,
# because `recipient_role` decides which bell rings and the two rows deep-link
# to different screens — a learner's message opens the teacher's thread, a
# teacher's opens the child's chat.
KIND_TEACHER_MESSAGE = "teacher_message"
KIND_STUDENT_MESSAGE = "student_message"

KINDS = (
    KIND_GOAL_ASSIGNED, KIND_GOAL_APPROVED, KIND_TEACHER_NOTE, KIND_KUDOS, KIND_ALERT,
    KIND_TASK_ASSIGNED, KIND_TEACHER_MESSAGE, KIND_STUDENT_MESSAGE,
)

# One person can be both. `gal` is a learner AND a teacher, and a bell that
# mixed "your goal was approved" into the teacher portal — or a class alert into
# the learner dashboard — is showing someone mail addressed to the other hat
# they wear. `recipient_role` was already stored; it now also SCOPES every read,
# so the portal you are standing in decides which inbox you see.
ROLE_LEARNER = "learner"
ROLE_TEACHER = "teacher"
ROLES = (ROLE_LEARNER, ROLE_TEACHER)


def _role_filter(role: Optional[str]) -> dict[str, Any]:
    """Mongo clause for one role's mail. Rows written before this field existed
    are learner mail — that is all the lane carried then — so the learner query
    also claims documents with no `recipient_role`."""
    if role is None:
        return {}
    if role == ROLE_LEARNER:
        return {"$or": [{"recipient_role": ROLE_LEARNER}, {"recipient_role": {"$exists": False}},
                        {"recipient_role": None}]}
    return {"recipient_role": role}


def _role_matches(row: dict[str, Any], role: Optional[str]) -> bool:
    """The same rule for the in-memory fallback store."""
    if role is None:
        return True
    stored = row.get("recipient_role") or ROLE_LEARNER
    return stored == role

_MAX_LIMIT = 100

# Fallback store when there is no database (dev box, tests).
_memory: dict[str, dict[str, Any]] = {}


def _collection():
    """Lazy import so the handle stays patchable — see the note in
    `teacher_alerts._collection`."""
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _store(document: dict[str, Any]) -> dict[str, Any]:
    handle = _collection()
    if handle is None:
        _memory[document["_id"]] = document
        return document
    try:
        await handle.update_one({"_id": document["_id"]}, {"$set": document}, upsert=True)
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ notification store failed: {type(exc).__name__}: {exc}")
        _memory[document["_id"]] = document
    return document


async def _load(notification_id: str) -> Optional[dict[str, Any]]:
    handle = _collection()
    if handle is None:
        return _memory.get(notification_id)
    try:
        return await handle.find_one({"_id": notification_id})
    except Exception:  # pragma: no cover
        return _memory.get(notification_id)


async def notify(
    recipient_id: str,
    kind: str,
    *,
    title_key: str,
    notification_id: str,
    params: Optional[dict[str, Any]] = None,
    body_key: Optional[str] = None,
    actions: Optional[list[dict[str, Any]]] = None,
    recipient_role: str = "learner",
    actor_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Create (or re-affirm) a notification and push it live.

    `notification_id` is required and must be deterministic for the underlying
    event — `goal_approved:{goal_id}` and so on. That is what makes the whole
    lane idempotent: approving a goal twice, or a retry after a timeout, cannot
    ring the bell twice. Returns None when the row already existed.
    """
    if kind not in KINDS:
        raise ValueError(f"unknown notification kind: {kind}")

    if await _load(notification_id) is not None:
        return None

    document = {
        "_id": notification_id,
        "recipient_id": recipient_id,
        "recipient_role": recipient_role,
        "actor_id": actor_id,
        "kind": kind,
        "title_key": title_key,
        "body_key": body_key,
        "params": params or {},
        # The deep link. Without it a notification is an announcement the user
        # then has to go and find the subject of.
        "actions": actions or [],
        "read_at": None,
        "dismissed_at": None,
        "created_at": _now(),
    }
    await _store(document)
    # Rides the connection the recipient already holds — learners subscribe to
    # their own `user:` topic through the coach stream.
    realtime.publish(f"user:{recipient_id}",
                     {"type": "notification", "notification": document})
    return document


async def list_for(
    recipient_id: str,
    *,
    unread_only: bool = False,
    include_dismissed: bool = False,
    limit: int = 30,
    role: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Newest first. Dismissed rows are hidden unless asked for — they still
    exist, and the panel can reveal them. `role` scopes the inbox to the portal
    the reader is standing in; None means both hats at once."""
    limit = max(1, min(limit, _MAX_LIMIT))
    query: dict[str, Any] = {"recipient_id": recipient_id, **_role_filter(role)}
    if unread_only:
        query["read_at"] = None
    if not include_dismissed:
        query["dismissed_at"] = None

    handle = _collection()
    if handle is None:
        rows = [
            row for row in _memory.values()
            if row.get("recipient_id") == recipient_id
            and _role_matches(row, role)
            and (not unread_only or row.get("read_at") is None)
            and (include_dismissed or row.get("dismissed_at") is None)
        ]
        return sorted(rows, key=lambda row: row.get("created_at") or "", reverse=True)[:limit]
    try:
        cursor = handle.find(query).sort("created_at", -1).limit(limit)
        return [row async for row in cursor]
    except Exception:  # pragma: no cover
        return []


async def unread_count(recipient_id: str, *, role: Optional[str] = None) -> int:
    """The bell badge, for one portal. Dismissed rows never count, read or not."""
    handle = _collection()
    if handle is None:
        return len([
            row for row in _memory.values()
            if row.get("recipient_id") == recipient_id
            and _role_matches(row, role)
            and row.get("read_at") is None and row.get("dismissed_at") is None
        ])
    try:
        return await handle.count_documents({
            "recipient_id": recipient_id, "read_at": None, "dismissed_at": None,
            **_role_filter(role),
        })
    except Exception:  # pragma: no cover
        return 0


async def _stamp(
    recipient_id: str, notification_ids: Optional[list[str]], field: str,
    *, role: Optional[str] = None,
) -> int:
    """Set `field` to now on the caller's own notifications.

    Ownership is re-checked against `recipient_id` on every row rather than
    trusted from the request: the id is guessable, and one user marking another
    user's notifications read (or dismissing an escalation) must be impossible.
    """
    at = _now()
    handle = _collection()
    if handle is None:
        touched = 0
        for row in _memory.values():
            if row.get("recipient_id") != recipient_id:
                continue
            if not _role_matches(row, role):
                continue
            if notification_ids is not None and row["_id"] not in notification_ids:
                continue
            if row.get(field) is not None:
                continue
            row[field] = at
            touched += 1
        return touched

    query: dict[str, Any] = {"recipient_id": recipient_id, field: None, **_role_filter(role)}
    if notification_ids is not None:
        query["_id"] = {"$in": notification_ids}
    try:
        result = await handle.update_many(query, {"$set": {field: at}})
        return int(result.modified_count)
    except Exception:  # pragma: no cover
        return 0


async def mark_read(
    recipient_id: str, notification_ids: list[str], *, role: Optional[str] = None,
) -> int:
    return await _stamp(recipient_id, notification_ids, "read_at", role=role)


async def mark_all_read(recipient_id: str, *, role: Optional[str] = None) -> int:
    """Scoped to the portal: "mark all read" in the teacher app must not silently
    clear the goal approvals waiting in the same person's learner bell."""
    return await _stamp(recipient_id, None, "read_at", role=role)


async def dismiss(
    recipient_id: str, notification_ids: list[str], *, role: Optional[str] = None,
) -> int:
    """Soft delete. The document is never removed — see the module docstring."""
    # Dismissing implies having seen it; leaving it unread would keep the badge
    # lit for a row the user has explicitly cleared.
    await _stamp(recipient_id, notification_ids, "read_at", role=role)
    return await _stamp(recipient_id, notification_ids, "dismissed_at", role=role)


async def dismiss_all(recipient_id: str, *, role: Optional[str] = None) -> int:
    """"Clear all" — a bulk soft delete, never a `delete_many`."""
    await _stamp(recipient_id, None, "read_at", role=role)
    return await _stamp(recipient_id, None, "dismissed_at", role=role)


async def ensure_indexes() -> None:
    handle = _collection()
    if handle is None:
        return
    for keys in ([("recipient_id", 1), ("created_at", -1)],
                 [("recipient_id", 1), ("recipient_role", 1), ("created_at", -1)],
                 [("recipient_id", 1), ("read_at", 1), ("dismissed_at", 1)]):
        try:
            await handle.create_index(keys)
        except Exception:  # pragma: no cover - best effort
            print(f"⚠️ notification index {keys} failed")


def reset_for_tests() -> None:
    _memory.clear()
