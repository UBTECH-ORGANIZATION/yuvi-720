"""The teacher↔learner message channel — screened before it is stored.

This replaces a safeguard rather than removing one. The messages screen used to
carry a comment saying a free-form 1:1 channel with a minor "needs a moderation
and retention policy this product does not claim to have". This file is that
policy, written down and enforced in one place.

**Deny before store.** A flagged message is not written, not delivered, and not
recoverable by the recipient. It returns 422 and leaves an audit row. The
alternative — store it, mark it hidden, let a human release it later — is how a
moderation queue becomes a place harmful messages sit addressed to a child.

**One chokepoint.** Every write goes through `send_message`, and `send_message`
is the only function that inserts into `dm_messages`. A second send path is how
the reference implementation ended up with a lane whose moderation result was
computed and then thrown away (`student_portal_routes.py:880-889`).

**Order of operations, which the reference gets wrong:**

    auth → membership (403) → moderate (422) → persist → notify

Membership BEFORE moderation, deliberately: a teacher with no link to this child
must be refused for not being their teacher, not told which of their words were
unacceptable. The reference's friend-DM send never checks membership at all.

**A cry for help is denied delivery and still reaches an adult.** A learner
message that trips the self-harm patterns does not go to their teacher as a
message — a child in distress should not be relying on their teacher happening
to open a thread — it goes through `safety.record_wellbeing_flag`, which is the
urgent teacher alert this product already has. The message does not pass; the
distress does.

**Text is stored, unlike notifications.** A message is a person's own words;
there is no key that renders them. The NOTIFICATION about a message still
carries no text (see `notify` below) — the bell says "you have a message", and
the words live in the thread behind the auth check.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.services import content_filter

CONVERSATIONS = "dm_conversations"
MESSAGES = "dm_messages"
MODERATION_EVENTS = "moderation_events"

MAX_MESSAGE = 1000

SENDER_TEACHER = "teacher"
SENDER_LEARNER = "learner"

# The reply the sender sees. A KEY, not a sentence: the recipient of this text is
# a person with a language preference, and the same rule the whole notification
# lane follows applies here.
MODERATION_KEY = "moderation.default"
MODERATION_KEY_DISTRESS = "moderation.distress"


class DirectMessageError(Exception):
    """Carries the HTTP status with it, so a route cannot map it to the wrong
    one — 403 and 422 mean very different things to the client here."""

    def __init__(self, code: str, status_code: int = 400):
        super().__init__(code)
        self.code = code
        self.status_code = status_code


def _collection(name: str):
    from app.brain.repository import _get_collection_named
    return _get_collection_named(name)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def conversation_id(teacher_id: str, learner_id: str) -> str:
    """Deterministic, and typed rather than sorted.

    The reference sorts participant ids because either of its two participants
    can be either role. Here one side is always the teacher, so the pair itself
    says which is which — and an id that encodes the roles cannot be built the
    wrong way round by a caller that passes the arguments in the wrong order.
    """
    return f"{teacher_id}:{learner_id}"


# ── moderation ───────────────────────────────────────────────────────────────

async def _record_moderation(
    user_id: str, text: str, context: str, category: Optional[str],
    source: str = "keywords",
) -> None:
    """The audit row for something a person was not allowed to send.

    Denied to the recipient, retained for review — a school that cannot see what
    its filter blocked cannot tell an over-tuned filter from a safe one. Capped
    at 500 characters: enough to judge, not a transcript.

    `source` names WHICH screen refused it. With two of them — a word list and a
    model — a review that cannot tell them apart cannot tell an over-tuned list
    from an over-eager judge, and both failure modes are fixed differently.
    """
    collection = _collection(MODERATION_EVENTS)
    if collection is None:
        return
    try:
        await collection.insert_one({
            "_id": f"mod_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "content": (text or "")[:500],
            "context": context,
            "category": category,
            "source": source,
            "action_taken": "blocked",
            "created_at": _now(),
        })
    except Exception as exc:      # pragma: no cover - auditing never blocks
        print(f"⚠️ moderation event not recorded: {type(exc).__name__}")


async def moderate_or_raise(
    text: str, user_id: str, context: str, *, sender: str, language: str = "he",
) -> str:
    """Screen one message, or refuse it. Returns the text that may be stored.

    Composes the screens this product has: `safety.strip_pii` redacts
    identifiers (a phone number in a school message is a policy problem even
    when the sentence is friendly), and `content_review.screen` judges the
    language — the word list first, free and deterministic, then a model on
    whatever it cleared. The second screen exists because the first is a list,
    and a list is always written after the harm it describes.

    Raises `DirectMessageError(422)` on a flag. The `code` is a locale key so the
    client renders the gentle version in the reader's own language.
    """
    from app.agents import safety
    from app.services import content_review

    body = (text or "").strip()
    if not body:
        raise DirectMessageError("message_required", 422)
    if len(body) > MAX_MESSAGE:
        raise DirectMessageError("message_too_long", 422)

    verdict = await content_review.screen(
        body, actor_id=user_id,
        actor_type="teacher" if sender == SENDER_TEACHER else "learner",
        language=language,
    )
    if verdict.flagged:
        await _record_moderation(user_id, body, context, verdict.category,
                                 verdict.source)
        # A learner in distress gets an adult, not a lecture. The alert is
        # raised here rather than by the caller so no send path can forget it.
        if content_filter.is_distress(verdict.category) and sender == SENDER_LEARNER:
            await safety.record_wellbeing_flag(
                user_id, body, language=language, source="direct_message",
                category="distress",
            )
            raise DirectMessageError(MODERATION_KEY_DISTRESS, 422)
        raise DirectMessageError(MODERATION_KEY, 422)

    # PII is redacted, not refused: the sentence is fine, one substring is not,
    # and bouncing the whole message would teach a teacher to stop writing.
    redacted, _ = safety.strip_pii(body)
    return redacted.strip()


# ── membership ───────────────────────────────────────────────────────────────

async def assert_pair(teacher_id: str, learner_id: str, *, sender: str) -> None:
    """Both directions of the same question, asked before anything is screened.

    The teacher side is the existing group join. The learner side is the same
    join read the other way: a child may write to a teacher who can already read
    their work, and to nobody else.
    """
    from app.brain import org

    if sender == SENDER_TEACHER:
        allowed = await org.teacher_can_access_learner(teacher_id, learner_id)
    else:
        allowed = teacher_id in (await org.teachers_for_learner(learner_id) or [])
    if not allowed:
        raise DirectMessageError("not_authorized", 403)


# ── the write ────────────────────────────────────────────────────────────────

async def send_message(
    *,
    sender: str,
    teacher_id: str,
    learner_id: str,
    text: str,
    language: str = "he",
) -> dict[str, Any]:
    """The only way a direct message is created."""
    if sender not in (SENDER_TEACHER, SENDER_LEARNER):
        raise DirectMessageError("unknown_sender", 400)

    author = teacher_id if sender == SENDER_TEACHER else learner_id
    recipient = learner_id if sender == SENDER_TEACHER else teacher_id

    await assert_pair(teacher_id, learner_id, sender=sender)
    body = await moderate_or_raise(
        text, author, "direct_message", sender=sender, language=language)

    thread = conversation_id(teacher_id, learner_id)
    message_id = f"dm_{uuid.uuid4().hex[:12]}"
    document = {
        "_id": message_id,
        "conversation_id": thread,
        "teacher_id": teacher_id,
        "learner_id": learner_id,
        "sender": sender,
        "text": body,
        "created_at": _now(),
        "read_at": None,
    }

    messages = _collection(MESSAGES)
    if messages is not None:
        await messages.insert_one(document)

    conversations = _collection(CONVERSATIONS)
    if conversations is not None:
        unread = "unread_learner" if sender == SENDER_TEACHER else "unread_teacher"
        await conversations.update_one(
            {"_id": thread},
            {
                "$set": {
                    "teacher_id": teacher_id,
                    "learner_id": learner_id,
                    "last_message": body[:200],
                    "last_message_at": document["created_at"],
                    "last_sender": sender,
                },
                "$inc": {unread: 1},
                "$setOnInsert": {"created_at": document["created_at"]},
            },
            upsert=True,
        )

    await _notify(sender, teacher_id, learner_id, recipient, message_id)
    return document


async def send_to_subgroup(
    *, teacher_id: str, subgroup_id: str, text: str, language: str = "he",
) -> dict[str, Any]:
    """One message from a teacher to every member of a sub-group.

    ## Fanned out, not shared

    Each member gets the message in their OWN thread with this teacher. There is
    deliberately no shared room: a channel where children read each other is a
    different product with a different safety model — peer moderation, a policy
    for what one child may say about another in front of the class, and a
    retention question about all of it. What a teacher asked for here is "say
    this to these six", and that is what this is. Every reply comes back
    privately, which is also the right default for "did you understand?".

    Every copy still goes through `send_message`, so membership is re-checked and
    the words are screened per recipient. That is a few redundant screens of the
    same sentence and it keeps the promise at the top of this file: one
    chokepoint, no second write path.

    A member who cannot be written to — they left the class since the group was
    drawn — is skipped and reported, never silently dropped. A refusal of the
    TEXT, though, fails the whole send: half a class hearing something the filter
    objected to for the other half is the worst of both outcomes.
    """
    from app.services import subgroups as subgroup_service

    # `members_of` is the gate every write that targets a sub-group already goes
    # through: it authorizes against the parent class AND resolves membership
    # against the live roster, so a child who left cannot be reached through a
    # list drawn in September.
    try:
        members = await subgroup_service.members_of(teacher_id, subgroup_id)
    except subgroup_service.SubgroupError:
        raise DirectMessageError("not_authorized", 403)
    if not members:
        raise DirectMessageError("no_members", 422)

    # Screened ONCE up front so a message the filter refuses is refused before
    # anybody has it. The per-recipient screen inside `send_message` still runs;
    # this one exists so the refusal is all-or-nothing.
    await moderate_or_raise(
        text, teacher_id, "subgroup_message", sender=SENDER_TEACHER, language=language)

    broadcast = f"bc_{uuid.uuid4().hex[:12]}"
    sent: list[str] = []
    skipped: list[str] = []
    for learner_id in members:
        try:
            record = await send_message(
                sender=SENDER_TEACHER, teacher_id=teacher_id,
                learner_id=learner_id, text=text, language=language,
            )
        except DirectMessageError as error:
            # 403 means this child is no longer reachable by this teacher. A 422
            # here cannot happen — the same text passed the screen a moment ago —
            # but if it somehow does it is still one child's copy, not the batch.
            skipped.append(learner_id)
            print(f"⚠️ subgroup message skipped {learner_id}: {error.code}")
            continue
        sent.append(learner_id)
        # Stamped after the fact rather than threaded through `send_message`:
        # the broadcast is a property of this send, and giving the single-message
        # path an optional group argument is how a chokepoint grows a bypass.
        messages = _collection(MESSAGES)
        if messages is not None:
            await messages.update_one(
                {"_id": record["_id"]},
                {"$set": {"broadcast_id": broadcast, "subgroup_id": subgroup_id}},
            )

    return {
        "broadcast_id": broadcast,
        "subgroup_id": subgroup_id,
        "text": text,
        "sent": sent,
        "skipped": skipped,
        "created_at": _now(),
    }


async def list_subgroup_broadcasts(
    teacher_id: str, subgroup_id: str, *, limit: int = 50,
) -> list[dict[str, Any]]:
    """What this teacher has sent to this sub-group, oldest first.

    Collapsed by `broadcast_id`: one send to six children is six rows in six
    threads and exactly one thing the teacher did.
    """
    collection = _collection(MESSAGES)
    if collection is None:
        return []
    rows = await collection.find({
        "teacher_id": teacher_id,
        "subgroup_id": subgroup_id,
        "broadcast_id": {"$ne": None},
    }).sort("created_at", -1).limit(limit * 40).to_list(length=limit * 40)

    by_broadcast: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = str(row.get("broadcast_id"))
        entry = by_broadcast.get(key)
        if entry is None:
            by_broadcast[key] = {
                "broadcast_id": key,
                "text": row.get("text") or "",
                "created_at": row.get("created_at"),
                "recipients": [row.get("learner_id")],
                # A broadcast is "read" when everyone it went to has read it —
                # the honest reading of a message addressed to a group.
                "unread": 0 if row.get("read_at") else 1,
            }
            continue
        entry["recipients"].append(row.get("learner_id"))
        if not row.get("read_at"):
            entry["unread"] += 1

    ordered = sorted(by_broadcast.values(), key=lambda row: str(row["created_at"] or ""))
    return ordered[-limit:]


async def _notify(
    sender: str, teacher_id: str, learner_id: str, recipient: str, message_id: str,
) -> None:
    """Bell + live nudge. Neither one carries the words.

    The notification lane stores `title_key` + params and renders client-side, so
    a message's text in a notification row would be the one string in the system
    frozen in the language it was written in — and, worse, readable from an inbox
    that does not re-check the thread's membership.
    """
    from app.services import notifications, realtime

    if sender == SENDER_TEACHER:
        kind, role, route = (
            notifications.KIND_TEACHER_MESSAGE, notifications.ROLE_LEARNER,
            "/student-dashboard/chat",
        )
        actor = teacher_id
        topic = f"learner:{learner_id}"
    else:
        kind, role, route = (
            notifications.KIND_STUDENT_MESSAGE, notifications.ROLE_TEACHER,
            f"/teacher/messages?student={learner_id}",
        )
        actor = learner_id
        topic = f"teacher:{teacher_id}"

    await notifications.notify(
        recipient,
        kind,
        # Deterministic, so a retried send cannot ring the same bell twice.
        notification_id=f"{kind}:{message_id}",
        title_key=f"notif.{kind}",
        params={},
        actions=[{"label_key": "notif.action.openMessages", "route": route}],
        actor_id=actor,
        recipient_role=role,
    )
    realtime.publish(topic, {"type": "direct_message", "message_id": message_id})


# ── the reads ────────────────────────────────────────────────────────────────

async def list_thread(
    teacher_id: str, learner_id: str, *, limit: int = 100,
) -> list[dict[str, Any]]:
    """One pair's messages, oldest first — the order a chat is read in."""
    collection = _collection(MESSAGES)
    if collection is None:
        return []
    rows = await collection.find(
        {"conversation_id": conversation_id(teacher_id, learner_id)}
    ).sort("created_at", -1).limit(limit).to_list(length=limit)
    return list(reversed(rows))


async def mark_read(teacher_id: str, learner_id: str, *, reader: str) -> int:
    """Everything the OTHER side sent is now read.

    Returns how many rows changed, so a caller can tell "nothing to do" from
    "no store" without reading the thread back.
    """
    if reader not in (SENDER_TEACHER, SENDER_LEARNER):
        raise DirectMessageError("unknown_sender", 400)
    collection = _collection(MESSAGES)
    if collection is None:
        return 0
    other = SENDER_LEARNER if reader == SENDER_TEACHER else SENDER_TEACHER
    result = await collection.update_many(
        {
            "conversation_id": conversation_id(teacher_id, learner_id),
            "sender": other,
            "read_at": None,
        },
        {"$set": {"read_at": _now()}},
    )

    conversations = _collection(CONVERSATIONS)
    if conversations is not None:
        field = "unread_teacher" if reader == SENDER_TEACHER else "unread_learner"
        await conversations.update_one(
            {"_id": conversation_id(teacher_id, learner_id)}, {"$set": {field: 0}})
    return getattr(result, "modified_count", 0) or 0


async def unread_for_teacher(teacher_id: str) -> dict[str, int]:
    """Per-learner unread counts, for the thread list's badges."""
    collection = _collection(CONVERSATIONS)
    if collection is None:
        return {}
    rows = await collection.find(
        {"teacher_id": teacher_id, "unread_teacher": {"$gt": 0}}
    ).to_list(length=200)
    return {row["learner_id"]: int(row.get("unread_teacher") or 0) for row in rows}


async def ensure_indexes() -> None:
    messages = _collection(MESSAGES)
    conversations = _collection(CONVERSATIONS)
    try:
        if messages is not None:
            await messages.create_index([("conversation_id", 1), ("created_at", -1)])
            await messages.create_index([("conversation_id", 1), ("sender", 1), ("read_at", 1)])
        if conversations is not None:
            await conversations.create_index([("teacher_id", 1), ("last_message_at", -1)])
            await conversations.create_index([("learner_id", 1), ("last_message_at", -1)])
    except Exception as exc:      # pragma: no cover
        print(f"⚠️ direct-message index setup skipped: {type(exc).__name__}")
