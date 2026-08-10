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

from typing import Any, Optional

# Enough to show a pattern, few enough to read at a glance while a child waits.
MAX_ATTEMPTS = 6


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
    """
    from app.services import presence, teacher_alerts

    tried = await what_yuvi_tried(learner_id, objective_id=objective_id)
    presence.note_help_requested(learner_id)

    return await teacher_alerts.raise_alert(
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
            },
        },
    )
