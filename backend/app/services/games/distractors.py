"""Options for choice questions that Kata ships without any.

The catalog's question snapshot carries `answers` and `correctAnswers`, and
for most choice questions the two lists are identical: the source keeps the
distractors on the CET player, not in the metadata. A game that shows those
`answers` as buttons shows one button, and it is always right.

`enrich_component` fills the gap once per question: a mini-tier model writes
three plausible wrong options from the question text and the correct
answers, the result is cached by a hash of the question, and the row's
`answers` becomes a stable shuffle of correct + distractors. Matching
questions (drag pairs) cannot be a button list and are removed here so the
count the picker shows is the count the game gets.
"""

from __future__ import annotations

import copy
import hashlib
import json
import logging
import random
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

log = logging.getLogger(__name__)

COLLECTION = "game_question_options"
CHOICE_TYPES = ("choice", "true-false")
DROPPED_TYPES = ("matching",)
DISTRACTORS_PER_QUESTION = 3
_MAX_PER_CALL = 20

_SYSTEM = (
    "You write wrong-but-plausible answer options for school quiz questions (grades 7-9). "
    "For each question you get the text and the correct answer(s). Return, for each question id, "
    "exactly {n} distractors in the SAME language and format as the correct answers (same units, "
    "same notation such as (x,y) pairs), each a common mistake a student would make, never equal to a "
    "correct answer, never a joke, no explanations. Reply as JSON: {{\"<question id>\": [\"…\", \"…\", \"…\"], …}}."
)


def _fingerprint(row: dict[str, Any]) -> str:
    raw = json.dumps(
        {"t": row.get("questionText"), "c": row.get("correctAnswers"), "a": row.get("answers")},
        ensure_ascii=False, sort_keys=True,
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def needs_distractors(row: dict[str, Any]) -> bool:
    """A keyed choice question whose options are nothing but the key."""
    if str(row.get("questionType") or "") not in CHOICE_TYPES:
        return False
    correct = [str(a).strip() for a in (row.get("correctAnswers") or []) if str(a).strip()]
    answers = [str(a).strip() for a in (row.get("answers") or []) if str(a).strip()]
    if not correct or not str(row.get("questionText") or "").strip():
        return False
    return len([a for a in answers if a not in correct]) == 0


def _stable_shuffle(values: list[str], seed: str) -> list[str]:
    out = list(dict.fromkeys(values))
    random.Random(seed).shuffle(out)
    return out


async def _cached(ids: list[str]) -> dict[str, list[str]]:
    handle = _get_collection_named(COLLECTION)
    if handle is None or not ids:
        return {}
    try:
        return {doc["_id"]: list(doc.get("distractors") or [])
                async for doc in handle.find({"_id": {"$in": ids}})}
    except Exception as exc:  # pragma: no cover
        log.warning("distractor cache read failed: %s", type(exc).__name__)
        return {}


async def _remember(entries: dict[str, list[str]]) -> None:
    handle = _get_collection_named(COLLECTION)
    if handle is None or not entries:
        return
    for key, distractors in entries.items():
        try:
            await handle.update_one({"_id": key}, {"$set": {"distractors": distractors}}, upsert=True)
        except Exception as exc:  # pragma: no cover
            log.warning("distractor cache write failed: %s", type(exc).__name__)


async def _generate(rows: list[tuple[str, dict[str, Any]]], *, actor_id: str, subject: str) -> dict[str, list[str]]:
    """One model call for up to _MAX_PER_CALL questions; {question key: distractors}."""
    questions = [{
        "id": key,
        "question": str(row.get("questionText") or "")[:400],
        "correct": [str(a) for a in (row.get("correctAnswers") or [])][:6],
    } for key, row in rows]
    reply = await call_llm(
        [
            {"role": "system", "content": _SYSTEM.format(n=DISTRACTORS_PER_QUESTION)},
            {"role": "user", "content": f"SUBJECT: {subject or 'school'}\n\nQUESTIONS:\n{json.dumps(questions, ensure_ascii=False)}"},
        ],
        usage_context=UsageContext(
            actor_id=actor_id, actor_type="learner", endpoint="internal:game_distractors",
            feature="feature_7_learning_games", operation="game.distractors", source="games.distractors",
        ),
        max_tokens=1200, json_mode=True, model_tier="mini", timeout=40,
    )
    try:
        data = json.loads(reply or "{}")
    except (TypeError, ValueError):
        return {}
    out: dict[str, list[str]] = {}
    for key, row in rows:
        correct = {str(a).strip() for a in (row.get("correctAnswers") or [])}
        values = data.get(key) if isinstance(data, dict) else None
        cleaned = []
        for value in values if isinstance(values, list) else []:
            text = str(value).strip()[:160]
            if text and text not in correct and text not in cleaned:
                cleaned.append(text)
        if len(cleaned) >= 2:
            out[key] = cleaned[:DISTRACTORS_PER_QUESTION]
    return out


async def enrich_component(component: dict[str, Any], *, actor_id: str = "system") -> dict[str, Any]:
    """A copy of the component whose choice questions all have real options
    and whose matching questions are gone. Rows that could not be given
    options are left as they were; the pack drops single-option rows."""
    result = copy.deepcopy(component)
    by_item = result.get("questions_by_item") or {}
    pending: list[tuple[str, dict[str, Any]]] = []
    for item_id, rows in list(by_item.items()):
        kept = []
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            if str(row.get("questionType") or "") in DROPPED_TYPES:
                continue
            kept.append(row)
            if needs_distractors(row):
                pending.append((f"{item_id}#{row.get('questionId')}:{_fingerprint(row)}", row))
        by_item[item_id] = kept
    if not pending:
        return result

    found = await _cached([key for key, _ in pending])
    missing = [(key, row) for key, row in pending if key not in found]
    subject = str(result.get("subject") or result.get("title") or "")
    for start in range(0, len(missing), _MAX_PER_CALL):
        batch = missing[start:start + _MAX_PER_CALL]
        try:
            generated = await _generate(batch, actor_id=actor_id, subject=subject)
        except Exception as exc:
            log.warning("distractor generation failed: %s", type(exc).__name__)
            generated = {}
        await _remember(generated)
        found.update(generated)

    for key, row in pending:
        distractors = found.get(key)
        if not distractors:
            continue
        correct = [str(a).strip() for a in (row.get("correctAnswers") or []) if str(a).strip()]
        row["answers"] = _stable_shuffle(correct + distractors, key)
    return result
