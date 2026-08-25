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
        # What the teacher gave with it, if anything (#467). Already granted by
        # the time this row exists, so the card reports a fact rather than a
        # promise — and the words stay the headline, the gift a footnote.
        "sparks": int(row.get("sparks") or 0),
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


# ── the child's half of the message channel ──────────────────────────────────
# Same shape as the teacher lane and the same service behind it. The learner is
# always the session, never a parameter — the only id in these paths is the
# teacher being written to, and `direct_messages.assert_pair` decides whether
# this child is allowed to write to them.


@router.get("/messages/{teacher_id}")
async def my_messages(
    response: Response,
    teacher_id: str = Path(max_length=120),
    session=Depends(current_user),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    from app.services import direct_messages

    learner_id = session["sub"]
    try:
        await direct_messages.assert_pair(
            teacher_id, learner_id, sender=direct_messages.SENDER_LEARNER)
    except direct_messages.DirectMessageError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code)

    rows = await direct_messages.list_thread(teacher_id, learner_id)
    return {"messages": [
        {
            "id": row["_id"],
            "sender": row.get("sender"),
            "text": row.get("text") or "",
            "created_at": row.get("created_at"),
            "read_at": row.get("read_at"),
        }
        for row in rows
    ]}


@router.post("/messages/{teacher_id}")
async def send_my_message(
    response: Response,
    data: dict,
    teacher_id: str = Path(max_length=120),
    session=Depends(current_user),
) -> dict[str, Any]:
    """The child writes back.

    Screened exactly as the teacher's side is, with one difference that matters:
    a message that trips the self-harm patterns is refused AND raises the
    existing urgent teacher alert. The words do not travel; the fact that a
    child wrote them does. That branch lives in `direct_messages`, not here, so
    it cannot be forgotten by a second caller.
    """
    response.headers.update(_NO_STORE)
    from app.services import direct_messages

    try:
        record = await direct_messages.send_message(
            sender=direct_messages.SENDER_LEARNER,
            teacher_id=teacher_id,
            learner_id=session["sub"],
            text=str(data.get("text") or ""),
            language=str(data.get("language") or "he"),
        )
    except direct_messages.DirectMessageError as exc:
        # A string detail is a moderation refusal; FastAPI's own 422 detail is
        # an array. The client branches on that to tell the two apart.
        raise HTTPException(status_code=exc.status_code, detail=exc.code)
    return {
        "id": record["_id"], "text": record["text"],
        "sender": record["sender"], "created_at": record["created_at"],
    }


@router.patch("/messages/{teacher_id}/read")
async def mark_my_messages_read(
    response: Response,
    teacher_id: str = Path(max_length=120),
    session=Depends(current_user),
) -> dict[str, Any]:
    response.headers.update(_NO_STORE)
    from app.services import direct_messages

    learner_id = session["sub"]
    try:
        await direct_messages.assert_pair(
            teacher_id, learner_id, sender=direct_messages.SENDER_LEARNER)
    except direct_messages.DirectMessageError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.code)
    changed = await direct_messages.mark_read(
        teacher_id, learner_id, reader=direct_messages.SENDER_LEARNER)
    return {"read": changed}


@router.get("/messages-unread")
async def my_messages_unread(response: Response, session=Depends(current_user)):
    """Per-teacher unread counts plus the total — the learner side's badge.

    One indexed read over the conversation counters; the nav polls this, so it
    must never open the threads themselves.
    """
    response.headers.update(_NO_STORE)
    from app.services import direct_messages

    unread = await direct_messages.unread_for_learner(session["sub"])
    return {"unread": unread, "total": sum(unread.values())}
