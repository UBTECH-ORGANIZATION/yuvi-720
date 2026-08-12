"""Drafting the teacher's notes to Yuvi, from the form they have half-filled.

## Why this field, and only this field

Everything else in the builder is the teacher's decision — the title, who it
goes to, how many questions, when it is due. Inferring any of those adds a way
to get them wrong and saves nobody anything.

The notes are different. They are the only free-text field, they are the whole
of what the generator knows beyond a topic string, and they are the field a
busy teacher leaves empty — which produces a task about a topic in general
rather than about their class. So this drafts a starting point *from what they
have already told the form*, and hands it back as editable text. Nothing is
committed: the teacher sees the sentence before it is theirs.

## What it is not allowed to do

- It never invents the subject matter. It gets the picked lesson's own
  description from the catalogue and works from that.
- It never writes questions. Those come later, from a different prompt, at a
  different tier, and a note that contains the questions makes the generator's
  job smaller rather than better-specified.
- It never mentions a child by name. The prompt is given a count, not a roster.

Mini tier: this is one short paragraph of pedagogy-flavoured prose, and it runs
while a teacher waits inside a dialog.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

MAX_NOTES = 600

#: What must be on the form before there is anything to work from. An empty
#: form produces a note about nothing, which is worse than no note — the
#: teacher pastes it, and the generator is now grounded on filler.
REQUIRED = ("title", "components", "subject_matter")

_PROMPT = {
    "he": (
        "את/ה עוזר/ת למורה לנסח הנחיות קצרות ל\"יובי\", המערכת שתייצר את תוכן המשימה.\n"
        "ההנחיות נכתבות מנקודת המבט של המורה, בגוף ראשון, בעברית.\n"
        "כתוב/כתבי פסקה אחת, 2–4 משפטים, שמסבירה:\n"
        "  · על מה בדיוק להתמקד בתוכן,\n"
        "  · אילו טעויות נפוצות כדאי לתרגל או להימנע מהן,\n"
        "  · באיזה ניסוח או ייצוג נוח לכיתה הזאת.\n"
        "אל תכתוב/י שאלות, אל תמנה/י מספרים שכבר נבחרו בטופס, "
        "ואל תזכיר/י שמות של תלמידים.\n"
        "החזר/י JSON בלבד: {\"notes\": \"...\"}"
    ),
    "ar": (
        "أنت تساعد معلّمًا على صياغة إرشادات قصيرة لـ\"يوفي\"، النظام الذي سينتج محتوى المهمة.\n"
        "تُكتب الإرشادات بصيغة المتكلم، بالعربية.\n"
        "اكتب فقرة واحدة من 2-4 جمل توضّح: على ماذا يجب التركيز، أي أخطاء شائعة "
        "يجدر تدريبها أو تجنّبها، وأي صياغة أو تمثيل يناسب هذا الصف.\n"
        "لا تكتب أسئلة، ولا تكرّر أرقامًا اختيرت في النموذج، ولا تذكر أسماء طلاب.\n"
        "أعد JSON فقط: {\"notes\": \"...\"}"
    ),
    "en": (
        "You help a teacher write short instructions for \"Yuvi\", the system that "
        "will generate the task content.\n"
        "Write them in the teacher's own voice, first person, in English.\n"
        "One paragraph, 2-4 sentences: what to focus on, which common mistakes to "
        "practise or avoid, and what phrasing or representation suits this class.\n"
        "Do not write questions, do not repeat numbers already chosen on the form, "
        "and never name a student.\n"
        "Return JSON only: {\"notes\": \"...\"}"
    ),
}


def missing_fields(form: dict[str, Any]) -> list[str]:
    """Which required inputs are still empty, in the order the form asks them.

    Returned rather than raised so the UI can say *which* — a disabled button
    with no reason is the worst version of this feature, and the reason has to
    change as the teacher types.
    """
    missing: list[str] = []
    if not str(form.get("title") or "").strip():
        missing.append("title")
    if not [c for c in (form.get("components") or []) if str(c or "").strip()]:
        missing.append("components")
    # Either a topic in the teacher's words or a lesson from the catalogue.
    # One of the two is what the note is going to be *about*.
    source = form.get("source") if isinstance(form.get("source"), dict) else {}
    if not str(form.get("topic") or "").strip() and not source.get("component_id"):
        missing.append("subject_matter")
    return missing


def _lesson_context(form: dict[str, Any], language: str) -> list[str]:
    """The catalogue's own description of the picked lesson. Never invented."""
    source = form.get("source") if isinstance(form.get("source"), dict) else {}
    component_id = source.get("component_id")
    if not component_id:
        return []
    from app.services import kata_catalog

    lines: list[str] = []
    title = kata_catalog.component_title(component_id, language)
    objective = kata_catalog.objective_title(source.get("objective_id"), language)
    if objective:
        lines.append(f"Learning objective: {objective}")
    if title:
        lines.append(f"Lesson: {title}")
    for profile in kata_catalog.item_profiles(component_id)[:6]:
        information = kata_catalog.information_for_item(component_id, profile.get("id"))
        text = " ".join(str(information or "").split())[:300]
        if text:
            lines.append(f"  - {text}")
    return lines


def _ask(form: dict[str, Any], language: str) -> str:
    parts = [
        f"Task title: {form.get('title')}",
        f"Topic: {form.get('topic') or '(taken from the lesson below)'}",
        f"Difficulty: {form.get('difficulty') or 'medium'}",
        f"Parts of the task: {', '.join(form.get('components') or [])}",
    ]
    learners = form.get("learner_count")
    if isinstance(learners, int) and learners > 0:
        parts.append(f"Going to {learners} learner(s).")
    parts.extend(_lesson_context(form, language))
    draft = str(form.get("notes") or "").strip()
    if draft:
        # Improve rather than replace. A teacher who has written half a
        # sentence has told you the most important thing on the form.
        parts.append(f"\nThe teacher has started writing this — keep their "
                     f"intent and sharpen it:\n{draft[:MAX_NOTES]}")
    return "\n".join(parts)


async def suggest_notes(
    form: dict[str, Any],
    *,
    language: str = "he",
    teacher_id: str = "",
    org_id: Optional[str] = None,
) -> dict[str, Any]:
    """One drafted paragraph, or a list of what the form still needs.

    Never raises on a model failure: the field is optional and the teacher can
    always write it themselves, so a dead provider means "no suggestion", not a
    broken dialog.
    """
    missing = missing_fields(form)
    if missing:
        return {"notes": None, "missing": missing}

    locale = language if language in _PROMPT else "he"
    try:
        raw = await call_llm(
            [{"role": "system", "content": _PROMPT[locale]},
             {"role": "user", "content": _ask(form, locale)}],
            usage_context=UsageContext(
                actor_id=teacher_id or "system", actor_type="teacher",
                endpoint="internal:task_notes_suggest",
                feature="feature_5_teacher_tasks",
                operation="task.suggest_notes", source="task_builder",
            ),
            max_tokens=400, json_mode=True, model_tier="mini",
        )
    except Exception as exc:
        print(f"⚠️ notes suggestion failed: {type(exc).__name__}")
        return {"notes": None, "missing": [], "error": "unavailable"}

    from app.services.tasks.spec import loads_model_json, sanitize_math

    payload = loads_model_json(raw)
    text = ""
    if isinstance(payload, dict):
        text = str(payload.get("notes") or "")
    elif isinstance(payload, str):
        text = payload
    text = sanitize_math(" ".join(text.split()))[:MAX_NOTES].strip()
    if not text:
        return {"notes": None, "missing": [], "error": "unavailable"}
    return {"notes": text, "missing": []}
