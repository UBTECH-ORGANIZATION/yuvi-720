"""Question-quality classifier for the learning chat (PBI 451).

"בסוף זה טוב שהוא משתמש ביובי, השאלה איך הוא משתמש ביובי" — the Independence
score needs to know WHAT a child asked, not how often. This module labels each
student message in the learning chat with one of six labels, ordered by
independence, at write time. The label is stored once on the message
(``sessions.set_question_quality``) and never recomputed — history is never
re-judged, and nothing classifies on read.

Scope: the learning chat only. Companion/general chat is gated out by
``is_learning_chat`` — the same boundary the ``yuvi_chat`` activity row uses
(a chat turn only counts when the learner is on a lesson question).
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

# Ordered by independence, least to most. `off_topic` is excluded from the
# independence sub-score and feeds concentration instead.
TAXONOMY = (
    "answer_seeking",
    "procedural",
    "verification",
    "conceptual",
    "self_diagnostic",
    "off_topic",
)

_MAX_MESSAGE_CHARS = 400

_SYSTEM_PROMPTS = {
    "he": (
        "אתה מסווג הודעות של תלמיד/ה בצ׳אט למידה עם מורה־עזר בשם יובי. "
        "סווג את ההודעה לתווית אחת בלבד:\n"
        "answer_seeking — מבקש/ת את התשובה עצמה (\"מה התשובה\", \"תפתור לי\").\n"
        "procedural — שואל/ת איך מבצעים שלב (\"איך עושים את זה\").\n"
        "verification — בודק/ת עבודה עצמית (\"זה נכון?\").\n"
        "conceptual — שואל/ת למה או מה ההבדל (\"למה זה עובד ככה\").\n"
        "self_diagnostic — מנתח/ת טעות של עצמו/ה (\"למה התשובה שלי לא נכונה\", \"התבלבלתי בין X ל-Y\").\n"
        "off_topic — לא קשור ללמידה.\n"
        'החזר JSON בלבד: {"label": "...", "confidence": 0.0-1.0}'
    ),
    "ar": (
        "أنت تصنّف رسائل طالب/ة في محادثة تعلّم مع مساعد اسمه يوفي. "
        "صنّف الرسالة إلى تسمية واحدة فقط:\n"
        "answer_seeking — يطلب الإجابة نفسها (\"ما الإجابة\").\n"
        "procedural — يسأل كيف تُنفَّذ خطوة (\"كيف أفعل ذلك\").\n"
        "verification — يتحقق من عمله (\"هل هذا صحيح؟\").\n"
        "conceptual — يسأل لماذا أو ما الفرق (\"لماذا يعمل هذا\").\n"
        "self_diagnostic — يحلّل خطأه (\"لماذا كانت إجابتي خاطئة\").\n"
        "off_topic — غير متعلق بالتعلم.\n"
        'أعد JSON فقط: {"label": "...", "confidence": 0.0-1.0}'
    ),
    "en": (
        "You classify a student's message in a learning chat with a tutor named Yuvi. "
        "Assign exactly one label:\n"
        "answer_seeking — asks for the answer itself (\"what's the answer\", \"solve it for me\").\n"
        "procedural — asks how to do a step (\"how do I do this\").\n"
        "verification — checks their own work (\"is this right?\").\n"
        "conceptual — asks why or what the difference is (\"why does this work\").\n"
        "self_diagnostic — analyses their own mistake (\"why was my answer wrong\", \"I mixed up X and Y\").\n"
        "off_topic — not about learning.\n"
        'Return JSON only: {"label": "...", "confidence": 0.0-1.0}'
    ),
}


def is_learning_chat(question_key: Optional[str], surface_context: Optional[dict]) -> bool:
    """The learning-chat gate: a lesson question is open, or the learner is on
    the lesson screen. Mirrors the ``yuvi_chat`` activity-row gate — general
    companion chat outside a lesson is never classified."""
    if question_key:
        return True
    return (surface_context or {}).get("screen") == "learning_lesson"


async def classify(
    message_text: str,
    *,
    subject: Optional[str],
    lang: str,
    usage_context: UsageContext,
) -> Optional[dict[str, Any]]:
    """One mini-tier call → ``{"label", "confidence"}``, or None (message stays
    unlabeled; never retried — a wrong label is a wrong judgement about a child,
    so anything invalid is dropped rather than coerced)."""
    from app.agents.safety import strip_pii
    from app.services.tasks.spec import loads_model_json

    text = (message_text or "").strip()
    if len(text) < 2:
        # "כן" / an emoji cannot be a question — skip the call entirely.
        return None
    clean_text, _ = strip_pii(text)
    system = _SYSTEM_PROMPTS.get(lang) or _SYSTEM_PROMPTS["he"]
    raw = await call_llm(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps({
                "message": clean_text[:_MAX_MESSAGE_CHARS],
                "subject": subject or None,
            }, ensure_ascii=False)},
        ],
        usage_context=usage_context,
        max_tokens=120,
        json_mode=True,
        model_tier="mini",
    )
    payload = loads_model_json(raw)
    if not isinstance(payload, dict):
        return None
    label = payload.get("label")
    if label not in TAXONOMY:
        return None
    confidence = payload.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    return {"label": label, "confidence": round(max(0.0, min(1.0, confidence)), 2), "v": 1}


async def classify_and_store(
    learner_id: str,
    session_id: str,
    exchange_id: str,
    message_text: str,
    *,
    subject: Optional[str],
    question_key: Optional[str],
    lang: str,
    role: str = "coach",
    usage_context: UsageContext,
) -> None:
    """Classify one learning-chat message and store the label twice: stamped
    on the message row (write-once, teacher-invisible to the student payload)
    and as a durable ``learner_signals`` row — the learning chat is a temporary
    ``lesson_coach`` thread whose messages are deleted on lesson exit, and the
    Independence score must survive that. Fire-and-forget; must never raise."""
    try:
        from app.agents import sessions

        # The message stamp is also the once-only guard: if the row is already
        # labeled (a replayed exchange), skip the durable write too.
        quality = await classify(
            message_text, subject=subject, lang=lang, usage_context=usage_context
        )
        if quality is None:
            return
        await sessions.set_question_quality(
            learner_id, session_id, exchange_id, quality, role=role
        )
        from app.services import learner_signals

        await learner_signals.record(
            learner_id,
            "question_quality",
            session_id=session_id,
            dedupe_key=f"qq:{exchange_id}",
            meta={
                "label": quality["label"],
                "confidence": quality["confidence"],
                "question_key": question_key,
            },
        )
    except Exception as exc:
        print(f"⚠️ question quality classification failed: {type(exc).__name__}: {exc}")


# Strong refs so a fire-and-forget classification is never GC-cancelled mid-write.
_tasks: set[asyncio.Task] = set()


def spawn(coro) -> None:
    """Schedule ``classify_and_store`` without blocking the reply stream."""
    try:
        task = asyncio.get_running_loop().create_task(coro)
        _tasks.add(task)
        task.add_done_callback(_tasks.discard)
    except RuntimeError:
        coro.close()
