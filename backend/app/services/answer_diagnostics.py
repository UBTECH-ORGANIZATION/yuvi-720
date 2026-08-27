"""Deterministic, conservative answer diagnostics for Coach guidance.

Provider success remains authoritative for mastery. This module only adds
explainable metadata when an answer has safely comparable components, so the
Coach can preserve what the learner already got right.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any, Optional


_COORDINATE_QUESTION = re.compile(
    r"(?:coordinate|ordered\s*pair|\bpoint\b|נקוד|שיעור|זוג\s*סדור|إحداث|زوج\s*مرتب)",
    re.IGNORECASE,
)


def _clean(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value if value is not None else ""))
    text = re.sub(r"[‎‏‪-‮⁦-⁩]", "", text)
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    return re.sub(r"\s+", " ", text).strip().casefold()


def _parts(value: object, question_text: object) -> Optional[list[str]]:
    """Return comparable answer components only when their structure is clear."""
    if isinstance(value, (list, tuple)):
        return [_clean(part) for part in value] or None
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None
    try:
        decoded = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        decoded = None
    if isinstance(decoded, list) and all(not isinstance(part, (dict, list)) for part in decoded):
        return [_clean(part) for part in decoded] or None

    wrapped = len(text) >= 2 and text[0] in "([{" and text[-1] in ")] }".replace(" ", "")
    coordinate_like = bool(_COORDINATE_QUESTION.search(str(question_text or "")))
    if not (wrapped or coordinate_like):
        return None
    body = text[1:-1] if wrapped else text
    parts = [_clean(part) for part in body.split(",")]
    return parts if len(parts) > 1 and all(parts) else None


def diagnose_answer(
    question: dict[str, Any],
    response: object,
    *,
    provider_success: Optional[bool],
    provider_score_scaled: object,
) -> Optional[dict[str, Any]]:
    """Return answer evidence without changing the provider's scoring verdict."""
    if provider_success is True:
        return {"outcome": "correct", "correctness": 1.0, "source": "provider_success"}
    if isinstance(provider_score_scaled, (int, float)) and not isinstance(provider_score_scaled, bool):
        score = max(0.0, min(1.0, float(provider_score_scaled)))
        if 0.0 < score < 1.0:
            return {
                "outcome": "partial",
                "correctness": round(score, 3),
                "source": "provider_score",
            }

    answers = question.get("correctAnswers") or []
    if not isinstance(answers, list) or len(answers) != 1:
        return (
            {"outcome": "wrong", "correctness": 0.0, "source": "provider_success"}
            if provider_success is False else None
        )
    expected = _parts(answers[0], question.get("questionText"))
    given = _parts(response, question.get("questionText"))
    if not expected or not given or len(expected) != len(given):
        return (
            {"outcome": "wrong", "correctness": 0.0, "source": "provider_success"}
            if provider_success is False else None
        )

    correct_parts = [index for index, (actual, wanted) in enumerate(zip(given, expected)) if actual == wanted]
    correctness = len(correct_parts) / len(expected)
    if correctness <= 0 or correctness >= 1:
        return (
            {"outcome": "wrong", "correctness": 0.0, "source": "provider_success"}
            if provider_success is False else None
        )
    return {
        "outcome": "partial",
        "correctness": round(correctness, 3),
        "source": "structured_components",
        "correct_parts": correct_parts,
        "incorrect_parts": [index for index in range(len(expected)) if index not in correct_parts],
        "total_parts": len(expected),
    }