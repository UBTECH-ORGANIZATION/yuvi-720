"""Counting whether a platform-action goal actually happened.

A Yuvi-suggested goal carries ``action: {"kind", "target"}`` — one of the
observable platform actions the suggestion prompt is allowed to offer (use a
hint, ask Yuvi, retry after a wrong answer, practise, complete an assigned
task, learn on more days). This module turns that promise into the numbers a
teacher reads next to the goal: how many times the action happened inside the
goal's window, and whether the target was reached.

The count is evidence, not authority: it never completes the goal by itself.
Completion stays the child's claim and the teacher's approval — the number
sits beside them so the approval is informed rather than taken on faith.

Sources, one read each per learner (the fold over goals is pure Python):
- ``learner_activity`` rows — hints (`hint`, `content_hint`), question-scoped
  Yuvi chat (`yuvi_chat`), completed assigned tasks (`task`).
- ``learning_events`` — answered/attempted verbs for practice, retries after
  a wrong answer, and which days were active at all.
- ``agent_messages`` — the learner's own messages to Yuvi, counted when the
  durable per-question mirror would undercount free companion chat.
- ``learner_signals`` `question_quality` rows — the per-message label the
  learning chat already stores (#451). For ``ask_yuvi`` the label IS the
  judgement (#462): a goal to "talk with Yuvi" is met by substantive
  questions, not by message volume — twenty empty messages count as zero.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# The closed vocabulary. It must stay in step with the actions
# `_TEACHER_GOAL_SYSTEM` (mentoring_assist) is allowed to suggest.
ACTION_KINDS = {
    "use_hint",
    "ask_yuvi",
    "retry_after_wrong",
    "practice",
    "complete_task",
    "active_days",
}

_TARGET_CAP = 50
_ANSWER_VERBS = {"answered", "attempted"}

# The labels that make a message to Yuvi count toward a conversational goal
# (#462). Reut's line — "צריך שהשאלות עם יובי יהיו ענייניות ולא סתם הודעות" —
# draws the boundary: a real question about the material counts, whichever
# depth it has; asking to be handed the answer and off-topic chatter do not.
# The taxonomy is #451's closed enum; only ask_yuvi consumes it today, but the
# split lives here so the next qualitative action kind reuses it unchanged.
SUBSTANTIVE_LABELS = {"procedural", "verification", "conceptual", "self_diagnostic"}


def normalize_action(data: Any) -> Optional[dict[str, Any]]:
    """Validate an action spec from the model or the client.

    Returns ``{"kind", "target"}`` or None. Never trusts the input shape: an
    unknown kind or a senseless target means "not trackable" rather than an
    error, because a goal without an action is still a perfectly good goal.
    """
    if not isinstance(data, dict):
        return None
    kind = str(data.get("kind") or "").strip()
    if kind not in ACTION_KINDS:
        return None
    try:
        target = int(data.get("target") or 0)
    except (TypeError, ValueError):
        return None
    if target < 1:
        return None
    if kind == "active_days":
        target = min(target, 7)
    return {"kind": kind, "target": min(target, _TARGET_CAP)}


# ── the window ───────────────────────────────────────────────────────────────

def _window(goal: dict[str, Any], assigned_at: str) -> tuple[str, str]:
    """[assigned, deadline+1d) — or now when there is no deadline yet.

    The deadline is a date; the child owns that whole day, so the window
    closes at the *end* of it. Everything is compared as ISO strings, which
    ordering makes safe.
    """
    start = assigned_at or ""
    deadline = str(goal.get("deadline") or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    if not deadline:
        return start, now
    try:
        end = (datetime.fromisoformat(deadline) + timedelta(days=1)).isoformat()
    except ValueError:
        return start, now
    return start, min(end, now)


def _in(at: Any, start: str, end: str) -> bool:
    stamp = str(at or "")
    return bool(stamp) and start <= stamp < end


# ── the pure fold ────────────────────────────────────────────────────────────

def _count(kind: str, start: str, end: str,
           activity: list[dict[str, Any]],
           events: list[dict[str, Any]],
           yuvi_messages: list[str]) -> int:
    if kind == "use_hint":
        return sum(1 for row in activity
                   if row.get("kind") in ("hint", "content_hint")
                   and _in(row.get("at"), start, end))

    if kind == "ask_yuvi":
        # Two mirrors of the same behaviour: question-scoped chat lands in
        # learner_activity, free companion chat only in agent_messages. Take
        # the larger rather than the sum — they overlap, and overstating a
        # child's effort to a teacher is worse than understating it.
        scoped = sum(1 for row in activity
                     if row.get("kind") == "yuvi_chat"
                     and _in(row.get("at"), start, end))
        free = sum(1 for at in yuvi_messages if _in(at, start, end))
        return max(scoped, free)

    if kind == "complete_task":
        return sum(1 for row in activity
                   if row.get("kind") == "task"
                   and _in(row.get("at"), start, end))

    answers = [event for event in events
               if event.get("verb") in _ANSWER_VERBS
               and _in(event.get("occurred_at") or event.get("stored_at"),
                       start, end)]

    if kind == "practice":
        return len(answers)

    if kind == "active_days":
        return len({str(event.get("occurred_at") or event.get("stored_at"))[:10]
                    for event in answers})

    if kind == "retry_after_wrong":
        # A retry is a later answer on the same question after a miss. Walk
        # oldest-first; a second wrong answer counts too — trying again is the
        # behaviour the goal asks for, succeeding is the next goal.
        ordered = sorted(
            answers,
            key=lambda e: str(e.get("occurred_at") or e.get("stored_at") or ""))
        missed: set[str] = set()
        retries = 0
        for event in ordered:
            key = "|".join(str(event.get(part) or "") for part in
                           ("launch", "sub_item_id", "question_id"))
            if key in missed:
                retries += 1
            if (event.get("result") or {}).get("success") is False:
                missed.add(key)
        return retries

    return 0


def _quality_verdict(start: str, end: str, chatted: int, target: int,
                     quality_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """The judgement behind an ``ask_yuvi`` count (#462), from stored labels.

    ``substantive`` is the number the goal is measured by. ``uncertain`` marks
    the one honest gap: the child visibly chatted enough, but the messages
    carry no labels (sent before the classifier existed, or it failed) — that
    goal needs the teacher's eye, not a silent verdict either way.
    """
    labels: dict[str, int] = {}
    for row in quality_rows:
        if not _in(row.get("at"), start, end):
            continue
        label = str((row.get("meta") or {}).get("label") or "")
        if label:
            labels[label] = labels.get(label, 0) + 1
    substantive = sum(count for label, count in labels.items()
                      if label in SUBSTANTIVE_LABELS)
    # The lesson thread is deleted on lesson exit, so the message mirrors can
    # undercount what the labels prove was sent — a labeled message IS a
    # message, so the volume never reads below the labeled count.
    labeled = sum(labels.values())
    return {
        "substantive": substantive,
        "chatted": max(chatted, labeled),
        "labels": labels,
        "uncertain": bool(not labels and chatted >= target),
    }


def progress_from_sources(goal: dict[str, Any], assigned_at: str,
                          activity: list[dict[str, Any]],
                          events: list[dict[str, Any]],
                          yuvi_messages: list[str],
                          quality_rows: Optional[list[dict[str, Any]]] = None,
                          ) -> Optional[dict[str, Any]]:
    """The number a teacher reads: ``{kind, target, count, met}``.

    For ``ask_yuvi`` the count is the number of SUBSTANTIVE messages (#462) —
    judged from the stored per-message quality labels, never by the teacher —
    and ``quality`` carries the basis so the teacher can disagree.
    """
    action = normalize_action(goal.get("action"))
    if action is None:
        return None
    start, end = _window(goal, assigned_at)
    count = _count(action["kind"], start, end, activity, events, yuvi_messages)
    if action["kind"] != "ask_yuvi":
        return {**action, "count": count, "met": count >= action["target"]}

    quality = _quality_verdict(start, end, count, action["target"], quality_rows or [])
    return {
        **action,
        "count": quality["substantive"],
        "met": quality["substantive"] >= action["target"],
        "quality": quality,
    }


# ── the one-read-per-source gather ───────────────────────────────────────────

async def _yuvi_message_stamps(learner_id: str) -> list[str]:
    """Timestamps of the learner's own messages to Yuvi (durable transcript)."""
    from app.brain.repository import _get_collection_named
    collection = _get_collection_named("agent_messages")
    if collection is None:
        return []
    try:
        cursor = collection.find(
            {"learner_id": learner_id, "message_role": "user"},
            {"at": 1},
        ).sort("at", -1).limit(2000)
        return [str(row.get("at") or "") async for row in cursor]
    except Exception:  # pragma: no cover - a missing count is not an error
        return []


async def enrich_conversations(learner_id: str,
                               conversations: list[dict[str, Any]]) -> None:
    """Attach ``progress`` to every goal that carries an action, in place.

    Goals without an action (hand-written, pre-v6) are left untouched — the
    teacher screen renders them exactly as before. When nothing is trackable
    the sources are never read at all.
    """
    tracked = [(conversation, goal)
               for conversation in conversations
               for goal in (conversation.get("goals") or [])
               if normalize_action(goal.get("action"))]
    if not tracked:
        return

    from app.services import learner_activity, learner_signals
    from app.services.events import get_learner_events

    activity = await learner_activity._activity_rows(learner_id)
    events = await get_learner_events(learner_id, limit=2000)
    yuvi_messages = await _yuvi_message_stamps(learner_id)
    # Quality labels only when a conversational goal is actually tracked, from
    # the earliest such goal's window onward — one read, filtered per goal in
    # the pure fold.
    conversational = [
        str(conversation.get("created_at") or "")
        for conversation, goal in tracked
        if (goal.get("action") or {}).get("kind") == "ask_yuvi"
    ]
    quality_rows: list[dict[str, Any]] = []
    if conversational:
        quality_rows = await learner_signals.recent(
            learner_id, since=min(conversational), kinds=["question_quality"])

    for conversation, goal in tracked:
        goal["progress"] = progress_from_sources(
            goal, str(conversation.get("created_at") or ""),
            activity, events, yuvi_messages, quality_rows)
