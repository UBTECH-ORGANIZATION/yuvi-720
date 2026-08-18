"""Why each hard topic is hard, in two sentences, cached until progress moves.

## What it is for

The profile's hardest-topics card groups a child's questions by objective and
shows the numbers. The numbers say *that* a topic went badly; the content's own
`teaches` texts say *what the child was actually being taught* — but raw they
are a wall of authored prose no teacher reads. One mini-tier call turns them
into a short paragraph per topic, written once and cached.

## The aggregation runs here too, deliberately

`TeacherStudentPage.buildTopicSections` builds the same topics client-side for
display. The server rebuilds them from `learner_activity.question_summary` +
`learning_analytics.label_learner_rows` with the SAME keys (`obj:<id>`,
`unit:<title>`, `lesson:<component id>`) and the SAME thresholds, so a digest
paragraph can find its row by key — and so the LLM's input and the cache
fingerprint are never client-trusted. Keep the two ports in lockstep.

## Cached like goal suggestions

The cache row is keyed `learner|language|subject|prompt-version` and carries a
fingerprint of the evidence — sorted `(key, attempts, correct)` triples. The
digest regenerates only when that moves, i.e. when the child actually worked.
GET never generates (`allow_generate=False`); POST may. A concurrent POST for
the same key joins the in-flight task instead of paying for a second call.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional

from app.services.ai_usage import UsageContext

COLLECTION = "topic_digests"

#: Part of the cache id. Bump when the prompt or the output shape changes, so
#: stale-shape rows are simply never found rather than migrated.
PROMPT_VERSION = "v1"

# Mirrors of the client's constants — the lockstep contract.
TOPIC_MIN_ATTEMPTS = 4
TOPICS_PER_SUBJECT = 8
TOPIC_TEACHES_RATE = 0.7

MAX_SENTENCES = 3
MAX_SENTENCE_CHARS = 260

_SURFACE = {"rate", "attempts", "questions", "zero_correct"}
_LANG = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

#: One in-flight generation per cache key — two teachers opening the same
#: profile must not pay for two identical calls (question_explainer's pattern).
_tasks: dict[str, "asyncio.Task[Any]"] = {}


def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def cache_id(learner_id: str, language: str, subject: Optional[str]) -> str:
    return f"{learner_id}|{language}|{subject or 'all'}|{PROMPT_VERSION}"


def fingerprint(topics: list[dict[str, Any]]) -> str:
    """The evidence, reduced to what regeneration should react to: the child
    worked (attempts moved) or got something right (correct moved). Wording of
    titles and teaches texts is NOT in it — a catalogue retitle is not news
    about the child."""
    blob = json.dumps(
        sorted((t["key"], t["attempts"], t["correct"]) for t in topics),
        ensure_ascii=False,
    )
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:16]


# ── the aggregation (client port — same keys, same thresholds) ───────────────

def build_topics(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """`buildTopicSections`, server-side, flattened across subjects."""
    by_subject: dict[str, dict[str, dict[str, Any]]] = {}
    for row in rows:
        if not row.get("attempts"):
            continue  # a screen only read is not evidence of difficulty
        objective_title = str(row.get("objective_title") or "").strip()
        unit_title = str(row.get("unit_title") or "").strip()
        learning_title = str(row.get("learning_title") or "").strip()
        if row.get("objective_id") and objective_title:
            key, label, level = f"obj:{row['objective_id']}", objective_title, "objective"
        elif unit_title:
            key, label, level = f"unit:{unit_title}", unit_title, "unit"
        elif learning_title:
            key = f"lesson:{row.get('component_id') or learning_title}"
            label, level = learning_title, "lesson"
        else:
            continue  # no authored title at any level → contributes nothing
        subject = str(row.get("subject") or "").strip()
        topics = by_subject.setdefault(subject, {})
        topic = topics.setdefault(key, {
            "key": key, "label": label, "level": level,
            "objective_id": row.get("objective_id"), "subject": subject,
            "attempts": 0, "correct": 0, "questions": 0,
            "teaches": [], "unit_titles": [],
        })
        attempts = int(row.get("attempts") or 0)
        correct = int(row.get("correct") or 0)
        topic["attempts"] += attempts
        topic["correct"] += correct
        topic["questions"] += 1
        if unit_title and unit_title not in topic["unit_titles"]:
            topic["unit_titles"].append(unit_title)
        teaches = str(row.get("teaches") or "").strip()
        if teaches and attempts and correct / attempts < TOPIC_TEACHES_RATE \
                and teaches not in topic["teaches"]:
            topic["teaches"].append(teaches)

    ranked_all: list[dict[str, Any]] = []
    for topics in by_subject.values():
        # Objective titles collide (the registry names them at sub-topic level);
        # colliding rows fall to their distinct unit titles, as the client does.
        label_count: dict[str, int] = {}
        for topic in topics.values():
            if topic["level"] == "objective":
                label_count[topic["label"]] = label_count.get(topic["label"], 0) + 1
        for topic in topics.values():
            if topic["level"] == "objective" and label_count.get(topic["label"], 0) >= 2 \
                    and topic["unit_titles"]:
                topic["label"] = " · ".join(topic["unit_titles"])
                topic["level"] = "unit"
        ranked = [t for t in topics.values() if t["attempts"] >= TOPIC_MIN_ATTEMPTS]
        for topic in ranked:
            topic["rate"] = topic["correct"] / topic["attempts"]
        ranked.sort(key=lambda t: (t["rate"], -t["attempts"]))
        ranked_all.extend(ranked[:TOPICS_PER_SUBJECT])
    return ranked_all


# ── the one call ─────────────────────────────────────────────────────────────

_PROMPT = """You are Yuvi, summarising for a teacher why each listed topic has
been hard for one student. Everything you may use is below — the topic's
numbers and the content's own descriptions of what the hard questions teach.
You have not met this student.

TOPICS:
{topics}

Answer with JSON only:
{{"topics": [{{"key": "the topic's key, copied exactly",
  "sentences": ["...", "..."],
  "surface": ["rate" | "attempts" | "questions" | "zero_correct", ...]}}, ...]}}

Rules:
- Write in {language}.
- Per topic 2 short sentences, 3 at most: what the questions there teach (from
  the descriptions, in your own plain words) and what the numbers show.
- Only claims the given numbers and descriptions support. Never invent a
  number, never diagnose, never describe character.
- Do not quote ids, keys or field names in the sentences.
- "surface" names which given numbers your sentences leaned on.
- A topic with no description texts still gets its numbers sentence.
- Gender-free phrasing where the language allows it.
"""


def _clean(payload: Any, known_keys: set[str]) -> Optional[list[dict[str, Any]]]:
    """Bound what came back. None when nothing usable — never cached as empty."""
    if not isinstance(payload, dict) or not isinstance(payload.get("topics"), list):
        return None
    out: list[dict[str, Any]] = []
    for item in payload["topics"]:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "")
        if key not in known_keys:
            continue  # an invented topic is exactly what must not reach a teacher
        sentences = [
            str(s).strip()[:MAX_SENTENCE_CHARS]
            for s in (item.get("sentences") or [])[:MAX_SENTENCES]
            if str(s or "").strip()
        ]
        if not sentences:
            continue
        surface = [s for s in (item.get("surface") or []) if s in _SURFACE]
        out.append({"key": key, "sentences": sentences, "surface": surface})
    return out or None


async def _generate(topics: list[dict[str, Any]], teacher_id: str, learner_id: str,
                    language: str) -> Optional[list[dict[str, Any]]]:
    from app.services.llm import call_llm
    from app.services.tasks.spec import loads_model_json

    described = [{
        "key": t["key"],
        "topic": t["label"],
        "subject": t["subject"],
        "questions": t["questions"],
        "attempts": t["attempts"],
        "correct": t["correct"],
        "what_the_hard_questions_teach": t["teaches"][:4],
    } for t in topics]
    prompt = _PROMPT.format(
        topics=json.dumps(described, ensure_ascii=False)[:9000],
        language=_LANG.get(language, "Hebrew"),
    )
    raw = await call_llm(
        [{"role": "user", "content": prompt}],
        usage_context=UsageContext(
            actor_id=teacher_id, actor_type="teacher",
            endpoint="internal:topic_digest", feature="teacher_topic_digest",
            operation="teacher.topic_digest", source="student_profile",
            request_id=learner_id,
        ),
        max_tokens=1200, json_mode=True, model_tier="mini",
    )
    if not raw:
        return None
    return _clean(loads_model_json(raw), {t["key"] for t in topics})


# ── the entry point ──────────────────────────────────────────────────────────

async def topic_digest(
    learner_id: str, teacher_id: str, *,
    language: str = "he", subject: Optional[str] = None,
    allow_generate: bool = True,
) -> dict[str, Any]:
    """The digest for this child's hard topics — cached, or freshly written.

    Always answers. `has_evidence=False` means there are no topics to digest;
    `stale=True` means the child has worked since the paragraphs were written;
    `unavailable=True` means generation was allowed, tried and failed.
    """
    from app.services import kata_catalog, learner_activity, learning_analytics

    language = language if language in _LANG else "he"
    rows = await learner_activity.question_summary(learner_id, subject=subject)
    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass  # rows degrade to unlabelled → fewer topics, never a crash
    topics = build_topics(learning_analytics.label_learner_rows(rows, language=language))

    if not topics:
        return {"topics": [], "cached": False, "generated_at": None,
                "stale": False, "has_evidence": False}

    print_fingerprint = fingerprint(topics)
    key = cache_id(learner_id, language, subject)
    handle = _collection()
    existing = None
    if handle is not None:
        try:
            existing = await handle.find_one({"_id": key})
        except Exception:  # pragma: no cover - a cache miss, not a failure
            existing = None

    fresh = bool(existing) and existing.get("fingerprint") == print_fingerprint
    if existing and (fresh or not allow_generate):
        return {"topics": existing.get("topics") or [],
                "cached": True,
                "generated_at": existing.get("generated_at"),
                "stale": not fresh,
                "has_evidence": True}
    if not allow_generate:
        return {"topics": [], "cached": False, "generated_at": None,
                "stale": False, "has_evidence": True}

    # One generation per key at a time; latecomers await the same task.
    task = _tasks.get(key)
    if task is None or task.done():
        async def _run() -> Optional[list[dict[str, Any]]]:
            try:
                return await _generate(topics, teacher_id, learner_id, language)
            finally:
                _tasks.pop(key, None)
        task = asyncio.create_task(_run())
        _tasks[key] = task
    try:
        digest = await task
    except Exception:
        digest = None

    if digest is None:
        # Not cached: a failed call must stay retryable, and yesterday's
        # paragraphs (if any) are still worth more than nothing.
        if existing:
            return {"topics": existing.get("topics") or [],
                    "cached": True,
                    "generated_at": existing.get("generated_at"),
                    "stale": True, "has_evidence": True,
                    "unavailable": True}
        return {"topics": [], "cached": False, "generated_at": None,
                "stale": False, "has_evidence": True, "unavailable": True}

    at = _now_iso()
    if handle is not None:
        try:
            await handle.update_one(
                {"_id": key},
                {"$set": {"_id": key, "learner_id": learner_id,
                          "language": language, "subject": subject or None,
                          "fingerprint": print_fingerprint,
                          "topics": digest, "generated_at": at}},
                upsert=True,
            )
        except Exception as exc:  # pragma: no cover - the digest still returns
            print(f"⚠️ topic digest not cached: {type(exc).__name__}: {exc}")
    return {"topics": digest, "cached": False, "generated_at": at,
            "stale": False, "has_evidence": True}
