"""Teacher praise, delivered by Yuvi in the kid's own chat (A11 #4).

The emotional loop no other supplier builds: a teacher notices something real,
and the child is told *inside the companion they already talk to* — rather than
in a portal they would have to go looking for.

It arrives as a CARD in the chat, not as a coach turn. Routed through the coach
the praise opened a fresh conversation, reached the child in Yuvi's paraphrase
rather than their teacher's words, and scrolled away like any other message.
The card carries the teacher's own sentence and waits to be acknowledged.

**The teacher's words are authoritative and the client cannot author them.**
The praise is stored here and served back to the learner it is addressed to,
resolved from the session. A client can read its own kudos and acknowledge it;
it can never originate a message attributed to a teacher.

Delivery is once: `acknowledge` stamps `delivered_at`, so a reload cannot show a
child the same praise twice, and the teacher's thread flips to "delivered" the
moment it is actually read.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

COLLECTION = "teacher_kudos"

MAX_MESSAGE = 400


class KudosError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _collection():
    """Lazy, so tests can patch the accessor rather than a bound module global."""
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def send_kudos(
    teacher_id: str,
    learner_id: str,
    message: str,
    *,
    moment: Optional[dict[str, Any]] = None,
    language: str = "he",
    sparks: int = 0,
    draft_id: Optional[str] = None,
) -> dict[str, Any]:
    """Queue praise for Yuvi to deliver, and ring the learner's bell.

    `moment` is the thing being praised — a moments-feed row or a goal — kept so
    the record says what the teacher was looking at, not just what they typed.

    `sparks` is an optional gift riding the good word (#467), granted only once
    the words have passed every screen below: a sentence the moderator refuses
    is never delivered, and must not pay either. `draft_id` is the composer's
    idempotency key — a double-clicked send mints a second kudos row, so the
    grant is keyed on the draft instead and pays exactly once.
    """
    from app.agents import safety
    from app.brain import org
    from app.services import notifications, realtime

    if not await org.teacher_can_access_learner(teacher_id, learner_id):
        raise KudosError("not_authorized")

    text = (message or "").strip()[:MAX_MESSAGE]
    if not text:
        raise KudosError("message_required")

    # The teacher's words reach a child through the companion, so they pass the
    # same output screen as anything else Yuvi says.
    screened = safety.screen_output(text, language)
    text = (getattr(screened, "text", None) or text).strip()

    # ...and the same content screen a direct message passes. `screen_output` is
    # PII redaction only — it has never judged what the sentence SAYS. This is
    # free-text an adult writes into a child's chat, which is the one place in
    # the product where "the sender is a teacher" is the weakest argument for
    # skipping a check, not the strongest.
    from app.services import content_review

    verdict = await content_review.screen(
        text, actor_id=teacher_id, actor_type="teacher", language=language)
    if verdict.flagged:
        raise KudosError("moderation")

    kudos_id = f"kudos_{uuid.uuid4().hex[:10]}"

    # The gift is granted BEFORE the row is written, so a wallet failure means
    # no praise claiming sparks that were never paid. `granted` is what actually
    # landed — the card and the notification both speak from it, never from what
    # was requested, so a capped or duplicate grant cannot be announced as a
    # payment the child did not receive.
    granted = 0
    if sparks and draft_id:
        from app.services import rewards

        outcome = await rewards.grant_teacher_kudos(
            learner_id, draft_id=draft_id, amount=sparks, teacher_id=teacher_id)
        granted = int(outcome.get("granted") or 0)

    document = {
        "_id": kudos_id,
        "teacher_id": teacher_id,
        "learner_id": learner_id,
        "message": text,
        "moment": moment or {},
        "language": language,
        "sparks": granted,
        "created_at": _now(),
        "delivered_at": None,
    }

    collection = _collection()
    if collection is not None:
        await collection.insert_one(document)

    # The bell, so it survives being offline — the chat delivery needs the kid
    # to be there, the notification does not.
    await notifications.notify(
        learner_id,
        notifications.KIND_KUDOS,
        notification_id=f"kudos:{kudos_id}",
        title_key=("notif.kudos.receivedWithSparks" if granted
                   else "notif.kudos.received"),
        params={"message": text, "sparks": granted},
        actions=[{
            # Opens the chat and shows the card — the notification is the way
            # back to praise that arrived while the child was offline.
            "label_key": "notif.action.openKudos",
            "route": "/student-dashboard?kudos=1",
        }],
        actor_id=teacher_id,
        recipient_role="learner",
    )

    # And a nudge, so the card appears immediately if they are in the app right
    # now. The signal says a kudos exists; it never carries the words.
    realtime.publish(f"learner:{learner_id}", {"type": "kudos", "kudos_id": kudos_id})

    return document


async def send_kudos_to_subgroup(
    teacher_id: str,
    subgroup_id: str,
    message: str,
    *,
    language: str = "he",
    sparks: int = 0,
    draft_id: Optional[str] = None,
) -> dict[str, Any]:
    """One good word — and optionally one gift each — to every member of a group.

    Fanned out through `send_kudos` per child rather than written in a batch, so
    membership, the PII screen and the moderation screen are all re-checked per
    recipient. That is a few redundant screens of the same sentence and it keeps
    the one chokepoint honest — the same trade `direct_messages.send_to_subgroup`
    makes, and for the same reason.

    A child who left the class since the group was drawn is skipped and
    reported, never silently dropped. The GRANT is keyed per child
    (`{draft_id}:{learner_id}`), so one member failing cannot double-pay another
    on a retry, and a resend of the same draft pays nobody twice.
    """
    from app.services import subgroups as subgroup_service

    # `members_of` is the authorization: a teacher who may not see the group
    # cannot get its member list.
    try:
        members = await subgroup_service.members_of(teacher_id, subgroup_id)
    except Exception:
        raise KudosError("not_authorized")
    if not members:
        raise KudosError("no_members")

    sent: list[str] = []
    skipped: list[str] = []
    granted_total = 0
    for learner_id in members:
        try:
            record = await send_kudos(
                teacher_id, learner_id, message,
                language=language, sparks=sparks,
                draft_id=f"{draft_id}:{learner_id}" if draft_id else None,
            )
        except KudosError as error:
            # A refusal of the TEXT would refuse it for everyone, on the first
            # member, before anyone has it — which is the outcome we want. A
            # per-child failure (they left the class) is one copy, not the batch.
            if error.code == "moderation" and not sent:
                raise
            skipped.append(learner_id)
            print(f"⚠️ subgroup kudos skipped {learner_id}: {error.code}")
            continue
        sent.append(learner_id)
        granted_total += int(record.get("sparks") or 0)

    return {
        "subgroup_id": subgroup_id,
        "sent": sent,
        "skipped": skipped,
        "sparks_each": sparks if granted_total else 0,
        "sparks_total": granted_total,
    }


async def pending_for(learner_id: str) -> Optional[dict[str, Any]]:
    """The oldest undelivered kudos for this learner, if any."""
    collection = _collection()
    if collection is None:
        return None
    rows = await collection.find(
        {"learner_id": learner_id, "delivered_at": None}
    ).sort("created_at", 1).limit(1).to_list(length=1)
    return rows[0] if rows else None


async def acknowledge(learner_id: str, kudos_id: str) -> Optional[dict[str, Any]]:
    """Mark one kudos delivered because the child read it and pressed OK.

    Scoped to the learner it was addressed to — the id travels to the client, so
    ownership is a filter in the query, not an assumption. Idempotent: pressing
    OK twice (or a retry after a dropped response) is a no-op, so the card never
    reappears and the teacher's thread never flips back to "waiting".
    """
    collection = _collection()
    if collection is None:
        return None
    row = await collection.find_one({"_id": kudos_id, "learner_id": learner_id})
    if row is None:
        return None
    if row.get("delivered_at") is None:
        await collection.update_one(
            {"_id": kudos_id, "learner_id": learner_id, "delivered_at": None},
            {"$set": {"delivered_at": _now()}},
        )
    return row


async def list_for_learner(learner_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
    collection = _collection()
    if collection is None:
        return []
    return await collection.find({"learner_id": learner_id}) \
        .sort("created_at", -1).limit(limit).to_list(length=limit)


async def ensure_indexes() -> None:
    collection = _collection()
    if collection is None:
        return
    try:
        await collection.create_index([("learner_id", 1), ("delivered_at", 1)])
        await collection.create_index([("teacher_id", 1), ("created_at", -1)])
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ kudos index setup skipped: {type(exc).__name__}")
