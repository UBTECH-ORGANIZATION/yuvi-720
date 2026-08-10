"""Teacher-authored insights about a learner (F6 student §3).

"המערכת תאפשר למורה להזין תובנות שלו על התלמיד (חוזקות/חולשות/אתגרים
ספציפיים) שיכללו בפרופיל הלומד" — so a teacher note is not a sticky on the
dashboard: it is written into the learner profile and mirrored into
`brain.strengths` / `brain.challenges` with `source: "teacher"`.

Three visibilities, and the distinction matters:

* ``private``  — teacher analytics only. Never shown to the learner, never sent
  to any agent.
* ``shared``   — the learner sees it on their own profile.
* ``coach``    — additionally appended to ``brain.teacher_directives``, which is
  already inside the Coach's read scope. That means the note **changes what Yuvi
  says to the child**. It is opt-in per note and never the default: steering a
  child's AI companion has to be a decision, not a side effect of typing.

Writes go through the non-LLM lane (`apply_brain_updates`), the same path as
`teacher_insights.add_directive`. Nothing here is model-generated.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain

COLLECTION = "teacher_insights"

KINDS = ("strength", "weakness", "challenge", "note")
VISIBILITIES = ("private", "shared", "coach")

# Mirrors are capped so a chatty term never crowds the profile out of context.
MAX_MIRRORED = 12
MAX_DIRECTIVES = 20


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fallback_store() -> dict[str, list[dict[str, Any]]]:
    # Insights are teacher-authored prose; losing them to a missing Mongo would
    # be worse than refusing the write, so there is no JSON fallback here — the
    # caller sees the failure.
    raise RuntimeError("teacher_insights requires a database connection")


async def create(
    *,
    learner_id: str,
    teacher_id: str,
    kind: str,
    text: str,
    subject: Optional[str] = None,
    visibility: str = "private",
) -> dict[str, Any]:
    if kind not in KINDS:
        raise ValueError(f"unknown insight kind: {kind!r}")
    if visibility not in VISIBILITIES:
        raise ValueError(f"unknown visibility: {visibility!r}")
    body = (text or "").strip()
    if not body:
        raise ValueError("text_required")

    document = {
        "_id": f"ti_{uuid.uuid4().hex[:12]}",
        "learner_id": learner_id,
        "teacher_id": teacher_id,
        "kind": kind,
        "text": body[:2000],
        "subject": subject,
        "visibility": visibility,
        "deleted": False,
        "created_at": _now(),
        "updated_at": _now(),
    }

    collection = _get_collection_named(COLLECTION)
    if collection is None:
        _fallback_store()
    await collection.insert_one(dict(document))

    await _mirror_into_brain(learner_id)

    if visibility == "shared":
        # The A10 contract: a note the teacher chose to share reaches the
        # student's bell, not just the brain mirror they might never open.
        # `shared` only — `private` is teacher analytics, and a `coach`
        # directive steers Yuvi, where a bell row reading "the teacher told
        # Yuvi something about you" would turn a steering lane into
        # surveillance-by-notification.
        from app.services import notifications

        try:
            await notifications.notify(
                learner_id,
                notifications.KIND_TEACHER_NOTE,
                # Deterministic per insight: a retry cannot ring twice.
                notification_id=f"teacher_note:{document['_id']}",
                title_key="notif.teacherNote.shared",
                params={"text": body[:140]},
                actions=[{"label_key": "notif.teacherNote.open",
                          "route": "/student-dashboard", "params": {}}],
                actor_id=teacher_id,
                recipient_role="learner",
            )
        except Exception as exc:      # pragma: no cover — the note is saved;
            # a failed bell must not roll back teacher-authored prose.
            print(f"⚠️ teacher note notification skipped: {type(exc).__name__}")

    return document


async def list_for(
    learner_id: str, *, teacher_id: Optional[str] = None, include_deleted: bool = False
) -> list[dict[str, Any]]:
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return []
    query: dict[str, Any] = {"learner_id": learner_id}
    if teacher_id:
        query["teacher_id"] = teacher_id
    if not include_deleted:
        query["deleted"] = False
    rows = await collection.find(query).to_list(length=200)
    rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    return rows


async def list_visible_to_learner(learner_id: str) -> list[dict[str, Any]]:
    """Only what the teacher chose to share — `private` never leaves the portal."""
    return [
        row for row in await list_for(learner_id)
        if row.get("visibility") in ("shared", "coach")
    ]


async def soft_delete(insight_id: str, *, learner_id: str) -> bool:
    """Soft delete, then re-mirror so the profile stops carrying it.

    Kept rather than removed: a teacher's read of a child is part of the record
    of how that child was taught.
    """
    collection = _get_collection_named(COLLECTION)
    if collection is None:
        return False
    result = await collection.update_one(
        {"_id": insight_id, "learner_id": learner_id},
        {"$set": {"deleted": True, "updated_at": _now()}},
    )
    if result.matched_count:
        await _mirror_into_brain(learner_id)
        return True
    return False


async def _mirror_into_brain(learner_id: str) -> None:
    """Project live teacher insights into the learner profile.

    Rebuilt from the store on every change rather than appended to, so a
    soft-deleted insight actually disappears from the profile instead of
    lingering as an orphan the teacher can no longer reach.
    """
    rows = await list_for(learner_id)
    brain = await get_brain(learner_id)

    def _mirror(target_kinds: tuple[str, ...]) -> list[dict[str, Any]]:
        return [
            {
                "label": row["text"][:180],
                "source": "teacher",
                "teacher_id": row["teacher_id"],
                "insight_id": row["_id"],
                "subject": row.get("subject"),
                "at": row["created_at"],
            }
            for row in rows if row["kind"] in target_kinds
        ][:MAX_MIRRORED]

    def _keep_system(field: str) -> list[dict[str, Any]]:
        return [
            entry for entry in (brain.get(field) or [])
            if not (isinstance(entry, dict) and entry.get("source") == "teacher")
        ]

    updates: dict[str, Any] = {
        "strengths": (_keep_system("strengths") + _mirror(("strength",)))[-MAX_MIRRORED:],
        "challenges": (
            _keep_system("challenges") + _mirror(("weakness", "challenge"))
        )[-MAX_MIRRORED:],
    }

    # Only `coach`-visibility notes reach the agent-readable directive list.
    directives = [
        entry for entry in (brain.get("teacher_directives") or [])
        if not (isinstance(entry, dict) and entry.get("origin") == "teacher_insight")
    ]
    for row in rows:
        if row.get("visibility") != "coach":
            continue
        directives.append({
            "id": f"td_{row['_id']}",
            "text": row["text"][:400],
            "scope": row.get("subject"),
            "priority": "normal",
            "author": "teacher",
            "origin": "teacher_insight",
            "teacher_id": row["teacher_id"],
            "visible_to_learner": True,
            "created_at": row["created_at"],
            "expires_at": None,
        })
    updates["teacher_directives"] = directives[-MAX_DIRECTIVES:]

    await apply_brain_updates(learner_id, updates)


async def ensure_indexes() -> None:
    """Back the one query this collection actually serves.

    `list_for` filters on `learner_id` (plus `teacher_id` and `deleted`), and it
    runs on every open of a student's Notes tab. Without an index that is a full
    scan of every note ever written by every teacher in the deployment — cheap
    today, quadratic by design.
    """
    handle = _get_collection_named(COLLECTION)
    if handle is None:
        return
    for keys in ([("learner_id", 1), ("deleted", 1)], [("teacher_id", 1)]):
        try:
            await handle.create_index(keys)
        except Exception as exc:      # pragma: no cover - best effort
            print(f"⚠️ teacher_insights index {keys} failed: {type(exc).__name__}")
