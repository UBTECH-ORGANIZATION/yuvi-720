"""Deterministic per-item answer status from catalog and real xAPI evidence.

Kata's relay does not report attempts remaining or when an answer was revealed.
This projection therefore makes only two completion claims: no answer has been
received for an opened item, or every catalogued section has an xAPI ``answered``
event with ``success: true``.
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from app.services.events import get_learner_events

ANSWER_VERB = "answered"
STATUS_UNATTEMPTED = "unattempted"
STATUS_ALL_CORRECT = "all_correct"
STATUS_ANSWERED_NOT_ALL_CORRECT = "answered_not_all_correct"

def derive_item_status(
    events: Iterable[dict[str, Any]],
    *,
    questions: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Project one item's answer evidence without inferring attempt exhaustion."""
    section_ids = {
        str(question.get("questionId"))
        for question in questions
        if question.get("questionId")
    }
    answer_count = 0
    correct_section_ids: set[str] = set()

    for event in events:
        if event.get("verb") != ANSWER_VERB:
            continue
        answer_count += 1
        question_id = event.get("question_id")
        if (event.get("result") or {}).get("success") is True and question_id:
            correct_section_ids.add(str(question_id))

    correct_section_ids.intersection_update(section_ids)
    if answer_count == 0:
        status = STATUS_UNATTEMPTED
    elif section_ids and section_ids.issubset(correct_section_ids):
        status = STATUS_ALL_CORRECT
    else:
        status = STATUS_ANSWERED_NOT_ALL_CORRECT

    return {
        "status": status,
        "answer_count": answer_count,
        "section_count": len(section_ids),
        "correct_section_count": len(correct_section_ids),
    }


async def status_for_item(
    learner_id: str,
    *,
    component_id: Optional[str],
    item_id: Optional[str],
    questions: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Read the learner's recorded answer evidence for one exact item."""
    questions = list(questions)
    if not component_id or not item_id:
        return derive_item_status((), questions=questions)

    evidence = await get_learner_events(learner_id)
    matching = (
        event
        for event in evidence
        if event.get("launch") == component_id
        and event.get("sub_item_id") == item_id
    )
    return derive_item_status(matching, questions=questions)
