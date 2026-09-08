"""Server-side grading. The only place a game's answers are compared.

The served HTML carries the questions and their options but no key; the
``YuviLearn`` bridge posts ``(question_id, answer)`` to the parent, which calls
``POST /api/games/{id}/check``, which lands here. Correct answers are read
from the live ``kata_catalog`` snapshot at grading time — the same source the
job's context was built from — so a kid who inspects the page finds nothing.

## Ids

The pack id is item-scoped: ``"{item_id}#{question_id}"``, split on the first
``#`` (``context_pack.split_question_id``). Kata reuses ``q1`` on every screen,
so the bare question id alone would grade the wrong question.

## Answers

Two shapes, both from the bridge: the option's **text**, or its **index** into
the question's ``answers`` list (a JSON number; booleans are refused — ``True``
is not option 1). Text is compared whitespace-collapsed and case-folded,
which is what the local validator does too, so a game that passes headless
grades the same in the app.

Every call records one ``learner_game_answers`` row. That row is the learning
telemetry a later task folds into learner signals; the grade itself is not
stored anywhere else.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.services import kata_catalog
from app.services.games import store

_WS = re.compile(r"\s+")


class GradingError(Exception):
    """A refusal the caller may see. The message is a stable code."""


def split_question_id(pack_id: str) -> tuple[str, str]:
    """``"item#q1"`` → ``("item", "q1")``. The worker's rule, restated here so
    the app does not import the worker package to grade an answer."""
    item_id, _, qid = str(pack_id or "").partition("#")
    return item_id, qid


def normalize_text(value: Any) -> str:
    return _WS.sub(" ", str(value if value is not None else "")).strip().casefold()


def resolve_question(component: dict[str, Any], pack_id: str) -> Optional[dict[str, Any]]:
    """The catalog's question row for a pack id, or None."""
    item_id, qid = split_question_id(pack_id)
    if not item_id or not qid:
        return None
    rows = (component.get("questions_by_item") or {}).get(item_id) or []
    for row in rows:
        if isinstance(row, dict) and str(row.get("questionId") or "") == qid:
            return row
    return None


def answer_text(row: dict[str, Any], answer: Any) -> Optional[str]:
    """The text the learner chose. An integer is an index into the options;
    anything else is taken as the text itself."""
    if isinstance(answer, bool):
        return None
    if isinstance(answer, int):
        options = row.get("answers") or []
        return str(options[answer]) if 0 <= answer < len(options) else None
    if answer is None:
        return None
    return str(answer)


def compare(row: dict[str, Any], answer: Any) -> tuple[bool, Optional[str]]:
    """``(correct, correct_answer)`` — the key's first entry is returned only
    when the answer was wrong, which is what the bridge shows as feedback."""
    accepted = [normalize_text(value) for value in (row.get("correctAnswers") or [])]
    accepted = [value for value in accepted if value]
    if not accepted:
        raise GradingError("question_not_gradeable")
    chosen = answer_text(row, answer)
    if chosen is None:
        return False, str((row.get("correctAnswers") or [""])[0])
    correct = normalize_text(chosen) in accepted
    return correct, None if correct else str((row.get("correctAnswers") or [""])[0])


async def grade(
    game: dict[str, Any], question_pack_id: str, answer: Any,
    *, latency_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Grade one answer inside a game and record it.

    Raises ``GradingError("unknown_component")`` when the catalog no longer has
    the component and ``GradingError("unknown_question")`` when the pack id
    names no question on it — a stale game after a catalog re-import, which
    the route turns into a 404 rather than a silent "wrong".
    """
    await kata_catalog.ensure_loaded()
    component_id = str(game.get("component_id") or "")
    component = kata_catalog.get_component(component_id)
    if not component:
        raise GradingError("unknown_component")
    row = resolve_question(component, question_pack_id)
    if row is None:
        raise GradingError("unknown_question")
    correct, correct_answer = compare(row, answer)
    item_id, _ = split_question_id(question_pack_id)
    await store.record_answer(
        game_id=str(game["_id"]), learner_id=str(game["learner_id"]),
        question_id=str(question_pack_id), item_id=item_id, component_id=component_id,
        correct=correct, latency_ms=latency_ms,
    )
    return {"correct": correct, "correct_answer": correct_answer}
