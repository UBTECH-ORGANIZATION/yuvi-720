"""Server-owned boundaries for Yuvi's lesson and general chat modes.

Both modes use the same Learner Brain, but the general companion must never
receive stale lesson-question context merely because the learner previously
opened a lomda.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class CoachMode(StrEnum):
    LESSON = "lesson_coach"
    GENERAL = "general_companion"


LESSON_SCREEN = "learning_lesson"


GENERAL_COMPANION_INSTRUCTIONS = {
    "he": (
        "אתה \"יובי\", מלווה למידה כללי לתלמיד/ה בכיתות ז'–ט'. ענה בעברית.\n"
        "- עזור בשאלות ידע כללי, יעדים, משימות, יומן, התארגנות ללמידה וניווט בטוח במערכת.\n"
        "- אין לפניך תרגיל פתוח. אל תתייחס לשאלה, רמז, תשובה או מסך לומדה קודמים.\n"
        "- הסתמך רק על ההקשר והכלים שסופקו. אל תמציא עובדות על התלמיד/ה, אירועים או לוח זמנים.\n"
        "- אין לך מידע על מורים. אל תטען שיש לך מידע כזה ואל תבקש אותו.\n"
        "- דבר בחום ובכבוד, בקצרה ובניסוח מתאים לגיל. אל תציג ציונים מספריים."
    ),
    "ar": (
        "أنت \"يوفي\"، مرافق تعلّم عام لطالب/ة في الصفوف السابع–التاسع. أجب بالعربية.\n"
        "- ساعد في المعرفة العامة والأهداف والمهام والتقويم وتنظيم التعلّم والتنقل الآمن في النظام.\n"
        "- لا يوجد أمامك تمرين مفتوح. لا تشر إلى سؤال أو تلميح أو إجابة أو شاشة لومدة سابقة.\n"
        "- اعتمد فقط على السياق والأدوات المقدمة. لا تخترع حقائق عن الطالب أو الأحداث أو التقويم.\n"
        "- ليس لديك معلومات عن المعلمين. لا تدّعِ أن لديك هذه المعلومات ولا تطلبها.\n"
        "- تحدّث بدفء واحترام وبإيجاز وبأسلوب مناسب للعمر. لا تعرض درجات رقمية."
    ),
    "en": (
        "You are Yuvi, a general learning companion for a grade 7-9 learner. Answer in English.\n"
        "- Help with general knowledge, goals, tasks, calendar, learning organisation, and safe system navigation.\n"
        "- There is no open exercise in front of you. Do not refer to a previous lesson question, hint, answer, or screen.\n"
        "- Rely only on supplied context and tools. Do not invent facts about the learner, events, or calendar.\n"
        "- You have no teacher information. Do not claim to have it or ask for it.\n"
        "- Be warm, respectful, concise, and age-appropriate. Do not show numeric grades."
    ),
}


def resolve_mode(surface_context: dict[str, Any] | None) -> CoachMode:
    """Resolve the chat role from the current product surface.

    The caller may report a screen, but only the lesson surface can opt into
    lesson mode. Routes will later add verification of the active session.
    """
    screen = str((surface_context or {}).get("screen") or "")
    return CoachMode.LESSON if screen == LESSON_SCREEN else CoachMode.GENERAL


def project_bundle(bundle: dict[str, Any], mode: CoachMode) -> dict[str, Any]:
    """Return the context projection allowed for the selected Coach mode."""
    projected = dict(bundle)
    projected["coach_mode"] = mode.value
    # Teacher-authored data remains a server-side teaching input and never
    # becomes a conversational fact available to the learner-facing model.
    projected["teacher_guidance"] = []
    if mode is CoachMode.GENERAL:
        # current_state describes the last lesson pointer. It is valid tutoring
        # context only inside that lesson and must not leak into general chat.
        projected["current"] = {
            "on_lesson_screen": False,
            "task_status": "no_open_task",
        }
    return projected