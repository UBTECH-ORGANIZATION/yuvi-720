"""On-demand, privacy-safe learner calendar context for the Coach."""

from __future__ import annotations

import re
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from app.agents.safety import strip_pii
from app.services import student_calendar
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm
from app.services.student_calendar import CalendarPeriodName


MAX_CONTEXT_ITEMS = 30
ISRAEL_TIMEZONE = ZoneInfo("Asia/Jerusalem")
CalendarWeekday = Literal[
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
]
CalendarRouteIntent = Literal["calendar_query", "learning_help", "calendar_clarification"]

_WEEKDAY_INDEX: dict[CalendarWeekday, int] = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

_PERIOD_PATTERNS: dict[str, tuple[tuple[CalendarPeriodName, re.Pattern[str]], ...]] = {
    "he": (
        ("next_week", re.compile(r"שבוע\s*הבא", re.IGNORECASE)),
        ("this_week", re.compile(r"השבוע|שבוע\s*הזה", re.IGNORECASE)),
        ("tomorrow", re.compile(r"מחר", re.IGNORECASE)),
        ("today", re.compile(r"היום", re.IGNORECASE)),
    ),
    "ar": (
        ("next_week", re.compile(r"الأسبوع\s*(?:القادم|المقبل)", re.IGNORECASE)),
        ("this_week", re.compile(r"هذا\s*الأسبوع", re.IGNORECASE)),
        ("tomorrow", re.compile(r"غد[ًاا]?", re.IGNORECASE)),
        ("today", re.compile(r"اليوم", re.IGNORECASE)),
    ),
    "en": (
        ("next_week", re.compile(r"next\s+week", re.IGNORECASE)),
        ("this_week", re.compile(r"this\s+week", re.IGNORECASE)),
        ("tomorrow", re.compile(r"tomorrow", re.IGNORECASE)),
        ("today", re.compile(r"today", re.IGNORECASE)),
    ),
}

_WEEKDAY_PATTERNS: dict[str, tuple[tuple[CalendarWeekday, re.Pattern[str]], ...]] = {
    "he": (
        ("sunday", re.compile(r"(?:יום\s*)?ראשון", re.IGNORECASE)),
        ("monday", re.compile(r"(?:יום\s*)?שני", re.IGNORECASE)),
        ("tuesday", re.compile(r"(?:יום\s*)?שלישי", re.IGNORECASE)),
        ("wednesday", re.compile(r"(?:יום\s*)?רביעי", re.IGNORECASE)),
        ("thursday", re.compile(r"(?:יום\s*)?חמישי", re.IGNORECASE)),
        ("friday", re.compile(r"(?:יום\s*)?שישי", re.IGNORECASE)),
        ("saturday", re.compile(r"(?:יום\s*)?שבת", re.IGNORECASE)),
    ),
    "ar": (
        ("sunday", re.compile(r"الأحد", re.IGNORECASE)),
        ("monday", re.compile(r"الاثنين", re.IGNORECASE)),
        ("tuesday", re.compile(r"الثلاثاء", re.IGNORECASE)),
        ("wednesday", re.compile(r"الأربعاء", re.IGNORECASE)),
        ("thursday", re.compile(r"الخميس", re.IGNORECASE)),
        ("friday", re.compile(r"الجمعة", re.IGNORECASE)),
        ("saturday", re.compile(r"السبت", re.IGNORECASE)),
    ),
    "en": (
        ("sunday", re.compile(r"sunday", re.IGNORECASE)),
        ("monday", re.compile(r"monday", re.IGNORECASE)),
        ("tuesday", re.compile(r"tuesday", re.IGNORECASE)),
        ("wednesday", re.compile(r"wednesday", re.IGNORECASE)),
        ("thursday", re.compile(r"thursday", re.IGNORECASE)),
        ("friday", re.compile(r"friday", re.IGNORECASE)),
        ("saturday", re.compile(r"saturday", re.IGNORECASE)),
    ),
}

_FOLLOWUP_SIGNALS = {
    "he": re.compile(r"(?:^\s*ו|ומה|ומה לגבי|השבוע|שבוע הבא|היום|מחר|ביום|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)", re.IGNORECASE),
    "ar": re.compile(r"(?:وماذا|وماذا عن|اليوم|غد[ًاا]?|الأسبوع|الأحد|الاثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)", re.IGNORECASE),
    "en": re.compile(r"(?:and|what about|today|tomorrow|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)", re.IGNORECASE),
}

_FOLLOWUP_CLASSIFIER_PROMPTS = {
    "he": (
        "סווג/י שאלת המשך קצרה בשיחת יומן. החזר/י JSON בלבד. "
        "intent הוא calendar_query, other או unclear. period הוא today, tomorrow, this_week, next_week או unchanged. "
        "weekday הוא sunday עד saturday או null. confidence הוא מספר 0–1. "
        "בחר/י calendar_query רק כשההודעה ממשיכה את בקשת היומן הקודמת."
    ),
    "ar": (
        "صنّف سؤال متابعة قصيرًا في محادثة تقويم. أعد JSON فقط. "
        "intent هو calendar_query أو other أو unclear. period هو today أو tomorrow أو this_week أو next_week أو unchanged. "
        "weekday من sunday إلى saturday أو null. confidence رقم بين 0 و1. "
        "اختر calendar_query فقط إذا كانت الرسالة تتابع طلب التقويم السابق."
    ),
    "en": (
        "Classify a short follow-up in a calendar conversation. Return JSON only. "
        "intent must be calendar_query, other, or unclear. period must be today, tomorrow, this_week, next_week, or unchanged. "
        "weekday must be sunday through saturday or null. confidence must be 0–1. "
        "Choose calendar_query only when the message continues the previous calendar request."
    ),
}

_CLARIFICATION_REPLIES = {
    "he": "לא הייתי בטוח/ה לאיזה חלק ביומן התכוונת. אפשר לכתוב יום או טווח, למשל היום, מחר או השבוע הבא?",
    "ar": "لم أتأكد أي جزء من التقويم تقصد. هل يمكنك كتابة يوم أو فترة، مثل اليوم أو غدًا أو الأسبوع القادم؟",
    "en": "I wasn't sure which part of your calendar you meant. Could you name a day or period, such as today, tomorrow, or next week?",
}

_EMPTY_REPLIES = {
    "he": "לא מצאתי פריטים ביומן שלך לטווח הזה.",
    "ar": "لم أجد عناصر في تقويمك لهذه الفترة.",
    "en": "I couldn't find any items in your calendar for that period.",
}
_UNAVAILABLE_REPLIES = {
    "he": "לא הצלחתי לבדוק את היומן שלך כרגע. כדאי לנסות שוב בעוד רגע.",
    "ar": "لم أتمكن من التحقق من تقويمك الآن. حاول مرة أخرى بعد قليل.",
    "en": "I couldn't check your calendar right now. Please try again in a moment.",
}
_HEADINGS = {
    "he": "זה מה שמצאתי ביומן שלך:",
    "ar": "هذا ما وجدته في تقويمك:",
    "en": "Here is what I found in your calendar:",
}
_MORE_REPLIES = {
    "he": "יש פריטים נוספים ביומן מעבר לרשימה הזאת.",
    "ar": "توجد عناصر إضافية في التقويم غير ظاهرة في هذه القائمة.",
    "en": "There are additional calendar items beyond this list.",
}
_KIND_LABELS = {
    "he": {"task": "משימה", "goal": "יעד", "meeting": "מפגש", "event": "אירוע", "lesson": "שיעור"},
    "ar": {"task": "مهمة", "goal": "هدف", "meeting": "اجتماع", "event": "حدث", "lesson": "درس"},
    "en": {"task": "Task", "goal": "Goal", "meeting": "Meeting", "event": "Event", "lesson": "Lesson"},
}


def _explicit_calendar_period(message: str, language: str) -> CalendarPeriodName | None:
    patterns = _PERIOD_PATTERNS.get(language) or _PERIOD_PATTERNS["he"]
    return next((period for period, pattern in patterns if pattern.search(message or "")), None)


def resolve_calendar_period(
    message: str,
    language: str,
    *,
    now: datetime | None = None,
) -> CalendarPeriodName:
    """Resolve a period; a weekday alone means that weekday's next occurrence."""
    explicit = _explicit_calendar_period(message, language)
    if explicit is not None:
        return explicit
    weekday = resolve_calendar_weekday(message, language)
    if weekday is not None:
        value = now or datetime.now(timezone.utc)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        today = value.astimezone(ISRAEL_TIMEZONE).date()
        target = today + timedelta(days=(_WEEKDAY_INDEX[weekday] - today.weekday()) % 7)
        _, current_week_end = student_calendar.week_bounds(today)
        return "this_week" if target <= current_week_end else "next_week"
    return "today"


def resolve_calendar_weekday(message: str, language: str) -> CalendarWeekday | None:
    patterns = _WEEKDAY_PATTERNS.get(language) or _WEEKDAY_PATTERNS["he"]
    return next((weekday for weekday, pattern in patterns if pattern.search(message or "")), None)


def previous_calendar_state(
    history: list[dict[str, Any]], language: str,
) -> dict[str, Any] | None:
    """Return only the immediately preceding user turn when it was calendar-scoped."""
    from app.brain.memory import classify_query_intent

    previous = next(
        (turn for turn in reversed(history) if turn.get("role") == "user"),
        None,
    )
    if not previous:
        return None
    content = str(previous.get("content") or "")
    intent = previous.get("query_intent") or classify_query_intent(content, language)
    if intent != "calendar_query":
        return None
    period = previous.get("calendar_period") or resolve_calendar_period(content, language)
    return {
        "intent": "calendar_query",
        "period": period,
        "weekday": previous.get("calendar_weekday") or resolve_calendar_weekday(content, language),
        "source": previous.get("calendar_route_source") or "deterministic",
        "message": content,
    }


def looks_like_calendar_followup(message: str, language: str) -> bool:
    pattern = _FOLLOWUP_SIGNALS.get(language) or _FOLLOWUP_SIGNALS["he"]
    return len((message or "").strip()) <= 160 and bool(pattern.search(message or ""))


async def resolve_calendar_route(
    message: str,
    language: str,
    base_intent: str,
    history: list[dict[str, Any]],
    *,
    usage_context: UsageContext,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Keep clear requests deterministic; ask a mini model only for ambiguous follow-ups."""
    if base_intent == "calendar_query":
        return {
            "intent": "calendar_query",
            "period": resolve_calendar_period(message, language, now=now),
            "weekday": resolve_calendar_weekday(message, language),
            "source": "deterministic",
            "confidence": 1.0,
        }
    previous = previous_calendar_state(history, language)
    if base_intent != "learning_help" or previous is None or not looks_like_calendar_followup(message, language):
        return {"intent": base_intent, "source": "deterministic", "confidence": 1.0}
    if previous.get("source") in {"llm_followup", "session_followup"}:
        explicit_period = _explicit_calendar_period(message, language)
        return {
            "intent": "calendar_query",
            "period": explicit_period or previous["period"],
            "weekday": resolve_calendar_weekday(message, language),
            "source": "session_followup",
            "confidence": 1.0,
        }

    lang = language if language in _FOLLOWUP_CLASSIFIER_PROMPTS else "he"
    previous_text, _ = strip_pii(str(previous.get("message") or ""))
    current_text, _ = strip_pii(message)
    raw = await call_llm(
        [
            {"role": "system", "content": _FOLLOWUP_CLASSIFIER_PROMPTS[lang]},
            {"role": "user", "content": json.dumps({
                "previous_intent": "calendar_query",
                "previous_period": previous.get("period"),
                "previous_message": previous_text[:240],
                "current_message": current_text[:240],
            }, ensure_ascii=False)},
        ],
        usage_context=usage_context,
        max_tokens=140,
        json_mode=True,
        model_tier="mini",
    )
    try:
        payload = json.loads(raw or "{}")
    except (TypeError, json.JSONDecodeError):
        payload = {}
    intent = payload.get("intent")
    period = payload.get("period")
    weekday = payload.get("weekday")
    confidence = payload.get("confidence")
    confidence = float(confidence) if isinstance(confidence, (int, float)) else 0.0
    valid_periods = {"today", "tomorrow", "this_week", "next_week", "unchanged"}
    valid_weekdays = set(_WEEKDAY_INDEX)
    if period not in valid_periods:
        period = "unchanged"
    if weekday not in valid_weekdays:
        weekday = resolve_calendar_weekday(message, language)

    if intent == "calendar_query" and confidence >= 0.75:
        return {
            "intent": "calendar_query",
            "period": previous["period"] if period == "unchanged" else period,
            "weekday": weekday,
            "source": "llm_followup",
            "confidence": confidence,
        }
    if intent == "other" and confidence >= 0.75:
        return {"intent": "learning_help", "source": "llm_followup", "confidence": confidence}
    return {"intent": "calendar_clarification", "source": "llm_followup", "confidence": confidence}


def calendar_clarification(language: str) -> str:
    return _CLARIFICATION_REPLIES.get(language) or _CLARIFICATION_REPLIES["he"]


def _safe_text(value: object, limit: int = 160) -> str:
    text, _ = strip_pii(str(value or ""))
    return text.replace("<", "‹").replace(">", "›").strip()[:limit]


def _local_timestamp(value: str | None, all_day: bool) -> str | None:
    if not value or all_day or len(value) == 10:
        return value
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ISRAEL_TIMEZONE)
        return parsed.astimezone(ISRAEL_TIMEZONE).isoformat()
    except ValueError:
        return value


async def load_calendar_context(
    learner_id: str,
    period: CalendarPeriodName,
    weekday: CalendarWeekday | None = None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Read one learner-owned period and expose only model-safe fields."""
    try:
        projection = await student_calendar.get_period(learner_id, period, now=now)
    except Exception as exc:
        print(f"⚠️ Coach calendar read failed: {type(exc).__name__}")
        return {"status": "unavailable", "period": period, "items": []}

    filtered_items = projection.items
    if weekday is not None:
        weekday_index = _WEEKDAY_INDEX[weekday]
        filtered_items = [item for item in filtered_items if _matches_weekday(item, weekday_index)]
    total_count = len(filtered_items)
    items = [
        {
            "kind": item.kind,
            "title": _safe_text(item.title),
            "subject": _safe_text(item.subject) if item.subject else None,
            "start_at": _local_timestamp(item.start_at, item.all_day),
            "end_at": _local_timestamp(item.end_at, item.all_day),
            "all_day": item.all_day,
            "status": item.status,
        }
        for item in filtered_items[:MAX_CONTEXT_ITEMS]
    ]
    return {
        "status": "available",
        "period": projection.period,
        "weekday": weekday,
        "timezone": projection.timezone,
        "start_date": projection.start_date.isoformat(),
        "end_date": projection.end_date.isoformat(),
        "items": items,
        "total_count": total_count,
        "has_more": total_count > len(items),
    }


def _calendar_item_date(value: str, all_day: bool) -> date | None:
    localized = _local_timestamp(value, all_day)
    try:
        return date.fromisoformat(localized) if localized and len(localized) == 10 else datetime.fromisoformat(localized or "").date()
    except ValueError:
        return None


def _matches_weekday(item: student_calendar.CalendarItem, weekday_index: int) -> bool:
    item_date = _calendar_item_date(item.start_at, item.all_day)
    return item_date is not None and item_date.weekday() == weekday_index


def calendar_fallback(context: dict[str, Any], language: str) -> str:
    """Render a grounded response when the external model yields no text."""
    lang = language if language in _EMPTY_REPLIES else "he"
    if context.get("status") != "available":
        return _UNAVAILABLE_REPLIES[lang]
    items = context.get("items") or []
    if not items:
        return _EMPTY_REPLIES[lang]

    lines = [_HEADINGS[lang]]
    for item in items:
        title = item.get("title") or item.get("subject") or "—"
        kind = _KIND_LABELS[lang].get(str(item.get("kind") or ""), "")
        start_at = str(item.get("start_at") or "")
        when = start_at[:16].replace("T", " ") if start_at else ""
        prefix = f"{kind}: " if kind else ""
        lines.append(f"- {prefix}{title}{f' — {when}' if when else ''}")
    if context.get("has_more"):
        lines.append(_MORE_REPLIES[lang])
    return "\n".join(lines)