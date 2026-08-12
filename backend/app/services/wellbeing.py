"""A child said something that needs an adult. This is the record of it.

## Why this is a collection and not a field

The flag used to live only as an entry in ``brain.wellbeing_flags`` — an array
inside the learner's profile document, capped at a maximum, rewritten wholesale
by any writer that touches the key. That is a fine shape for *context the coach
reads* and a bad one for *the record of a safeguarding disclosure*: it can be
trimmed by a later flag, clobbered by a concurrent brain update, and it carries
no state anyone can change, so `resolved` and `acknowledged_by` were written
`False`/`None` at birth and nothing in the system ever set them.

The observable failure was this: a teacher's bell held a safety notification
from the 11th, and by the 12th the brain array was `[]` and the alert row was
gone. Clicking the notification could only ever land on a profile with nothing
on it. A notification that outlives its own evidence is the worst version of a
safeguarding feature — it tells an adult something happened and then refuses to
say what.

So the flag is a row of its own, with the id the notification already carries,
and it is never deleted. The brain array stays, because the coach's read scope
includes it and because `insights` and `moments` compute from it, but this is
the authority: closing a flag here also marks the brain's copy resolved, so the
"needs attention" strip stops shouting once a human has dealt with it.

## What a flag holds, and what it deliberately does not

It holds the child's own words, when, where they were written **in a form a
teacher can read** (a chat with Yuvi, a message that was blocked, the mapping
questionnaire), and what the child was told back — so an adult walking into the
conversation knows what the child has already heard.

It does not hold the surrounding conversation. That boundary is the same one
`safety._escalate_to_teachers` has always documented: the teacher gets the
sentence that triggered the flag, not the transcript.

## Who may touch it

Only teachers who teach the learner, checked at the route. Acknowledgement and
closing are **shared**: whoever was alerted sees who claimed it and who closed
it, because the failure this prevents is two teachers each assuming the other
went, and one teacher's private checkbox does not prevent it.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "wellbeing_flags"

#: Where the words were written. `classifier_outage` is not a child-distress
#: signal at all — it is the safety screen reporting its own downtime — and it
#: is kept out of the teacher-facing list entirely.
SOURCES = (
    "coach_chat", "competency_chat", "direct_message",
    "mapping_reflection", "classifier_outage",
)

STATUS_OPEN = "open"
STATUS_ACKNOWLEDGED = "acknowledged"
STATUS_CLOSED = "closed"

#: Why it was closed. The reason is the only signal that could ever tune the
#: detector, so closing without one is not offered.
CLOSE_REASONS = ("handled", "referred", "not_relevant")

#: What a teacher did about it. Free text beside it; this is the shape.
ACTION_KINDS = ("spoke", "called_home", "referred", "watching", "other")

MAX_TEXT = 1000
MAX_ACTIONS = 40


class WellbeingError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_flag_id() -> str:
    return f"wb_{datetime.now(timezone.utc).timestamp():.0f}_{uuid.uuid4().hex[:6]}"


def _collection():
    """Resolved per call, not bound at import.

    Same reason as `teacher_alerts`: a module-level `from … import` binds the
    getter where no test patch can reach it, and this module's tests must never
    be one connection string away from writing to a real child's record.
    """
    return _get_collection_named(COLLECTION)


async def record(
    learner_id: str,
    *,
    evidence: str,
    category: str = "distress",
    source: str = "mapping_reflection",
    language: str = "he",
    reply: str = "",
    delivered: bool = True,
    flag_id: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Write the flag. Never raises — a failure here must not block a child's reply.

    Returns the stored document, or None when there is no database. The caller
    (`safety.record_wellbeing_flag`) still writes the brain array either way, so
    a missing collection costs the teacher surface and not the record.
    """
    document = {
        "_id": flag_id or new_flag_id(),
        "learner_id": learner_id,
        "category": category,
        # The child's own words. Capped like the brain copy, for the same
        # reason: this is evidence, not a transcript store.
        "evidence": (evidence or "").strip()[:400],
        # What the child was told back, so the adult knows what they already heard.
        "reply": (reply or "").strip()[:600],
        "language": language,
        "source": source if source in SOURCES else "mapping_reflection",
        # False when the thing they wrote never reached anyone — a blocked
        # direct message. A teacher who assumes it was sent will ask the wrong
        # question.
        "delivered": bool(delivered),
        "at": _now(),
        "status": STATUS_OPEN,
        "notified": [],
        "acknowledged_by": None,
        "acknowledged_at": None,
        "closed_by": None,
        "closed_at": None,
        "close_reason": None,
        "close_note": None,
        "actions": [],
    }
    collection = _collection()
    if collection is None:
        return None
    try:
        await collection.insert_one(dict(document))
    except Exception as exc:  # pragma: no cover - never block the learner
        print(f"⚠️ wellbeing flag row not written: {type(exc).__name__}: {exc}")
        return None
    return document


async def note_notified(flag_id: str, teacher_ids: list[str]) -> None:
    """Who was told. The single most useful line when two teachers share a class."""
    collection = _collection()
    if collection is None or not teacher_ids:
        return
    try:
        await collection.update_one(
            {"_id": flag_id}, {"$set": {"notified": list(dict.fromkeys(teacher_ids))}})
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ wellbeing notified list not written: {type(exc).__name__}: {exc}")


async def get(flag_id: str) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is None:
        return None
    try:
        return await collection.find_one({"_id": flag_id})
    except Exception:  # pragma: no cover
        return None


async def list_for_learner(learner_id: str) -> list[dict[str, Any]]:
    """Every flag for this child, newest first — open and closed alike.

    Closed ones stay: "who dealt with this, when, and what did they decide" is
    the question a teacher asks in September about something that happened in
    May, and a record that disappears when it is handled cannot answer it.

    Flags recorded before this collection existed are read back out of the brain
    array and returned alongside, so history is not silently truncated on the
    day the store changed. They are projections — read-only, no id of their own
    — and they say so, so nothing offers to close one it cannot find.
    """
    rows: list[dict[str, Any]] = []
    collection = _collection()
    if collection is not None:
        try:
            cursor = collection.find({"learner_id": learner_id}).sort("at", -1)
            async for row in cursor:
                if row.get("category") == "review":
                    continue      # operational notice, not a child signal
                rows.append(row)
        except Exception:  # pragma: no cover
            rows = []

    known = {str(row.get("_id")) for row in rows}
    for legacy in await _from_brain(learner_id):
        if legacy["_id"] not in known:
            rows.append(legacy)

    rows.sort(key=lambda row: str(row.get("at") or ""), reverse=True)
    return rows


async def _from_brain(learner_id: str) -> list[dict[str, Any]]:
    """The old shape, projected into the new one."""
    try:
        from app.brain.repository import get_brain
        brain = await get_brain(learner_id)
    except Exception:  # pragma: no cover
        return []
    out: list[dict[str, Any]] = []
    for flag in (brain.get("wellbeing_flags") or []):
        if not isinstance(flag, dict) or flag.get("category") == "review":
            continue
        out.append({
            "_id": str(flag.get("id") or ""),
            "learner_id": learner_id,
            "category": flag.get("category") or "distress",
            "evidence": flag.get("evidence") or "",
            "reply": "",
            "language": flag.get("language") or "he",
            "source": flag.get("source") or "mapping_reflection",
            "delivered": True,
            "at": flag.get("at"),
            "status": STATUS_CLOSED if flag.get("resolved") else STATUS_OPEN,
            "notified": [],
            "acknowledged_by": flag.get("acknowledged_by"),
            "acknowledged_at": None,
            "closed_by": None, "closed_at": None,
            "close_reason": None, "close_note": None,
            "actions": [],
            # A row nothing can act on, and the UI must be able to tell.
            "legacy": True,
        })
    return out


async def _update(flag_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    collection = _collection()
    if collection is None:
        raise WellbeingError("unavailable")
    existing = await collection.find_one({"_id": flag_id})
    if existing is None:
        raise WellbeingError("not_found")
    document = {**existing, **changes, "updated_at": _now()}
    await collection.replace_one({"_id": flag_id}, document)
    return document


async def acknowledge(flag_id: str, teacher_id: str) -> dict[str, Any]:
    """"I am dealing with this." Claimed once — a second teacher does not overwrite
    the first, because the point is knowing who went."""
    existing = await get(flag_id)
    if existing is None:
        raise WellbeingError("not_found")
    if existing.get("status") == STATUS_CLOSED:
        raise WellbeingError("already_closed")
    if existing.get("acknowledged_by"):
        return existing
    return await _update(flag_id, {
        "status": STATUS_ACKNOWLEDGED,
        "acknowledged_by": teacher_id,
        "acknowledged_at": _now(),
    })


async def log_action(flag_id: str, teacher_id: str, *, kind: str, text: str = "") -> dict[str, Any]:
    """What was actually done. The handover record a school needs."""
    if kind not in ACTION_KINDS:
        raise WellbeingError("unknown_action")
    existing = await get(flag_id)
    if existing is None:
        raise WellbeingError("not_found")
    entry = {
        "id": f"wa_{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "text": (text or "").strip()[:MAX_TEXT],
        "by": teacher_id,
        "at": _now(),
    }
    actions = [*(existing.get("actions") or []), entry][-MAX_ACTIONS:]
    return await _update(flag_id, {"actions": actions})


async def close(flag_id: str, teacher_id: str, *, reason: str, note: str = "") -> dict[str, Any]:
    """Closing needs a reason, and it closes for everyone who was alerted.

    Also resolves the brain's copy: `insights` computes the "needs attention"
    strip from open flags there, and a flag a human has dealt with must stop
    ringing on every screen, not just this one.
    """
    if reason not in CLOSE_REASONS:
        raise WellbeingError("unknown_reason")
    existing = await get(flag_id)
    if existing is None:
        raise WellbeingError("not_found")
    document = await _update(flag_id, {
        "status": STATUS_CLOSED,
        "closed_by": teacher_id,
        "closed_at": _now(),
        "close_reason": reason,
        "close_note": (note or "").strip()[:MAX_TEXT],
    })
    await _resolve_in_brain(str(existing.get("learner_id") or ""), flag_id)
    return document


async def reopen(flag_id: str, teacher_id: str) -> dict[str, Any]:
    """Closed by mistake, or it happened again. Reopening is not a delete."""
    existing = await get(flag_id)
    if existing is None:
        raise WellbeingError("not_found")
    document = await _update(flag_id, {
        "status": STATUS_ACKNOWLEDGED if existing.get("acknowledged_by") else STATUS_OPEN,
        "closed_by": None, "closed_at": None,
        "close_reason": None, "close_note": None,
    })
    await _resolve_in_brain(str(existing.get("learner_id") or ""), flag_id, resolved=False)
    return document


async def _resolve_in_brain(learner_id: str, flag_id: str, *, resolved: bool = True) -> None:
    if not learner_id:
        return
    try:
        from app.brain.repository import apply_brain_updates, get_brain
        brain = await get_brain(learner_id)
        flags = list(brain.get("wellbeing_flags") or [])
        touched = False
        for flag in flags:
            if isinstance(flag, dict) and str(flag.get("id")) == flag_id:
                flag["resolved"] = resolved
                touched = True
        if touched:
            await apply_brain_updates(learner_id, {"wellbeing_flags": flags})
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ wellbeing brain mirror not updated: {type(exc).__name__}: {exc}")


async def ensure_indexes() -> None:
    collection = _collection()
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1), ("at", -1)])
        await collection.create_index([("status", 1)])
    except Exception as exc:  # pragma: no cover
        print(f"⚠️ wellbeing indexes: {type(exc).__name__}: {exc}")
