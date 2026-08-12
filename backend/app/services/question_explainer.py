"""Per-question generated explainer — "learn it another way".

A short slide deck (3–4 slides) that re-explains the question the learner is on
in a DIFFERENT way, with 1–2 Manim animations. It is cached by
``question_key = component|item|question`` + locale, which is LEARNER-INDEPENDENT
— so the first student to ask triggers generation and every future student on the
same question reuses it. Never regenerated unless the cache is cleared.

Grounding is strict (reuses the coach's no-fabrication rule): the deck is built
only from the question's real data + Kata's ``informationToBot`` teaching notes.
When exact values are missing it explains the *idea*, never invented numbers.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named
from app.services.ai_usage import UsageContext

MAX_SLIDES = 4
MAX_VISUALS = 2
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "question_explainers.json"

# In-process generation tasks keyed by cache id, so concurrent requests for a
# cold question don't each kick off a duplicate (expensive) generation.
_tasks: dict[str, "asyncio.Task[Any]"] = {}


_SYSTEM = {
    "he": (
        "אתה יובי, מלווה למידה. צור מיני-הסבר קצר של 3–4 שקופיות שמסביר בדרך אחרת "
        "את הרעיון שמאחורי השאלה הנוכחית, לתלמיד/ה בחטיבת ביניים, בעברית ברורה וחמה. "
        "בסס/י את ההסבר אך ורק על נתוני השאלה והערות ההוראה שסופקו — אל תחשוף/י את "
        "התשובה הסופית ישירות, ואל תמציא/י מספרים, ערכים או דוגמאות שאינם בנתונים. "
        "אם חסרים ערכים מדויקים — הסבר/י את הרעיון הכללי בלי להמציא מספרים. "
        "השקופית הראשונה ממסגרת בקצרה מה השאלה מבקשת ועל מה היא (לפי נתוני השאלה והתרחיש שלה, כולל שמות או הקשר אם מופיעים); "
        "השקופיות הבאות מסבירות את הרעיון בדרך אחרת ומוחשית, מחוברות לתרחיש של השאלה עצמה — אל תפתח/י בדימוי מנותק מהשאלה. "
        "כל שקופית: כותרת קצרה וגוף של 1–3 משפטים. סמן/י animate=true ל-1–2 שקופיות "
        "שבהן אנימציה חזותית תעזור, וב-visual_hint תאר/י בקצרה מה כדאי להנפיש. "
        'החזר/י JSON בלבד בפורמט: {"slides":[{"title":"...","body":"...","animate":true,"visual_hint":"..."}]}'
    ),
    "ar": (
        "أنت يوفي، رفيق تعلّم. أنشئ شرحًا مصغّرًا من 3–4 شرائح يشرح فكرة السؤال الحالي "
        "بطريقة مختلفة، لطالب/ة في المرحلة الإعدادية، بعربية واضحة ودافئة. استند/ي فقط "
        "إلى بيانات السؤال وملاحظات التدريس المقدَّمة — لا تكشف/ي الإجابة النهائية مباشرة، "
        "ولا تختلق/ي أرقامًا أو قيمًا أو أمثلة غير موجودة. إذا غابت القيم الدقيقة فاشرح/ي "
        "الفكرة العامة دون اختلاق أرقام. "
        "الشريحة الأولى تؤطّر باختصار ما يطلبه السؤال وعمّ يدور (وفق بيانات السؤال وسيناريوهه، بما فيها الأسماء أو السياق إن وُجدت)؛ "
        "والشرائح التالية تشرح الفكرة بطريقة أخرى ومحسوسة، متّصلة بسيناريو السؤال نفسه — لا تبدأ بتشبيه منفصل عن السؤال. "
        "كل شريحة: عنوان قصير وجسم من 1–3 جمل. ضع/ي "
        "animate=true لـ 1–2 شرائح تفيدها الحركة، وصف/ي في visual_hint ما يُنصح بتحريكه. "
        'أعِد/ي JSON فقط بالصيغة: {"slides":[{"title":"...","body":"...","animate":true,"visual_hint":"..."}]}'
    ),
    "en": (
        "You are Yuvi, a learning companion. Create a short 3–4 slide mini-lesson that "
        "re-explains the idea behind the current question in a DIFFERENT way, for a "
        "middle-schooler, in clear warm language. Ground it ONLY in the provided question "
        "data and teaching notes — do not reveal the final answer directly, and do not "
        "invent numbers, values, or examples not in the data. If exact values are missing, "
        "explain the general idea without inventing numbers. "
        "The FIRST slide briefly frames what the question asks and what it's about (from the question data and its scenario, including names or context if present); "
        "the following slides re-explain the idea a different, concrete way, connected to the question's own scenario — do not open with an analogy disconnected from the question. "
        "Each slide: a short title and "
        "a 1–3 sentence body. Set animate=true on 1–2 slides where a visual animation helps, "
        "and in visual_hint briefly describe what to animate. "
        'Return JSON ONLY as: {"slides":[{"title":"...","body":"...","animate":true,"visual_hint":"..."}]}'
    ),
}


def question_key_of(component_id: Optional[str], item_id: Optional[str], question_id: Optional[str]) -> str:
    return "|".join(str(part or "") for part in (component_id, item_id, question_id))


def _cache_id(question_key: str, locale: str) -> str:
    return f"{question_key}|{locale}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_fallback() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except Exception:
        return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


async def _load(cache_id: str) -> Optional[dict[str, Any]]:
    collection = _get_collection_named("question_explainers")
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": cache_id})
            if doc:
                doc.pop("_id", None)
                return doc
        except Exception:
            pass
    return _read_fallback().get(cache_id)


async def _store(cache_id: str, deck: dict[str, Any]) -> None:
    collection = _get_collection_named("question_explainers")
    if collection is not None:
        try:
            await collection.update_one({"_id": cache_id}, {"$set": {"_id": cache_id, **deck}}, upsert=True)
            return
        except Exception as exc:
            print(f"⚠️ question_explainers write failed, using fallback: {exc}")
    data = _read_fallback()
    data[cache_id] = deck
    _write_fallback(data)


async def _build_grounding(component_id: str, item_id: Optional[str], question_id: Optional[str]) -> str:
    from app.services import kata_catalog

    try:
        await kata_catalog.ensure_loaded()
    except Exception:
        pass
    questions = kata_catalog.questions_for_item(component_id, item_id) or []
    question = next(
        (q for q in questions if q.get("questionId") == question_id),
        questions[0] if questions else {},
    )
    info = kata_catalog.information_for_item(component_id, item_id) or ""
    parts = []
    if question.get("questionText"):
        parts.append(f"question_text: {question['questionText']}")
    if question.get("answers"):
        parts.append(f"answer_options: {question['answers']}")
    if question.get("correctAnswers"):
        parts.append(f"correct_answer_DO_NOT_STATE_DIRECTLY: {question['correctAnswers']}")
    if info:
        parts.append(f"teaching_notes: {info}")
    if not parts:
        parts.append(
            "No exact question data available. Explain the general concept the component "
            "teaches; do not invent specific numbers or examples."
        )
    return "\n".join(parts)


async def _generate(
    question_key: str, component_id: str, item_id: Optional[str],
    question_id: Optional[str], locale: str,
) -> dict[str, Any]:
    from app.services.llm import call_llm
    from app.agents.manim_visual import plan_manim_visual, render_visual
    from app.agents import safety

    lang = locale if locale in _SYSTEM else "he"
    grounding = await _build_grounding(component_id, item_id, question_id)
    usage = UsageContext(
        actor_id="system",
        actor_type="system",
        endpoint="internal:explainer",
        feature="feature_3_learning_companion",
        operation="explainer.generate",
        source="question_explainer",
    )
    raw = await call_llm(
        [{"role": "system", "content": _SYSTEM[lang]}, {"role": "user", "content": grounding}],
        usage_context=usage,
        max_tokens=1400,
        json_mode=True,
        model_tier="strong",
    )
    try:
        parsed = json.loads(raw or "{}")
    except Exception:
        parsed = {}
    slides_in = parsed.get("slides") if isinstance(parsed, dict) else None
    slides: list[dict[str, Any]] = []
    for entry in (slides_in or [])[:MAX_SLIDES]:
        if not isinstance(entry, dict):
            continue
        title = safety.screen_output(str(entry.get("title") or ""), lang).text
        body = safety.screen_output(str(entry.get("body") or ""), lang).text
        if not (title or body):
            continue
        slides.append({
            "title": title,
            "body": body,
            "_animate": bool(entry.get("animate")),
            "_hint": str(entry.get("visual_hint") or "").strip(),
        })

    visuals_made = 0
    for slide in slides:
        if slide.pop("_animate", False) and visuals_made < MAX_VISUALS:
            hint = slide.pop("_hint", "") or slide["title"]
            try:
                scene = await plan_manim_visual(
                    hint, slide["body"], lang, usage,
                    text_filter=lambda text: safety.screen_output(text, lang).text,
                    force_visual=True, prefer_animation=True,
                )
                if scene:
                    # Route through the dispatcher, not the Manim renderer
                    # directly: the explainer asks for animation, but a
                    # planner that returns a still must still get the
                    # in-browser path rather than a forced video.
                    rendered = await render_visual(scene)
                    if rendered:
                        slide["visual"] = rendered
                        visuals_made += 1
            except Exception as exc:  # a failed animation must not fail the deck
                print(f"⚠️ explainer visual render failed: {type(exc).__name__}")
        slide.pop("_animate", None)
        slide.pop("_hint", None)

    deck = {
        "question_key": question_key,
        "locale": lang,
        "slides": slides,
        "created_at": _now(),
    }
    await _store(_cache_id(question_key, lang), deck)
    return deck


async def get_or_start(
    component_id: Optional[str], item_id: Optional[str],
    question_id: Optional[str], locale: str,
) -> dict[str, Any]:
    """Return the cached deck (``ready``) or kick off generation (``generating``).

    The client polls this until it returns ``ready``. Learner-independent cache,
    so only the first student on a question ever waits.
    """
    if not component_id:
        return {"status": "unavailable"}
    lang = locale if locale in _SYSTEM else "he"
    question_key = question_key_of(component_id, item_id, question_id)
    cache_id = _cache_id(question_key, lang)

    cached = await _load(cache_id)
    if cached:
        return {"status": "ready", "deck": cached}

    task = _tasks.get(cache_id)
    if task and not task.done():
        return {"status": "generating"}

    async def _run() -> None:
        try:
            await _generate(question_key, component_id, item_id, question_id, lang)
        except Exception as exc:
            print(f"⚠️ explainer generation failed: {type(exc).__name__}: {exc}")
        finally:
            _tasks.pop(cache_id, None)

    _tasks[cache_id] = asyncio.create_task(_run())
    return {"status": "generating"}
