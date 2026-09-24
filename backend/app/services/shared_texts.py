"""Generate once, share: arrival texts for every language, paid for once.

The nightly pregen (content_pipeline → content/context) writes the Hebrew
arrival texts — question intros, step intros, the welcome, video summaries —
so a Hebrew learner arriving at a screen costs zero model calls. An Arabic or
English learner, or a Hebrew one on a screen the nightly has not reached yet,
paid a full live call per learner per screen for the same learner-independent
opener.

``serve()`` closes that gap at runtime (``COACH_SHARED_TEXTS=on``):

1. a ``ready`` document for (kind, language, screen) whose content
   fingerprint still matches → served, no model call;
2. otherwise CLAIM it (an atomic insert — the claim is the lock) and write it
   with one small, learner-independent call; every other learner arriving
   meanwhile waits up to ``WAIT_SECONDS`` for it;
3. anything else (lost race past the wait, a failed or refused generation)
   → ``None``, and the coach falls through to its live path — today's
   behavior.

Never stored as ready: an empty text, one over the length cap, one in the
wrong script, one the answer guard flags ("the answer is…" or the correct
option), or one the safety screen rewrites — ``question_explainer`` cached
failures as answers, this does not. The same checks run again when a stored
text is served. Documents live in Mongo ``coach_shared_texts``; without a
database (tests, evals) an in-process dict stands in.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

KINDS = ("question_intro", "lesson_step_intro", "lesson_welcome", "video_summary")
PROMPT_VERSION = "st-v1"
WAIT_SECONDS = 2.5
#: A claim older than this is abandoned (its generator died) and may be retaken.
CLAIM_TTL_SECONDS = 30
_COLLECTION = "coach_shared_texts"
_MEMORY: dict[str, dict[str, Any]] = {}
_SCRIPT = {"he": re.compile(r"[֐-׿]"), "ar": re.compile(r"[؀-ۿ]"),
           "en": re.compile(r"[A-Za-z]")}
_ANSWER_SECTIONS = re.compile(
    r"(?:סימני\s+שליטה|רמזים\s+מדורגים|התשובה\s+הנכונה)[^\n]*(?:\n(?!\s*\n)[^\n]*)*")

_RULES = {
    "question_intro": {
        "he": "משפט פתיחה אחד או שניים שמזמין/ה לשאלה שעל המסך: מה הנושא ומה כדאי לבדוק קודם. בלי לצטט את השאלה, בלי לרמוז לתשובה.",
        "ar": "جملة أو جملتان تدعوان إلى السؤال الذي على الشاشة: ما الموضوع وما الذي يجدر فحصه أولًا. دون اقتباس السؤال ودون التلميح إلى الإجابة.",
        "en": "One or two sentences inviting the learner into the question on screen: what it is about and what to look at first. Do not quote the question and do not hint at the answer.",
    },
    "lesson_step_intro": {
        "he": "משפט פתיחה אחד או שניים למסך הלימוד: מה יש כאן ולמה כדאי לשים לב.",
        "ar": "جملة أو جملتان تفتتحان شاشة التعلّم: ما الموجود هنا وما الذي يجدر الانتباه إليه.",
        "en": "One or two sentences opening this learning screen: what is here and what to notice.",
    },
    "lesson_welcome": {
        "he": "משפט או שניים שמציגים את השיעור: על מה נלמד היום ולמה זה מעניין.",
        "ar": "جملة أو جملتان تقدّمان الدرس: ماذا سنتعلّم اليوم ولماذا هو مثير للاهتمام.",
        "en": "One or two sentences introducing the lesson: what we learn today and why it is interesting.",
    },
    "video_summary": {
        "he": "סיכום קצר של 2–4 משפטים של מה שהסרטון מראה, על סמך המידע בלבד.",
        "ar": "ملخّص قصير من 2–4 جمل لما يعرضه الفيديو، استنادًا إلى المعلومات فقط.",
        "en": "A short 2–4 sentence summary of what the video shows, from the given information only.",
    },
}
_CAPS = {"question_intro": 260, "lesson_step_intro": 260, "lesson_welcome": 260, "video_summary": 700}
_SYSTEM = {
    "he": "אתה יובי, מלווה למידה חם לתלמידי חטיבת ביניים. כתוב/כתבי בעברית פשוטה, בפנייה ברבים (לכם), בלי שמות ובלי פרטים אישיים. לעולם אל תחשוף/י תשובה. החזר/י את הטקסט בלבד.",
    "ar": "أنت يوفي، رفيق تعلّم دافئ لطلاب المرحلة الإعدادية. اكتب/ي بعربية بسيطة، بصيغة الجمع، دون أسماء أو تفاصيل شخصية. لا تكشف/ي الإجابة أبدًا. أعد/أعيدي النص فقط.",
    "en": "You are Yuvi, a warm learning companion for middle-school students. Write in plain English, addressing the learners in general, with no names or personal details. Never reveal an answer. Return the text only.",
}


def enabled() -> bool:
    return (os.environ.get("COACH_SHARED_TEXTS") or "off").strip().lower() in {"1", "on", "true", "yes"}


def reset_for_tests() -> None:
    _MEMORY.clear()


def _grounding(kind: str, current: dict[str, Any], lesson_title: str) -> dict[str, Any]:
    """Learner-independent source of the text. Never the correct answers,
    never the note's answer sections ("סימני שליטה")."""
    item = current.get("item") or {}
    question = current.get("question") or {}
    enrichment = current.get("screen_enrichment") or {}
    source: dict[str, Any] = {
        "lesson": lesson_title,
        "screen": item.get("title") or "",
        "screen_kind": item.get("kind") or "",
        "note": _ANSWER_SECTIONS.sub(" ", str(current.get("informationToBot") or ""))[:900],
        "visible": str(enrichment.get("visible_text") or "")[:600],
    }
    if kind == "question_intro":
        source["question"] = question.get("text") or ""
        source["options"] = list(question.get("options") or [])[:8]
    return source


def fingerprint(source: dict[str, Any]) -> str:
    raw = json.dumps(source, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(f"{PROMPT_VERSION}|{raw}".encode("utf-8")).hexdigest()[:24]


def _doc_id(kind: str, lang: str, current: dict[str, Any]) -> str:
    return "|".join((kind, lang, str(current.get("component_id") or ""),
                     "" if kind == "lesson_welcome" else str(current.get("item_id") or ""),
                     str(current.get("question_id") or "") if kind == "question_intro" else ""))


def vet(text: str, kind: str, lang: str, question: dict[str, Any]) -> Optional[str]:
    """The text as it may be served, or None. Run at write AND at serve."""
    from app.agents import answer_guard, safety

    body = str(text or "").strip().strip('"').strip()
    if not body or len(body) > _CAPS[kind] or not _SCRIPT[lang].search(body):
        return None
    if lang == "en" and _SCRIPT["he"].search(body):
        return None
    screened = safety.screen_output(body, lang).text.strip()
    if screened != body:
        return None
    guard = answer_guard.build(question if kind == "question_intro" else None)
    if answer_guard.asserts_an_answer(body) or guard.reveals(body):
        return None
    return body


# ── storage: Mongo when there is one, else in-process ───────────────────────

def _collection():
    try:
        from app.brain.repository import _get_collection_named
        return _get_collection_named(_COLLECTION)
    except Exception:
        return None


async def _get(doc_id: str) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is None:
        return _MEMORY.get(doc_id)
    try:
        return await collection.find_one({"_id": doc_id})
    except Exception:
        return None


async def _claim(doc_id: str, fp: str) -> bool:
    """True when THIS caller now owns generation for ``doc_id``."""
    now = time.time()
    fresh = {"_id": doc_id, "status": "claimed", "fingerprint": fp, "claimed_at": now}
    collection = _collection()
    if collection is None:
        current = _MEMORY.get(doc_id)
        if current and not _retakeable(current, fp, now):
            return False
        _MEMORY[doc_id] = fresh
        return True
    try:
        # Take it when absent, or when stale (content changed / abandoned claim
        # / failed) — one atomic filter, so two servers cannot both win.
        result = await collection.find_one_and_update(
            {"_id": doc_id, "$or": [
                {"fingerprint": {"$ne": fp}},
                {"status": "failed", "claimed_at": {"$lt": now - CLAIM_TTL_SECONDS}},
                {"status": "claimed", "claimed_at": {"$lt": now - CLAIM_TTL_SECONDS}},
            ]},
            {"$set": fresh})
        if result is not None:
            return True
        await collection.insert_one(fresh)
        return True
    except Exception:
        return False   # duplicate key: someone else holds it


def _retakeable(doc: dict[str, Any], fp: str, now: float) -> bool:
    if doc.get("fingerprint") != fp:
        return True
    if doc.get("status") in ("claimed", "failed"):
        return now - float(doc.get("claimed_at") or 0) > CLAIM_TTL_SECONDS
    return False


async def _put(doc_id: str, fields: dict[str, Any]) -> None:
    collection = _collection()
    if collection is None:
        _MEMORY.setdefault(doc_id, {"_id": doc_id}).update(fields)
        return
    try:
        await collection.update_one({"_id": doc_id}, {"$set": fields}, upsert=True)
    except Exception as exc:
        print(f"⚠️ shared text write failed: {type(exc).__name__}")


# ── serving ─────────────────────────────────────────────────────────────────

async def _generate(kind: str, lang: str, source: dict[str, Any], usage_context: Any) -> Optional[str]:
    from app.services.llm import call_llm

    prompt = (f"{_RULES[kind][lang]}\n\n"
              f"{json.dumps(source, ensure_ascii=False)}")
    return await call_llm(
        [{"role": "system", "content": _SYSTEM[lang]}, {"role": "user", "content": prompt}],
        usage_context=usage_context.for_operation(f"coach.shared_text.{kind}"),
        max_tokens=320, model_tier="mini")


async def serve(
    kind: str, lang: str, current: dict[str, Any], *, lesson_title: str, usage_context: Any,
) -> Optional[dict[str, Any]]:
    """{"text", "source": "shared"|"shared_new"} or None (→ live path)."""
    if kind not in KINDS or lang not in _SYSTEM or not current.get("component_id"):
        return None
    if kind != "lesson_welcome" and not current.get("item_id"):
        return None
    if kind == "question_intro" and not str((current.get("question") or {}).get("text") or "").strip():
        return None
    question = current.get("question") or {}
    source = _grounding(kind, current, lesson_title)
    fp = fingerprint(source)
    doc_id = _doc_id(kind, lang, current)
    doc = await _get(doc_id)
    if doc and doc.get("status") == "ready" and doc.get("fingerprint") == fp:
        text = vet(doc.get("text") or "", kind, lang, question)
        return {"text": text, "source": "shared"} if text else None
    if await _claim(doc_id, fp):
        try:
            raw = await _generate(kind, lang, source, usage_context)
        except Exception:
            raw = None
        text = vet(raw or "", kind, lang, question)
        stamp = datetime.now(timezone.utc).isoformat()
        if text:
            await _put(doc_id, {"status": "ready", "text": text, "fingerprint": fp,
                                "generated_at": stamp, "prompt_version": PROMPT_VERSION})
            return {"text": text, "source": "shared_new"}
        await _put(doc_id, {"status": "failed", "fingerprint": fp, "claimed_at": time.time(),
                            "failed_at": stamp})
        return None
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        await asyncio.sleep(0.25)
        doc = await _get(doc_id)
        if doc and doc.get("status") == "ready" and doc.get("fingerprint") == fp:
            text = vet(doc.get("text") or "", kind, lang, question)
            return {"text": text, "source": "shared"} if text else None
        if doc and doc.get("status") == "failed":
            return None
    return None
