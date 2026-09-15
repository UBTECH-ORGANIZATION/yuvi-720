"""Coach → teacher handoff: what Yuvi already tried, handed to a human.

The AI→human boundary is usually a cliff. A child asks for help, the tutor
cannot get them unstuck, and the teacher walks over knowing nothing — so the
first thing they do is ask questions the child has already answered twice.

`tutor_decisions` has been logging every pedagogical move the coach made (error
type, strategy, hint level) since long before this feature existed. Projecting
the last few into the alert turns the handoff into a continuation:

    "Yuvi tried a level-2 hint and an alternative representation on this
     question; Ron is still stuck."

Nothing new is collected, and nothing private is exposed. The teacher gets the
*pedagogical* record — what was tried and how — not the conversation. A companion
a child cannot speak to freely is not a companion, so chat transcripts stay out
of the teacher's view; the narrow, deliberate exception is a safety flag, which
surfaces only the flagged sentence.
"""

from __future__ import annotations

import os
from typing import Any, Optional

# Enough to show a pattern, few enough to read at a glance while a child waits.
MAX_ATTEMPTS = 6

# ── the raise-hand gate ──────────────────────────────────────────────────────
#
# The hand starts locked in a lesson and opens only when someone with evidence
# says the child needs a person: Yuvi's own judgement (the `suggest_teacher_help`
# tool), a struggle detector, or the wrong-answers safety valve. The unlock is
# server truth (presence), so a reload keeps it and the route can refuse a raise
# the client should not have offered.

# Reasons the coach tool may give. A closed vocabulary: the teacher's "why"
# panel and the analytics both key on it.
HAND_UNLOCK_REASONS = frozenset({
    "stuck_after_help", "emotional", "off_track", "asked_for_teacher", "other",
})
# Bus triggers that open the hand on their own. `mistake`, `slow_progress` and
# `partial` deliberately do not — one wrong answer or slow reading is not stuck.
UNLOCKING_TRIGGERS = frozenset({
    "wheel_spinning", "misconception", "rapid_guessing", "idle", "repeated_wrong",
})


class HandLocked(Exception):
    """The learner raised a hand the gate has not opened."""


def gate_enabled() -> bool:
    """Kill switch. Off restores the always-clickable hand end to end: the
    state reads `unlocked`, unlocks are no-ops, and the route never refuses."""
    return (os.environ.get("HAND_UNLOCK_GATE_ENABLED") or "1").strip().lower() in {
        "1", "true", "yes", "on",
    }


def unlock_hand(
    learner_id: str, *, question_key: Optional[str], reason: str, source: str
) -> Optional[dict[str, Any]]:
    """Open the hand for this question and tell the learner's client.

    Idempotent per question: a detector and the coach both firing on the same
    screen produce one unlock and one frame — the first reason wins, since it
    is the one the button actually opened on.
    """
    from app.services import presence, realtime

    if not gate_enabled():
        return None
    current = (presence.snapshot(learner_id) or {}).get("hand_unlock")
    if isinstance(current, dict) and current.get("question_key") == question_key:
        return dict(current)
    unlock = presence.note_hand_unlocked(
        learner_id, question_key=question_key, reason=reason, source=source)
    realtime.publish(f"learner:{learner_id}", {
        "type": "hand_unlock",
        "reason": reason,
        "source": source,
        "question_key": question_key,
    })
    return unlock


def consider_unlock(learner_id: str, trigger: dict[str, Any]) -> Optional[dict[str, Any]]:
    """A published trigger may be evidence enough to open the hand."""
    kind = str(trigger.get("type") or "")
    if kind not in UNLOCKING_TRIGGERS:
        return None
    from app.services import triggers

    return unlock_hand(
        learner_id,
        question_key=triggers.current_screen_key(learner_id),
        reason=kind,
        source="detector",
    )


async def what_yuvi_tried(
    learner_id: str, *, objective_id: Optional[str] = None, limit: int = MAX_ATTEMPTS
) -> dict[str, Any]:
    """The coach's recent pedagogical moves, newest first.

    Returns `{"attempts": [...], "reason": ...}` — an explicit reason when there
    is nothing, never a silent empty list. "Yuvi has not worked with Ron on this
    yet" and "Yuvi tried nothing" are different statements and the teacher's card
    has to be able to tell them apart.
    """
    from app.agents.tutor_decision import recent_tutor_decisions

    decisions = await recent_tutor_decisions(learner_id, limit=120)
    if not decisions:
        return {"attempts": [], "reason": "no_coach_history"}

    if objective_id:
        scoped = [row for row in decisions if row.get("objective_id") == objective_id]
        # Fall back to the unscoped history rather than claiming nothing happened:
        # older decision rows predate objective tagging.
        decisions = scoped or decisions

    attempts = [
        {
            "at": row.get("at"),
            "error_type": row.get("error_type"),
            "strategy": row.get("strategy"),
            "hint_level": row.get("hint_level"),
            "component_id": row.get("component_id"),
        }
        for row in decisions[:limit]
    ]
    return {
        "attempts": attempts,
        "strategies_tried": sorted({
            attempt["strategy"] for attempt in attempts if attempt.get("strategy")
        }),
        "highest_hint_level": max(
            (attempt["hint_level"] for attempt in attempts
             if isinstance(attempt.get("hint_level"), int)),
            default=None,
        ),
        "reason": None,
    }


async def hand_off(
    learner_id: str,
    *,
    reason: str = "stuck",
    objective_id: Optional[str] = None,
    component_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Escalate to every teacher who may see this learner.

    Marks help-requested on the live strip *and* raises a durable alert, because
    the two answer different questions: the strip says "right now", the alert
    survives the teacher being at lunch.

    Refuses with `HandLocked` while the gate is shut — the client greys the
    button, but a stale tab or a hand-rolled request must not get past it. The
    unlock is consumed only when a teacher was actually reached: with nobody to
    notify, blocking the retry would strand the child.
    """
    from app.services import presence, teacher_alerts

    state = hand_state(learner_id)
    if not state["unlocked"]:
        raise HandLocked(learner_id)

    tried = await what_yuvi_tried(learner_id, objective_id=objective_id)
    presence.note_help_requested(learner_id)

    alerts = await teacher_alerts.raise_alert(
        learner_id,
        "coach_handoff",
        title_key="tch.alert.coachHandoff",
        params={"objective_id": objective_id, "reason": reason},
        bucket=teacher_alerts.default_bucket("coach_handoff", objective_id=objective_id),
        evidence={
            "label_key": "tch.evidence.whatYuviTried",
            "value": len(tried["attempts"]),
            # The raw record IS the explanation here — the teacher can read the
            # exact sequence of moves rather than a summary of them.
            "raw": {
                "reason": reason,
                "objective_id": objective_id,
                "component_id": component_id,
                "attempts": tried["attempts"],
                "strategies_tried": tried.get("strategies_tried") or [],
                "highest_hint_level": tried.get("highest_hint_level"),
                "no_history_reason": tried.get("reason"),
                # Why the button was open when the child pressed it — the
                # teacher's "why" panel renders raw generically, so this is
                # visible with no teacher-side change. Reason only, never the
                # coach tool's evidence sentence (transcripts stay out).
                "unlock_reason": state["unlock_reason"],
                "unlock_source": state["unlock_source"],
            },
        },
    )
    if alerts:
        presence.clear_hand_unlock(learner_id)
    return alerts


async def cancel(learner_id: str) -> int:
    """The child takes their hand down (#450).

    Clears the live strip immediately, then resolves the open ``coach_handoff``
    alerts so the teacher's inbox agrees with the room. STRICTLY that one kind:
    a safety escalation also sets `help_requested_at`, but its ALERT must
    survive anything a child can press — `resolve_open_for_learner` enforces
    the kind, and the invariant is pinned by test. Resolving republishes
    `hand_resolved` to the learner topic, which is exactly the cooldown unlock
    the client wants after a cancel.
    """
    from app.services import presence, teacher_alerts

    presence.clear_help_requested(learner_id)
    presence.clear_hand_unlock(learner_id)
    return await teacher_alerts.resolve_open_for_learner(
        learner_id, kind="coach_handoff")


def hand_state(learner_id: str) -> dict[str, Any]:
    """Is this learner's hand up, and is the button open — server truth.

    A pure presence read (GET never generates): the client initializes from
    this on mount so a reload cannot silently lower a raised hand's glow, or
    re-lock a hand Yuvi had opened. With the gate off the hand is always open.
    """
    from app.services import presence

    entry = presence._cap_hand(presence.snapshot(learner_id) or {})
    raised_at = entry.get("help_requested_at")
    unlock = entry.get("hand_unlock") if isinstance(entry.get("hand_unlock"), dict) else None
    return {
        "raised": bool(raised_at),
        "since": raised_at,
        "unlocked": bool(unlock) or not gate_enabled(),
        "unlock_reason": (unlock or {}).get("reason"),
        "unlock_source": (unlock or {}).get("source"),
        "unlock_question_key": (unlock or {}).get("question_key"),
    }
