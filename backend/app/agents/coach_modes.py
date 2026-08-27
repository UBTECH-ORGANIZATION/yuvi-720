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

# Personal learner-management information belongs in the general companion,
# where it is not competing with the active lesson.
LESSON_MANAGEMENT_INTENTS = frozenset({
    "calendar_action_request",
    "calendar_clarification",
    "calendar_query",
    "goal_planning",
    "task_query",
})

LESSON_MANAGEMENT_REDIRECT = {
    "he": "היי, עכשיו אני מתמקד איתך בלמידת הלומדה. כדי לקבל מידע בנושא, אפשר לצאת מהלומדה ולדבר איתי שם. 📚",
    "ar": "مرحبًا، أنا أركز معك الآن على التعلّم في اللومدة. للحصول على معلومات في هذا الموضوع، يمكنك الخروج من اللومدة والتحدث معي هناك. 📚",
    "en": "Hi, I am focusing with you on this lesson right now. To get information about that, you can leave the lesson and talk with me there. 📚",
}


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


# Applied only after the general companion successfully offers a validated
# navigation action. The button owns the destination, so ordinary navigation
# requests should be acknowledged directly rather than framed as a limitation.
NAVIGATION_ACTION_REPLY_INSTRUCTIONS = {
    "he": (
        "זה עתה הוצעה לתלמיד/ה פעולת ניווט מאומתת. כתוב/י משפט אחד קצר בלבד, "
        "חם ומתאים לגיל. התייחס/י לפעולה הספציפית שהתלמיד/ה ביקש/ה במילים טבעיות, "
        "ואמור/י שהוספת כפתור שמוביל ליעד המבוקש. אפשר להוסיף אימוג'י אחד רק אם הוא מתאים טבעית. "
        "אל תאמר/י שאינך יכול/ה לבצע את הבקשה, אלא אם ניתנה לך הנחיה מפורשת לכך. "
        "אל תכתוב/י קישור, נתיב, הוראות לחיצה, שם כפתור או תיאור של מבנה האתר. "
        "אל תטען/י מה קיים או מה אפשר לעשות ביעד."
    ),
    "ar": (
        "تم الآن تقديم إجراء انتقال موثوق للطالب/ة. اكتب/ي جملة واحدة قصيرة فقط، "
        "ودّية ومناسبة للعمر. أشر/ي بكلمات طبيعية إلى الإجراء المحدد الذي طلبه الطالب/ة، "
        "وقُل/قولي إنك أضفت زرًا يقود إلى الوجهة المطلوبة. يمكن إضافة رمز تعبيري واحد فقط إذا كان مناسبًا طبيعيًا. "
        "لا تقُل/تقولي إنك لا تستطيع/ين تنفيذ الطلب إلا إذا تلقيت تعليمات صريحة بذلك. "
        "لا تكتب/ي رابطًا أو مسارًا أو تعليمات نقر أو اسم زر أو وصفًا لبنية الموقع. "
        "لا تدّعِ ما الموجود أو الممكن في الوجهة."
    ),
    "en": (
        "A validated navigation action was just offered to the learner. Write exactly one short, "
        "warm, age-appropriate sentence. Refer naturally to the specific action the learner asked for and say "
        "that you added a button leading to the requested destination. Use one emoji only if it fits naturally. "
        "Do not say you cannot complete the request unless you were explicitly instructed to do so. Do not "
        "write a link, path, click instruction, button name, or description of the site's layout. Do not "
        "claim what exists or can be done at the destination."
    ),
}


TEACHER_CHAT_ACTION_REPLY_INSTRUCTIONS = {
    "he": (
        "הבקשה היא ליצור קשר עם מורה או לתאם שיעור. כתוב/י משפט אחד קצר בלבד, חם ומתאים לגיל. "
        "הבהר/י שאינך יכול/ה ליצור קשר או לקבוע במקומו/ה של התלמיד/ה, אבל שהוספת כפתור לשיחה עם המורה. "
        "אפשר להוסיף אימוג'י אחד רק אם הוא מתאים טבעית. אל תכתוב/י קישור, נתיב, הוראות לחיצה או שם כפתור."
    ),
    "ar": (
        "الطلب هو التواصل مع معلّم/ة أو ترتيب درس. اكتب/ي جملة واحدة قصيرة فقط، ودّية ومناسبة للعمر. "
        "وضّح/ي أنك لا تستطيع/ين التواصل أو ترتيب ذلك بدلًا من الطالب/ة، لكنك أضفت زرًا للمحادثة مع المعلّم/ة. "
        "يمكن إضافة رمز تعبيري واحد فقط إذا كان مناسبًا طبيعيًا. لا تكتب/ي رابطًا أو مسارًا أو تعليمات نقر أو اسم زر."
    ),
    "en": (
        "The request is to contact a teacher or arrange a lesson. Write exactly one short, warm, age-appropriate sentence. "
        "Make clear that you cannot contact or arrange it on the learner's behalf, but that you added a button for teacher chat. "
        "Use one emoji only if it fits naturally. Do not write a link, path, click instruction, or button name."
    ),
}


def navigation_action_reply_instruction(language: str, action_id: str) -> str:
    """Return the reply boundary appropriate for the offered navigation action."""
    if action_id == "open_teacher_chat":
        return TEACHER_CHAT_ACTION_REPLY_INSTRUCTIONS.get(language, TEACHER_CHAT_ACTION_REPLY_INSTRUCTIONS["he"])
    return NAVIGATION_ACTION_REPLY_INSTRUCTIONS.get(language, NAVIGATION_ACTION_REPLY_INSTRUCTIONS["he"])


def resolve_mode(surface_context: dict[str, Any] | None) -> CoachMode:
    """Resolve the chat role from the current product surface.

    The caller may report a screen, but only the lesson surface can opt into
    lesson mode. Routes will later add verification of the active session.
    """
    screen = str((surface_context or {}).get("screen") or "")
    return CoachMode.LESSON if screen == LESSON_SCREEN else CoachMode.GENERAL


def lesson_management_redirect(intent: str, language: str) -> str | None:
    """Return the fixed lesson-focus reply for out-of-lesson management asks."""
    if intent not in LESSON_MANAGEMENT_INTENTS:
        return None
    return LESSON_MANAGEMENT_REDIRECT.get(language, LESSON_MANAGEMENT_REDIRECT["he"])


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