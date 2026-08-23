"""Short generated topic names for questions — decided once, never re-rolled.

## What it is for

"שאלה 1 • סעיף 2" tells a teacher nothing: they did not write the lesson and
cannot look up question 1. Kata carries no per-question topic (the only
authored topic text is the SCREEN title, and one screen can hold several
parts), so a 2–4 word name is generated ONCE from the authored question text
and stored against the question. This knowingly relaxes #250's authored-only
labelling rule; what keeps it honest:

* Generated FROM the authored ``questionText`` — a compression of real
  content, never an invention. ``answers``/``correctAnswers`` never enter the
  prompt, the fingerprint, or this module's output.
* Decided once and stored. A stored ``null`` IS a decision — the model was
  asked, could not name the question honestly (or the candidate was rejected),
  and the client falls back to the screen title plus the content's own part
  label. Nulls are never re-asked; only a transport failure stays retryable.
* Regeneration happens only when the authored content itself changes — the
  fingerprint hashes the question's text, its screen title and its sibling
  parts, so a vendor edit is news and a re-read never is.

## Cached like goal suggestions / topic digests

Rows are learner- and group-independent: the first teacher to open any class's
breakdown pays one batched mini call per lomda per language; everyone else
reuses. GET paths never generate (``learning_detail`` only reads what is
stored); the POST route calls :func:`ensure_topics`. A concurrent POST for the
same lomda joins the in-flight task instead of paying twice.

A part-2 question's text is frequently a context-free fragment ("האם על שחר
לבצע מדידה נוספת?"), so the prompt row carries the whole screen: title, part
index and sibling parts' texts — the same reading ``context_engine``'s
``screen_parts`` does for the coach.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from app.services.ai_usage import UsageContext

COLLECTION = "question_topics"

#: Part of every doc id. Bump when the prompt changes in a way that makes
#: previously stored topics wrong — old rows become unreachable, never migrated.
PROMPT_VERSION = "v1"

MAX_TOPIC_WORDS = 6
MAX_TOPIC_CHARS = 60
_TEXT_LIMIT = 400

_LANG = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

#: One in-flight generation per (component, language) — two teachers opening
#: the same breakdown must not pay for two identical calls.
_tasks: dict[str, "asyncio.Task[tuple[dict[str, Optional[str]], int]]"] = {}


def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def map_key(component_id: str, item_id: Optional[str], question_id: Optional[str]) -> str:
    """The key the analytics layer looks topics up by."""
    return f"{component_id}|{item_id}|{question_id}"


def _doc_id(component_id: str, item_id: str, question_id: str, language: str) -> str:
    return f"{component_id}|{item_id}|{question_id}|{language}|{PROMPT_VERSION}"


def _catalog_questions(component_id: str) -> list[dict[str, Any]]:
    """Every question of the lomda, each carrying its whole screen's context."""
    from app.services import kata_catalog

    rows: list[dict[str, Any]] = []
    for profile in kata_catalog.item_profiles(component_id):
        item_id = profile.get("id")
        if not item_id:
            continue
        questions = kata_catalog.questions_for_item(component_id, item_id)
        texts = [str(q.get("questionText") or "").strip() for q in questions]
        for index, question in enumerate(questions):
            question_id = question.get("questionId")
            text = texts[index]
            if not question_id or not text:
                continue
            rows.append({
                "component_id": component_id,
                "item_id": item_id,
                "question_id": question_id,
                "text": text[:_TEXT_LIMIT],
                "screen_title": str(profile.get("title") or ""),
                "part": index + 1 if len(questions) >= 2 else None,
                "siblings": [t[:_TEXT_LIMIT] for j, t in enumerate(texts) if j != index and t],
            })
    return rows


def _fingerprint(row: dict[str, Any]) -> str:
    """What regeneration reacts to: the authored content itself. Answers are
    deliberately not in the blob — the hash must never travel near the key."""
    blob = json.dumps(
        [row["text"], row["screen_title"], sorted(row["siblings"])],
        ensure_ascii=False,
    )
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


async def _stored_docs(handle: Any, doc_ids: list[str]) -> dict[str, dict[str, Any]]:
    docs: dict[str, dict[str, Any]] = {}
    if handle is None or not doc_ids:
        return docs
    try:
        async for doc in handle.find({"_id": {"$in": doc_ids}}):
            docs[doc["_id"]] = doc
    except Exception:  # pragma: no cover - a cache miss, not a failure
        return {}
    return docs


async def topics_for(component_id: str, language: str = "he") -> dict[str, Optional[str]]:
    """Stored topic decisions for one lomda, keyed ``component|item|question``.

    A missing key means no decision exists yet (the client may POST to
    generate); a present ``None`` means the question was looked at and could
    not be named — fall back on the screen label, do not ask again.
    """
    return await topics_for_components([component_id], language)


async def topics_for_components(
    component_ids: Iterable[str], language: str = "he",
) -> dict[str, Optional[str]]:
    """One bulk read across lomdot — the student profile spans many."""
    language = language if language in _LANG else "he"
    handle = _collection()
    if handle is None:
        return {}
    doc_to_key: dict[str, str] = {}
    for component_id in dict.fromkeys(component_ids):
        for row in _catalog_questions(component_id):
            doc_id = _doc_id(component_id, row["item_id"], row["question_id"], language)
            doc_to_key[doc_id] = map_key(component_id, row["item_id"], row["question_id"])
    docs = await _stored_docs(handle, list(doc_to_key))
    return {doc_to_key[doc_id]: doc.get("topic") for doc_id, doc in docs.items()}


# ── the one call ─────────────────────────────────────────────────────────────

_PROMPT = """You are naming questions for a teacher's analytics table. Each
row below is one question from a learning unit, with its screen's title, its
part index within the screen, and the other parts sharing that screen.

For each question return a SHORT topic name in {language}: 2–4 words naming
the skill or idea the question is about, compressed from the authored text
below. A label, not a sentence, not a quote.

QUESTIONS:
{questions}

Answer with JSON only:
{{"topics": [{{"key": "copied exactly", "topic": "..." | null}}, ...]}}

Rules:
- 2–4 words per topic, never more than {max_words}.
- Use only what the question text, screen title and sibling parts say.
- Name the skill or idea; never quote story details, names or numbers.
- When the text is too thin to name honestly, return null for that key.
- Gender-free phrasing where the language allows it.
"""


def _normalized(text: str) -> str:
    return " ".join(str(text or "").split()).strip().lower()


def _acceptable(topic: str, source_text: str) -> bool:
    """conversation_titles' rejection rules, for a table label."""
    if not topic:
        return False
    if len(topic) > MAX_TOPIC_CHARS or len(topic.split()) > MAX_TOPIC_WORDS:
        return False
    if _normalized(topic) == _normalized(source_text):
        return False  # an echo of the question is not a name for it
    return True


def _clean(payload: Any, rows: list[dict[str, Any]], language: str) -> dict[str, Optional[str]]:
    """Bound what came back to decisions about questions we actually asked on.

    Returns key → topic-or-None for every key the model answered; keys it
    omitted are simply absent (retryable). A model-invented key is dropped —
    an invented topic is exactly what must not reach a teacher.
    """
    from app.agents import safety

    by_key = {map_key(r["component_id"], r["item_id"], r["question_id"]): r for r in rows}
    decided: dict[str, Optional[str]] = {}
    if not isinstance(payload, dict) or not isinstance(payload.get("topics"), list):
        return decided
    for item in payload["topics"]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "")
        row = by_key.get(key)
        if row is None:
            continue
        raw = item.get("topic")
        if raw is None:
            decided[key] = None
            continue
        topic = safety.screen_output(str(raw).strip(), language).text.strip()
        decided[key] = topic if _acceptable(topic, row["text"]) else None
    return decided


async def _generate(rows: list[dict[str, Any]], teacher_id: str,
                    language: str) -> Optional[dict[str, Optional[str]]]:
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    described = [{
        "key": map_key(row["component_id"], row["item_id"], row["question_id"]),
        "screen_title": row["screen_title"],
        "part": row["part"],
        "text": row["text"],
        "other_parts_on_this_screen": row["siblings"][:3],
    } for row in rows]
    prompt = _PROMPT.format(
        questions=json.dumps(described, ensure_ascii=False)[:12000],
        language=_LANG.get(language, "Hebrew"),
        max_words=MAX_TOPIC_WORDS,
    )
    raw = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=UsageContext(
            actor_id=teacher_id, actor_type="teacher",
            endpoint="internal:question_topics", feature="teacher_question_topics",
            operation="teacher.question_topics", source="learning_detail",
            request_id=rows[0]["component_id"] if rows else None,
        ),
        max_tokens=1200, json_mode=True, model_tier="mini",
    )
    if not raw:
        return None
    return _clean(loads_model_json(raw), rows, language)


# ── the entry point ──────────────────────────────────────────────────────────

async def ensure_topics(
    component_id: str, teacher_id: str, *, language: str = "he",
) -> dict[str, Any]:
    """Generate-and-store topics for every undecided question of one lomda.

    Only questions with no stored decision — or whose authored content changed
    under a stored one (fingerprint drift) — go to the model, in ONE batched
    call. Everything else is read back as-is. Returns the full topic map for
    the lomda plus how many decisions this call created.
    """
    from app.services import kata_catalog

    language = language if language in _LANG else "he"
    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass  # a stale snapshot still names questions; no snapshot → nothing to do

    rows = _catalog_questions(component_id)
    handle = _collection()
    if not rows or handle is None:
        return {"topics": {}, "generated": 0, "cached": True}

    doc_ids = {map_key(component_id, r["item_id"], r["question_id"]):
               _doc_id(component_id, r["item_id"], r["question_id"], language)
               for r in rows}
    stored = await _stored_docs(handle, list(doc_ids.values()))
    known = {key: stored[doc_id].get("topic")
             for key, doc_id in doc_ids.items() if doc_id in stored}

    todo = [
        row for row in rows
        if (doc := stored.get(doc_ids[map_key(component_id, row["item_id"], row["question_id"])]))
        is None or doc.get("fingerprint") != _fingerprint(row)
    ]
    if not todo:
        return {"topics": known, "generated": 0, "cached": True}

    # One generation per (lomda, language) at a time; latecomers join it.
    task_key = f"{component_id}|{language}"
    task = _tasks.get(task_key)
    if task is None or task.done():
        async def _run() -> tuple[dict[str, Optional[str]], int]:
            try:
                decided = await _generate(todo, teacher_id, language)
                if decided is None:
                    return {}, 0  # transport failure: store nothing, stay retryable
                at = _now_iso()
                by_key = {map_key(r["component_id"], r["item_id"], r["question_id"]): r
                          for r in todo}
                for key, topic in decided.items():
                    row = by_key[key]
                    try:
                        await handle.update_one(
                            {"_id": doc_ids[key]},
                            {"$set": {
                                "component_id": component_id,
                                "item_id": row["item_id"],
                                "question_id": row["question_id"],
                                "language": language,
                                "topic": topic,
                                "fingerprint": _fingerprint(row),
                                "generated_at": at,
                            }},
                            upsert=True,
                        )
                    except Exception as exc:  # pragma: no cover
                        print(f"⚠️ question topic not stored: {type(exc).__name__}: {exc}")
                return decided, len(decided)
            finally:
                _tasks.pop(task_key, None)
        task = asyncio.create_task(_run())
        _tasks[task_key] = task
    try:
        decided, generated = await task
    except Exception:
        decided, generated = {}, 0

    return {"topics": {**known, **decided}, "generated": generated,
            "cached": generated == 0}


def reset_for_tests() -> None:
    _tasks.clear()
