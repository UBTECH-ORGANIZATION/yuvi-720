"""One paragraph per Kata component: what a kid learns in that ONE lesson.

## What it is for

The game builder no longer receives question rows or the teacher's raw
``information_to_bot``; it receives a designer's brief — a single paragraph,
in the kid's language, naming the core idea, the 2–4 facts/rules/vocabulary
the lesson turns on, the mistakes kids typically make, and the level (number
ranges, units). That paragraph is generated once per (component, language)
with the mini model and cached in Mongo, the same arrangement as
``question_topics``: fingerprint-gated, prompt version in the doc id, one
in-flight generation per key.

## What keeps it honest

* Question texts are read as EVIDENCE of scope and level — they shape the
  paragraph, they are never quoted, and ``answers`` / ``correctAnswers`` never
  enter the prompt, the fingerprint, or this module's output.
* A transport failure (or a paragraph too thin to trust) returns a
  deterministic fallback built from the catalog titles and stores NOTHING, so
  the next caller asks again instead of freezing a bad paragraph.
* Regeneration reacts to authored content only: the fingerprint hashes the
  component's title/purpose/teacher notes, the sorted question texts, and the
  unit/objective titles + description. A re-read never regenerates.

``/prepare`` warms the paragraph while the kid writes the brief;
``jobs.build_context`` waits for it when the job is enqueued.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.ai_usage import UsageContext

log = logging.getLogger(__name__)

COLLECTION = "game_learning_descriptions"

#: Part of every doc id. Bump when the prompt changes in a way that makes
#: previously stored paragraphs wrong — old rows become unreachable, never migrated.
PROMPT_VERSION = "v1"

MAX_DESCRIPTION_CHARS = 1500
MIN_DESCRIPTION_CHARS = 40
_NOTES_LIMIT = 2000
_QUESTION_TEXT_LIMIT = 300
_MAX_QUESTION_TEXTS = 40

_LANG = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

#: One in-flight generation per (component, language) — the picker's warm-up
#: and the create that follows it must not pay for two identical calls.
_tasks: dict[str, "asyncio.Task[str]"] = {}


def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _language(language: Optional[str]) -> str:
    return language if language in _LANG else "he"


def _doc_id(component_id: str, language: str) -> str:
    return f"{component_id}|{language}|{PROMPT_VERSION}"


# ── inputs ───────────────────────────────────────────────────────────────────

def _question_texts(component: Optional[dict[str, Any]]) -> list[str]:
    """The authored question stems, sorted — scope-and-level evidence only.
    Answers are deliberately never read."""
    texts: set[str] = set()
    for rows in ((component or {}).get("questions_by_item") or {}).values():
        for row in rows or []:
            if not isinstance(row, dict):
                continue
            text = " ".join(str(row.get("questionText") or "").split())
            if text:
                texts.add(text[:_QUESTION_TEXT_LIMIT])
    return sorted(texts)[:_MAX_QUESTION_TEXTS]


def fingerprint(
    component: Optional[dict[str, Any]], unit: Optional[dict[str, Any]],
    objective: Optional[dict[str, Any]],
) -> str:
    """What regeneration reacts to: the authored content itself."""
    component = component or {}
    unit = unit or {}
    objective = objective or {}
    blob = json.dumps([
        str(component.get("title") or ""),
        str(component.get("purpose") or ""),
        str(component.get("information_to_bot") or "")[:_NOTES_LIMIT],
        _question_texts(component),
        str(unit.get("title") or ""),
        str(objective.get("title") or ""),
        str(objective.get("description") or ""),
    ], ensure_ascii=False)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


# ── the cache ────────────────────────────────────────────────────────────────

async def _stored(component_id: str, language: str) -> Optional[dict[str, Any]]:
    handle = _collection()
    if handle is None:
        return None
    try:
        return await handle.find_one({"_id": _doc_id(component_id, language)})
    except Exception as exc:  # pragma: no cover - a cache miss, not a failure
        log.warning("learning description read failed: %s", type(exc).__name__)
        return None


async def cached(
    component_id: str, language: str = "he", *, fingerprint: Optional[str] = None,
) -> Optional[str]:
    """The stored paragraph, or None. With `fingerprint`, a row written for
    older authored content counts as a miss — the picker's "ready" then
    means the create will not wait on a model call."""
    doc = await _stored(component_id, _language(language))
    if not doc or not doc.get("text"):
        return None
    if fingerprint is not None and doc.get("fingerprint") != fingerprint:
        return None
    return str(doc["text"])


async def _store(component_id: str, language: str, text: str, fp: str) -> None:
    handle = _collection()
    if handle is None:
        return
    try:
        await handle.update_one(
            {"_id": _doc_id(component_id, language)},
            {"$set": {
                "component_id": component_id,
                "language": language,
                "text": text,
                "fingerprint": fp,
                "generated_at": _now_iso(),
            }},
            upsert=True,
        )
    except Exception as exc:  # pragma: no cover
        log.warning("learning description not stored: %s", type(exc).__name__)


# ── the one call ─────────────────────────────────────────────────────────────

_SYSTEM = (
    "You brief a game designer on what a kid learns in ONE lesson. The designer will turn "
    "the idea into game mechanics, so name the concept precisely, list the few facts, rules "
    "or vocabulary the lesson turns on, say what kids typically get wrong, and pin the level "
    "(the number ranges, units and cases in play). One paragraph, 90–150 words, in {language}. "
    "The QUESTION TEXTS are evidence of scope and level only: never quote or paraphrase a "
    "question, never mention that questions exist. Answer with JSON only: "
    '{{"description": "..."}}'
)

_USER = """SUBJECT: {subject}
GRADE / CURRICULUM: {curriculum}
OBJECTIVE: {objective_title}
OBJECTIVE DESCRIPTION: {objective_description}
UNIT: {unit_title}
LESSON (component): {component_title}
LESSON PURPOSE: {purpose}
TEACHER NOTES: {notes}
QUESTION TEXTS (scope and level evidence only, never quote): {questions}

Write the paragraph: the core idea; the 2–4 facts, rules or vocabulary; the typical
mistakes; the level with concrete number ranges or cases. JSON {{"description": "..."}}."""


def _prompt(
    component: dict[str, Any], unit: Optional[dict[str, Any]],
    objective: Optional[dict[str, Any]], language: str,
) -> list[dict[str, str]]:
    unit = unit or {}
    objective = objective or {}
    return [
        {"role": "system", "content": _SYSTEM.format(language=_LANG[language])},
        {"role": "user", "content": _USER.format(
            subject=str(component.get("subject") or unit.get("subject") or objective.get("subject") or "—"),
            curriculum=str(objective.get("curriculum_title") or unit.get("grade") or "—"),
            objective_title=str(objective.get("title") or "—"),
            objective_description=str(objective.get("description") or "—")[:1500],
            unit_title=str(unit.get("title") or "—"),
            component_title=str(component.get("title") or component.get("id") or "—"),
            purpose=str(component.get("purpose") or "—"),
            notes=str(component.get("information_to_bot") or "—")[:_NOTES_LIMIT],
            questions=json.dumps(_question_texts(component), ensure_ascii=False)[:6000] or "[]",
        )},
    ]


def _fallback(
    component: dict[str, Any], unit: Optional[dict[str, Any]],
    objective: Optional[dict[str, Any]], language: str,
) -> str:
    """A paragraph from the catalog titles alone — honest, thin, never stored."""
    unit = unit or {}
    objective = objective or {}
    component_title = str(component.get("title") or component.get("id") or "")
    unit_title = str(unit.get("title") or "")
    objective_title = str(objective.get("title") or "")
    purpose = str(component.get("purpose") or "")
    if language == "he":
        parts = [f"בשיעור הזה לומדים על {component_title}"]
        if unit_title:
            parts.append(f"בתוך היחידה \"{unit_title}\"")
        if objective_title:
            parts.append(f"כחלק מהמטרה \"{objective_title}\"")
        text = " ".join(parts) + "."
        if purpose:
            text += f" מטרת השיעור: {purpose}."
        return text
    if language == "ar":
        parts = [f"في هذا الدرس نتعلم عن {component_title}"]
        if unit_title:
            parts.append(f"ضمن الوحدة \"{unit_title}\"")
        if objective_title:
            parts.append(f"كجزء من الهدف \"{objective_title}\"")
        text = " ".join(parts) + "."
        if purpose:
            text += f" غاية الدرس: {purpose}."
        return text
    parts = [f"In this lesson the kid learns about {component_title}"]
    if unit_title:
        parts.append(f"within the unit \"{unit_title}\"")
    if objective_title:
        parts.append(f"as part of the objective \"{objective_title}\"")
    text = " ".join(parts) + "."
    if purpose:
        text += f" Lesson purpose: {purpose}."
    return text


async def _generate(
    component: dict[str, Any], unit: Optional[dict[str, Any]],
    objective: Optional[dict[str, Any]], *, actor_id: str, language: str,
) -> Optional[str]:
    """The model's paragraph, screened; None on any failure."""
    from app.agents import safety
    from app.services.games.jobs import FEATURE
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    component_id = str(component.get("id") or "")
    try:
        raw = await call_llm(
            _prompt(component, unit, objective, language),
            usage_context=UsageContext(
                actor_id=actor_id, actor_type="learner",
                endpoint="internal:game_learning_description", feature=FEATURE,
                operation="game.learning_description", source="games.prepare",
                request_id=component_id or None,
            ),
            model_tier="mini", json_mode=True, max_tokens=500, timeout=20,
        )
    except Exception as exc:
        log.warning("learning description for %s failed: %s", component_id, type(exc).__name__)
        return None
    if not raw:
        return None
    payload = loads_model_json(raw)
    if not isinstance(payload, dict):
        return None
    text = " ".join(str(payload.get("description") or "").split())
    text = safety.screen_output(text, language).text.strip()
    if len(text) < MIN_DESCRIPTION_CHARS:
        return None
    return text[:MAX_DESCRIPTION_CHARS]


# ── the entry point ──────────────────────────────────────────────────────────

async def ensure_description(
    component: dict[str, Any], unit: Optional[dict[str, Any]],
    objective: Optional[dict[str, Any]], *, actor_id: str, language: str = "he",
) -> str:
    """The paragraph for one component — cached, or generated once and stored.

    A stored row whose fingerprint no longer matches the authored content is
    regenerated. Concurrent callers for the same (component, language) share
    one task. On failure the deterministic fallback is returned and nothing
    is written, so the next caller asks the model again.
    """
    language = _language(language)
    component_id = str(component.get("id") or "")
    fp = fingerprint(component, unit, objective)
    doc = await _stored(component_id, language)
    if doc and doc.get("text") and doc.get("fingerprint") == fp:
        return str(doc["text"])

    task_key = f"{component_id}|{language}"
    task = _tasks.get(task_key)
    if task is None or task.done():
        async def _run() -> str:
            try:
                text = await _generate(component, unit, objective, actor_id=actor_id, language=language)
                if text is None:
                    return _fallback(component, unit, objective, language)
                await _store(component_id, language, text, fp)
                return text
            finally:
                _tasks.pop(task_key, None)
        task = asyncio.create_task(_run())
        _tasks[task_key] = task
    try:
        return await task
    except Exception as exc:  # pragma: no cover - _run never raises past _generate
        log.warning("learning description task for %s failed: %s", component_id, type(exc).__name__)
        return _fallback(component, unit, objective, language)


def reset_for_tests() -> None:
    _tasks.clear()
