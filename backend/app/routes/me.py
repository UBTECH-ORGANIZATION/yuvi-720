"""Learner-facing reads of the learner's own org position.

Why this exists: `StudentConnectionsPane` used to derive "my teachers" from
`listMentoring('learner')` — i.e. a child only *had* a teacher once that teacher
had already documented a conversation. A newly enrolled learner saw an empty
pane and no way to tell whether that meant "no teacher" or "nothing written yet".

Now it reads the actual roster, so the answer is true on day one.

Scope: strictly the caller's own row. There is no `learner_id` parameter — the
learner is resolved from the session — so this cannot be pointed at another
child.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Response

from app.auth.dependencies import current_user
from app.auth.repository import get_user_by_id
from app.brain import org
from app.services import org_repository

router = APIRouter(prefix="/api/me", tags=["me"])

_NO_STORE = {"Cache-Control": "private, no-store"}


@router.get("/teachers")
async def my_teachers(response: Response, session=Depends(current_user)) -> dict[str, Any]:
    """Every teacher who can currently read this learner, and via which group.

    The group is included deliberately: the teacher↔learner relationship is a
    join through a group (A9), and showing the child *why* someone can see their
    work is the same explainability contract the teacher side is held to.
    """
    response.headers.update(_NO_STORE)
    learner_id = session["sub"]

    group_ids = await org.groups_for_learner(learner_id)

    teachers: dict[str, dict[str, Any]] = {}
    for group_id in group_ids:
        group = await org_repository.get_group(group_id) or {}
        for link in await org_repository.list_teacher_links(group_id=group_id):
            teacher_id = link["teacher_id"]
            entry = teachers.setdefault(teacher_id, {
                "teacher_id": teacher_id,
                "display_name": None,
                "groups": [],
            })
            entry["groups"].append({
                "group_id": group_id,
                "name": group.get("name"),
                "subject": group.get("subject"),
            })

    for teacher_id, entry in teachers.items():
        document = await get_user_by_id(teacher_id)
        # Fall back to the id rather than dropping the row: a teacher whose user
        # document is missing still holds read access, and hiding that would
        # make this pane quietly wrong in exactly the way it used to be.
        entry["display_name"] = (document or {}).get("display_name") or teacher_id

    ordered = sorted(teachers.values(), key=lambda row: str(row["display_name"]))
    return {"teachers": ordered}


@router.get("/kudos/pending")
async def pending_kudos(response: Response, session=Depends(current_user)) -> dict[str, Any]:
    """The oldest undelivered מילה טובה for the caller, if any.

    Reading it here rather than having the coach speak it is a deliberate change
    of medium. Praise from a named adult is not a tutoring turn: routed through
    the coach it opened a fresh conversation, arrived in Yuvi's paraphrase, and
    scrolled away like any other message. It is now a card the child has to
    acknowledge, carrying the teacher's own words.

    The security property that mattered stands: the client still cannot AUTHOR
    kudos. It reads what a teacher stored, addressed to this learner, resolved
    from the session — never from a parameter.
    """
    response.headers.update(_NO_STORE)
    from app.services import kudos as kudos_service

    row = await kudos_service.pending_for(session["sub"])
    if not row:
        return {"kudos": None}

    teacher = await get_user_by_id(row.get("teacher_id") or "") or {}
    return {"kudos": {
        "id": row["_id"],
        "message": row.get("message") or "",
        "created_at": row.get("created_at"),
        # The child's own teacher, by name. This is the one relationship where
        # the name is the point — "someone" noticing is not the same as "המורה
        # שלך" noticing.
        "teacher_name": teacher.get("display_name") or None,
    }}


@router.post("/kudos/{kudos_id}/ack")
async def acknowledge_kudos(
    response: Response,
    kudos_id: str = Path(max_length=120),
    session=Depends(current_user),
) -> dict[str, Any]:
    """Mark one kudos as delivered — the child has read it and pressed OK.

    Ownership is re-checked against the session: a guessable id must not let one
    learner clear another's praise before they ever see it.
    """
    response.headers.update(_NO_STORE)
    from app.services import kudos as kudos_service

    delivered = await kudos_service.acknowledge(session["sub"], kudos_id)
    if delivered is None:
        raise HTTPException(status_code=404, detail="kudos_not_found")
    return {"acknowledged": True, "id": kudos_id}
