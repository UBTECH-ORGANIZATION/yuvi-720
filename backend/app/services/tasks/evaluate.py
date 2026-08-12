"""Scoring: deterministic, partial-credit, and never generous by accident.

Every objective question type is scored here in code. Nothing about a child's
score depends on a model, which matters because a grade a teacher cannot
reproduce is a grade they cannot defend to a parent.

Partial credit is the point. A child who orders four of five steps correctly
has not "got it wrong", and a matching question marked all-or-nothing tells the
teacher nothing about which pair confused them.

Two rules run through it:

**Guessing is not knowing.** `multiple_correct` subtracts wrong selections from
right ones, so ticking every box scores zero rather than full marks. Without
that, the highest-scoring strategy on a five-option question is to select all
five, and the score stops measuring anything.

**A skipped question is not a wrong one.** They are counted separately, because
"did not reach it" and "tried and failed" are different problems and the
teacher's next move differs.

`open_ended` is deliberately not scored here — it goes to the rubric grader.
The reference implementation left this branch reading a pre-computed
`answer["score"]` that nothing ever wrote, so every open question silently
scored zero.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional

#: Types this module can decide on its own.
OBJECTIVE_TYPES = (
    "mcq", "image_mcq", "true_false", "multiple_correct",
    "ordering", "matching", "fill_blank",
)


def _clean(value: Any) -> str:
    """Compare what the child meant, not how their keyboard behaved."""
    text = unicodedata.normalize("NFKC", str(value if value is not None else ""))
    # Hebrew and Arabic keyboards produce different marks for the same intent;
    # a bidi control character is invisible and would fail an equality check.
    text = re.sub(r"[‎‏‪-‮⁦-⁩]", "", text)
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    text = text.replace("״", '"').replace("׳", "'")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _as_number(value: Any) -> Optional[float]:
    """A numeric reading of an answer, including mixed numbers and fractions.

    `2 5/12`, `2.5`, `2,5` and `5/2` all have to compare equal to the same
    quantity, because which of them a child types depends on the keyboard and
    the notation their teacher happens to use.
    """
    text = _clean(value).replace(",", ".").replace(" ", " ")
    if not text:
        return None

    mixed = re.fullmatch(r"(-?\d+)\s+(\d+)\s*/\s*(\d+)", text)
    if mixed:
        whole, numerator, denominator = (int(part) for part in mixed.groups())
        if denominator == 0:
            return None
        magnitude = abs(whole) + numerator / denominator
        return -magnitude if whole < 0 else magnitude

    fraction = re.fullmatch(r"(-?\d+)\s*/\s*(-?\d+)", text)
    if fraction:
        numerator, denominator = (int(part) for part in fraction.groups())
        return numerator / denominator if denominator else None

    try:
        return float(text)
    except ValueError:
        return None


def _matches(given: Any, accepted: list[str]) -> bool:
    """One blank against everything the generator said it would take."""
    cleaned = _clean(given)
    if not cleaned:
        return False
    if any(cleaned == _clean(option) for option in accepted):
        return True

    # Numeric equality, so 0.5 answers a blank whose key is 1/2. The tolerance
    # is for float representation only, not for being approximately right.
    number = _as_number(given)
    if number is None:
        return False
    for option in accepted:
        expected = _as_number(option)
        if expected is not None and abs(number - expected) < 1e-9:
            return True
    return False


def score_question(question: dict[str, Any], answer: Any) -> dict[str, Any]:
    """One question, one verdict: `correctness` in 0..1 plus how it got there."""
    kind = str(question.get("type") or "")
    expected = question.get("answer") or {}

    if answer is None or answer == "" or answer == []:
        return {"correctness": 0.0, "correct": False, "skipped": True, "detail": None}

    correctness, detail = 0.0, None

    if kind in ("mcq", "image_mcq"):
        try:
            correctness = 1.0 if int(answer) == expected.get("index") else 0.0
        except (TypeError, ValueError):
            correctness = 0.0

    elif kind == "true_false":
        given = answer
        if isinstance(given, str):
            given = given.strip().lower() in ("true", "yes", "נכון", "صحيح")
        correctness = 1.0 if bool(given) == expected.get("value") else 0.0

    elif kind == "multiple_correct":
        wanted = set(expected.get("indices") or [])
        given = {int(value) for value in answer if _is_int(value)} if isinstance(answer, list) else set()
        if wanted:
            hits, misses = len(given & wanted), len(given - wanted)
            # Selecting everything must not score full marks.
            correctness = max(0.0, (hits - misses) / len(wanted))
            detail = {"selected": sorted(given), "missed": sorted(wanted - given),
                      "wrong": sorted(given - wanted)}

    elif kind == "ordering":
        order = expected.get("order") or []
        if isinstance(answer, list) and order:
            if _int_list(answer) == order:
                correctness = 1.0
            else:
                # Positional agreement: three of five in the right place is
                # three fifths, not zero.
                matched = sum(1 for given, want in zip(_int_list(answer), order) if given == want)
                correctness = matched / len(order)
                detail = {"in_place": matched, "total": len(order)}

    elif kind == "matching":
        pairs = [tuple(pair) for pair in (expected.get("pairs") or [])]
        if isinstance(answer, list) and pairs:
            given = {tuple(_int_list(pair)) for pair in answer if isinstance(pair, list)}
            hits = len(given & set(pairs))
            correctness = hits / len(pairs)
            detail = {"matched": hits, "total": len(pairs),
                      "wrong": sorted(tuple(pair) for pair in given - set(pairs))}

    elif kind == "fill_blank":
        blanks = expected.get("blanks") or []
        given = answer if isinstance(answer, list) else [answer]
        if blanks:
            hits = sum(
                1 for index, blank in enumerate(blanks)
                if index < len(given) and _matches(given[index], blank.get("accept") or [])
            )
            correctness = hits / len(blanks)
            detail = {"filled": hits, "total": len(blanks)}

    elif kind == "open_ended":
        # Scored by the rubric grader, which runs separately and writes back.
        return {"correctness": None, "correct": None, "skipped": False,
                "detail": {"awaiting": "rubric"}}

    correctness = round(min(1.0, max(0.0, correctness)), 3)
    return {"correctness": correctness, "correct": correctness >= 1.0,
            "skipped": False, "detail": detail}


def _is_int(value: Any) -> bool:
    try:
        int(value)
        return True
    except (TypeError, ValueError):
        return False


def _int_list(raw: Any) -> list[int]:
    return [int(value) for value in (raw if isinstance(raw, list) else []) if _is_int(value)]


def score_questions(
    questions: list[dict[str, Any]], answers: dict[str, Any],
) -> dict[str, Any]:
    """A whole component: the per-question verdicts and the weighted total.

    A question awaiting the rubric grader is excluded from the total rather than
    counted as zero — a score that drops while grading is still running would be
    shown to a teacher as if it were final.
    """
    results: dict[str, Any] = {}
    earned = possible = 0.0
    pending = 0

    for question in questions:
        question_id = str(question.get("id") or "")
        verdict = score_question(question, answers.get(question_id))
        results[question_id] = verdict

        if verdict["correctness"] is None:
            pending += 1
            continue
        try:
            weight = float(question.get("weight", 1) or 1)
        except (TypeError, ValueError):
            weight = 1.0
        earned += verdict["correctness"] * weight
        possible += weight

    answered = sum(1 for verdict in results.values() if not verdict["skipped"])
    return {
        "questions": results,
        "score": round(100 * earned / possible) if possible else None,
        "earned": round(earned, 3),
        "possible": round(possible, 3),
        "answered": answered,
        "skipped": len(results) - answered,
        "awaiting_grading": pending,
    }
