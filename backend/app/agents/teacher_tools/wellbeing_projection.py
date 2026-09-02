"""What the assistant may say about a child's wellbeing — decided in code.

A distress flag stores the child's own words as ``evidence`` ("עלה משפט על
גירושי ההורים"), and the profile screen shows them — that is the F6 rule:
a teacher told "needs attention" must be able to see the datum. The chat is a
different surface. Read aloud in an answer, the raw sentence arrived blunt and
out of context ("ב־27 באוגוסט עלה משפט על גירושי ההורים"), and the prompt's
request to be gentle did not hold (#538). So the words never reach the model
from here: every wellbeing flag the tools return is projected to its
category, its date and its source, plus a line saying the detail is on the
profile. The model can then only say what it was given.

Applied by the tools that carry flags (overview, alerts, description), on the
way out, after ``scrub`` — a structural guarantee, not a prompt hope.
"""

from __future__ import annotations

from typing import Any

#: One line per category and language. Deliberately unspecific: the profile
#: has the sentence; the chat has the shape of the concern.
_PHRASE = {
    "distress": {
        "he": "שיתוף רגשי שדורש תשומת לב — הפרטים בפרופיל התלמיד/ה",
        "ar": "مشاركة عاطفية تستدعي الانتباه — التفاصيل في ملف الطالب/ة",
        "en": "An emotional disclosure that needs attention — details on the student's profile",
    },
    "review": {
        "he": "הודעה שהמערכת עצרה לבדיקה — לא סימן מצוקה",
        "ar": "رسالة أوقفها النظام للمراجعة — ليست علامة ضائقة",
        "en": "A message the system held for review — not a distress signal",
    },
}

#: Keys that carry the child's words on a flag. ``reply`` is what the child was
#: told back; ``note`` is a check-in note. None of them belongs in the chat.
_RAW_KEYS = ("evidence", "reply", "note", "text", "message")


def _phrase(category: str, language: str) -> str:
    table = _PHRASE.get(category) or _PHRASE["distress"]
    return table.get(language) or table["he"]


def _is_wellbeing_flag(value: dict[str, Any]) -> bool:
    if value.get("kind") in ("wellbeing", "distress"):
        return True
    category = value.get("category")
    return isinstance(category, str) and category in _PHRASE and "evidence" in value


def _project_flag(value: dict[str, Any], language: str) -> dict[str, Any]:
    category = str(value.get("category") or "distress")
    if category not in _PHRASE:
        category = "distress"
    out = {key: item for key, item in value.items() if key not in _RAW_KEYS}
    out["category"] = category
    out["evidence"] = _phrase(category, language)
    out["detail_on_profile"] = True
    return out


def soften_wellbeing(value: Any, language: str = "he") -> Any:
    """Walk a tool payload and replace every wellbeing flag's words with its shape."""
    if isinstance(value, dict):
        if _is_wellbeing_flag(value):
            return _project_flag(value, language)
        return {
            key: soften_wellbeing(item, language)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [soften_wellbeing(item, language) for item in value]
    return value
