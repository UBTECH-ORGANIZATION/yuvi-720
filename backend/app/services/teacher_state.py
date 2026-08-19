"""Server-side UI state for a teacher — currently one thing: a mentoring draft.

The learner side has had this for a while (`learner_state.mentoring_draft`), and
it is why a child can close the composer mid-sentence and find their words again
on the next device. Teachers had nowhere equivalent to put one.

**Why not somewhere that already exists.** `users.preferences` holds teacher view
state (`teacher_group_id`, `teacher_roster_view`) and would have been the obvious
home, but it is a flat scalar model that round-trips through `GET /api/auth/me`
on every page load — a write-up with notes, a Q&A transcript and several goals
does not belong in the payload of every navigation. And `learner_state` simply
has no row for an account that is not a learner.

**Why not the browser.** `tasks/builderDraft.ts` keeps the task-builder draft in
`localStorage` with a documented rationale, so there is an in-repo precedent for
the other choice. The difference is what the text *is*: a half-typed form is the
browser's business, and a written record of a conversation with a child is not.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named  # shared Mongo client

COLLECTION = "teacher_state"

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "teacher_state.json"

# Unlike learner state, this field is rewritten on a 600 ms debounce while a
# teacher types. A bound stops a wedged client from growing one document without
# limit; 32 KB is far more than a conversation write-up and far less than a
# problem. Rejected loudly rather than truncated: silently storing half a
# teacher's notes is worse than telling them the save failed.
MAX_DRAFT_BYTES = 32 * 1024

# The only key a client may write. Everything else on this document is the
# server's, in the same spirit as `learner_state`'s allow-list.
_ALLOWED = {"mentoring_draft"}


class TeacherStateError(ValueError):
    """Carries a machine-readable `code` the route turns into a status."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def normalize_teacher_id(value: Optional[str]) -> str:
    """Sanitize a teacher id for use as a document key.

    Raises rather than substituting a default, for the reason
    `normalize_learner_id` documents: a mis-wired route must fail loudly
    instead of quietly reading and writing somebody else's account.
    """
    safe = "".join(ch for ch in (value or "").strip() if ch.isalnum() or ch in {"-", "_", "@", "."})
    if not safe:
        raise ValueError("teacher_id is required")
    return safe


def _empty_state(teacher_id: str) -> dict[str, Any]:
    return {"teacher_id": teacher_id, "mentoring_draft": None}


def _public_state(document: Optional[dict[str, Any]], teacher_id: str) -> dict[str, Any]:
    state = _empty_state(teacher_id)
    if document:
        for key in state:
            if key in document:
                state[key] = document[key]
    return state


def _read_fallback() -> dict[str, Any]:
    try:
        if _FALLBACK.exists():
            return json.loads(_FALLBACK.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ teacher state fallback read failed: {exc}")
    return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ teacher state fallback write failed: {exc}")


async def get_teacher_state(teacher_id: Optional[str]) -> dict[str, Any]:
    safe_id = normalize_teacher_id(teacher_id)
    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            document = await collection.find_one({"_id": safe_id})
            return _public_state(document, safe_id)
        except Exception as exc:
            print(f"⚠️ teacher state read failed, using fallback: {exc}")
    return _public_state(_read_fallback().get(safe_id), safe_id)


async def update_teacher_state(
    teacher_id: Optional[str], updates: dict[str, Any]
) -> dict[str, Any]:
    safe_id = normalize_teacher_id(teacher_id)
    changes = {key: value for key, value in (updates or {}).items() if key in _ALLOWED}

    draft = changes.get("mentoring_draft")
    if draft is not None:
        try:
            size = len(json.dumps(draft, ensure_ascii=False).encode("utf-8"))
        except (TypeError, ValueError):
            raise TeacherStateError("draft_not_serializable")
        if size > MAX_DRAFT_BYTES:
            raise TeacherStateError("draft_too_large")

    changes["teacher_id"] = safe_id
    changes["updated_at"] = datetime.now(timezone.utc).isoformat()

    collection = _get_collection_named(COLLECTION)
    if collection is not None:
        try:
            await collection.update_one({"_id": safe_id}, {"$set": changes}, upsert=True)
            return await get_teacher_state(safe_id)
        except Exception as exc:
            print(f"⚠️ teacher state write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(safe_id) or _empty_state(safe_id)
    current.update(changes)
    data[safe_id] = current
    _write_fallback(data)
    return _public_state(current, safe_id)
