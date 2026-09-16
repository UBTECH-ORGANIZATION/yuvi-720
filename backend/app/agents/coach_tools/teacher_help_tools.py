"""Yuvi's judgement that a person should join — the raise-hand gate's third eye.

The button stays grey until something with evidence says the child needs a
teacher. Detectors cover the countable cases (repeated misses, guessing,
idleness); this tool covers the ones only the conversation shows: a child who
asks for the teacher in words, who is still lost after a hint and an
explanation, whose distress is not easing, who keeps drifting off the task.

The tool contacts nobody. It opens the button — the decision to press it stays
the child's. The `evidence` sentence is kept in the turn's own metadata for
review and never reaches the teacher's alert: transcripts stay out of the
teacher's view (see `coach_handoff`'s module docstring).
"""

from __future__ import annotations

from typing import Any

from app.agents.coach_modes import CoachMode
from app.agents.coach_tools.registry import CoachTool, CoachToolContext, register
from app.services import coach_handoff

EVIDENCE_MAX_CHARS = 120


async def _suggest_teacher_help(
    context: CoachToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    if context.teacher_suggestions:
        # Once per turn: the button is already open; a second call adds nothing.
        return {"status": "accepted",
                "data": {"reason": context.teacher_suggestions[0].get("reason")}}
    current = (context.bundle or {}).get("current") or {}
    component_id = str(current.get("component_id") or "")
    item_id = str(current.get("item_id") or "")
    # Same identity `point_at_screen` uses, so the unlock re-locks on the same
    # screen change the client already keys on.
    question_key = (
        "|".join((component_id, item_id, str(current.get("question_id") or "")))
        if component_id and item_id else None
    )
    reason = str(args["reason"])
    evidence = str(args.get("evidence") or "").strip()[:EVIDENCE_MAX_CHARS]
    unlock = coach_handoff.unlock_hand(
        context.learner_id, question_key=question_key, reason=reason, source="coach")
    context.teacher_suggestions.append({
        "reason": reason,
        "question_key": question_key,
        "evidence": evidence,
        "unlocked": unlock is not None,
    })
    return {"status": "accepted", "data": {"reason": reason}}


register(CoachTool(
    name="suggest_teacher_help",
    description=(
        "Open the learner's \"call the teacher\" button. Use ONLY on clear evidence that a "
        "person is needed: the learner explicitly asked for a teacher (asked_for_teacher); is "
        "still stuck on THIS question after you already gave a hint or an explanation "
        "(stuck_after_help); shows distress or frustration that coaching is not easing "
        "(emotional); or keeps drifting off the task despite redirection (off_track). Never "
        "for a first hint request, an ordinary question, or a single wrong answer. At most "
        "once per question. This contacts nobody and promises nothing — it only lets the "
        "learner choose to call."
    ),
    parameters={
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "enum": sorted(coach_handoff.HAND_UNLOCK_REASONS),
            },
            "evidence": {
                "type": "string",
                "description": (
                    "A few words (max 120 chars) on what in the conversation showed a person "
                    "is needed. Kept for review only; never shown to the teacher."),
            },
        },
        "required": ["reason"],
    },
    handler=_suggest_teacher_help,
    allowed_modes=frozenset({CoachMode.LESSON}),
))
