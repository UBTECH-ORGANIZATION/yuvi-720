"""Ephemeral competency-support chat (F4 "מפת הלמידה שלי" topic dialog).

A focused Yuvi conversation about ONE activeness competency, opened from the
learning-map topic dialog. By design it is NOT part of conversation history:
the transcript lives only in the client and nothing is written to `sessions`.
Memory still works — each learner turn runs the consolidator lane, so durable
facts shared here ("אני אוהב מיינקראפט", "אני כבר לא...") update the brain
exactly as in the main chat.

Grounding: the same non-identifying coach bundle (evidence from real events,
mastery stance, challenges, student_description) plus the competency's VERBAL
band. Raw activeness scores never reach the prompt (MoE rule).
"""

from typing import AsyncGenerator, Optional
from uuid import uuid4

from app.agents import safety
from app.brain.context_engine import build_coach_bundle
from app.brain.repository import get_brain
from app.core.localization import normalize_language
from app.services.ai_usage import UsageContext
from app.services.llm import call_llm, call_llm_stream

COMPETENCY_KEYS = (
    "motivation_relevance",
    "growth_mindset",
    "initiative_responsibility",
    "self_regulation",
    "self_awareness",
    "support_emotional",
)

_COMPETENCY_NAMES = {
    "motivation_relevance": {"he": "מוטיבציה ורלוונטיות", "en": "Motivation & relevance", "ar": "الدافعية والصلة"},
    "growth_mindset": {"he": "תפיסת צמיחה", "en": "Growth mindset", "ar": "عقلية النمو"},
    "initiative_responsibility": {"he": "יוזמה ואחריות", "en": "Initiative & responsibility", "ar": "المبادرة والمسؤولية"},
    "self_regulation": {"he": "ויסות עצמי", "en": "Self-regulation", "ar": "التنظيم الذاتي"},
    "self_awareness": {"he": "מודעות עצמית", "en": "Self-awareness", "ar": "الوعي الذاتي"},
    "support_emotional": {"he": "תמיכה וחוויה רגשית", "en": "Support & emotional experience", "ar": "الدعم والتجربة العاطفية"},
}

# Verbal bands only — the numeric activeness value never enters the prompt.
_BAND_WORDS = {
    "strong": {"he": "חוזקה — מתקדם/ת יפה", "en": "a strength — progressing nicely", "ar": "نقطة قوة — يتقدّم جيدًا"},
    "steady": {"he": "בהתפתחות", "en": "developing steadily", "ar": "في تطوّر"},
    "support": {"he": "כדאי לחזק", "en": "worth strengthening", "ar": "يستحق التعزيز"},
}

_INSTRUCTIONS = {
    "he": (
        "אתה יובי, המלווה הלימודי של תלמיד/ה בכיתות ז'-ט'. זו שיחה ממוקדת שנפתחה "
        "מתוך 'מפת הלמידה שלי' על תחום אחד: {name}. במפה התחום מוצג כרגע כ'{band}'.\n"
        "המטרה שלך: לעזור לתלמיד/ה להבין (1) מה התחום הזה אומר בחיי היומיום של למידה, "
        "(2) למה המפה מציגה אותו כך — בהתבסס רק על העדויות שקיבלת (המיפוי, האירועים "
        "מהשיעורים, האתגרים), ו-(3) לצאת עם צעד קטן ומעשי אחד.\n"
        "כללים: עברית פשוטה וחמה, וקצר מאוד — משפט אחד עד שניים לתשובה, רעיון אחד בכל "
        "פעם. בלי ציונים, בלי מספרים ובלי השוואה לאחרים — רק תיאור מילולי. אל תמציא "
        "נתונים: אם אין מספיק עדות, אמור בפשטות שנלמד את זה יחד תוך כדי. אם התלמיד/ה "
        "גולש/ת לנושא אחר — ענה במשפט קצר וחזור בעדינות לתחום. שאלה אחת לכל היותר "
        "בכל תשובה. אם התלמיד/ה משתף/ת משהו אישי שחשוב לזכור, שקף שהבנת. "
        "כשמונים כמה צעדים או אפשרויות — עצב אותם כרשימת Markdown קצרה, "
        "והדגש מונחי מפתח ב-**מודגש**."
    ),
    "ar": (
        "أنت يوفي، المرافق التعلّمي لطالب/ة في الصفوف السابع-التاسع. هذه محادثة مركّزة "
        "فُتحت من 'خريطة التعلّم' حول مجال واحد: {name}. في الخريطة يظهر المجال حاليًا "
        "كـ'{band}'.\n"
        "هدفك: مساعدة الطالب/ة على فهم (1) ماذا يعني هذا المجال في التعلّم اليومي، "
        "(2) لماذا تعرضه الخريطة هكذا — استنادًا فقط إلى الأدلة المعطاة، و(3) الخروج "
        "بخطوة صغيرة عملية واحدة.\n"
        "القواعد: عربية بسيطة ودافئة، وقصيرة جدًا — جملة أو جملتان لكل رد، فكرة واحدة "
        "في كل مرة. دون علامات أو أرقام أو مقارنة بالآخرين. لا تختلق بيانات: إن لم "
        "تكفِ الأدلة قل ذلك ببساطة. إن خرج الطالب عن الموضوع أجب بجملة قصيرة وعد "
        "بلطف إلى المجال. سؤال واحد كحد أقصى في كل رد. عند ذكر عدة خطوات أو "
        "خيارات نسّقها كقائمة Markdown قصيرة و**خشّن** المصطلحات المفتاحية."
    ),
    "en": (
        "You are Yuvi, the learning companion of a middle-school student. This is a "
        "focused conversation opened from 'My learning map' about one area: {name}. "
        "On the map it currently shows as '{band}'.\n"
        "Your goal: help the student understand (1) what this area means in everyday "
        "learning, (2) why the map shows it this way — based only on the evidence "
        "provided (mapping, lesson events, challenges), and (3) leave with one small "
        "practical step.\n"
        "Rules: simple, warm language, and very short — one to two sentences per "
        "reply, one idea at a time. No grades, no numbers, no comparison to others — "
        "verbal only. Never invent data: if evidence is thin, say so simply. If the "
        "student drifts off-topic, answer briefly and gently return to the area. At "
        "most one question per reply. When listing a few steps or options, format "
        "them as a short Markdown list and **bold** key terms."
    ),
}


def _band_for(brain: dict, competency: str) -> str:
    value = ((brain.get("profile") or {}).get("activeness") or {}).get(competency)
    try:
        value = int(value)
    except (TypeError, ValueError):
        return "support"
    return "strong" if value >= 70 else "steady" if value >= 45 else "support"


_CHANGE_DIRECTION_WORDS = {
    "up": {"he": "עלייה", "en": "an increase", "ar": "ارتفاع"},
    "down": {"he": "ירידה קלה", "en": "a slight dip", "ar": "انخفاض طفيف"},
}

_CHANGE_INSTRUCTIONS = {
    "he": (
        "אתה יובי, המלווה הלימודי. במפת הפעלנות של התלמיד/ה חל שינוי בתחום '{name}': "
        "{direction} מאז הפעם הקודמת שהסתכל/ה במפה.\n"
        "כתוב הסבר קצר מאוד (משפט אחד עד שניים, בגוף שני, בעברית חמה ופשוטה) שמנסה "
        "להסביר *למה* ייתכן שזה קרה — בהתבסס אך ורק על העדויות שקיבלת (אירועים "
        "מהשיעורים, אתגרים, תיאור התלמיד/ה). בלי מספרים, בלי ציונים ובלי השוואה "
        "לאחרים — רק תיאור מילולי. אם אין מספיק עדות כדי לדעת למה, אמור בעדינות "
        "שראית שמשהו זז ושתגלו יחד למה תוך כדי. אל תמציא סיבות."
    ),
    "ar": (
        "أنت يوفي، المرافق التعلّمي. في خريطة نشاط الطالب/ة حدث تغيّر في المجال "
        "'{name}': {direction} منذ آخر مرة نظر/ت فيها إلى الخريطة.\n"
        "اكتب شرحًا قصيرًا جدًا (جملة أو جملتين، بصيغة المخاطب، بعربية دافئة وبسيطة) "
        "يحاول تفسير *لماذا* قد يكون هذا قد حدث — استنادًا فقط إلى الأدلة المعطاة "
        "(أحداث الدروس، التحديات، وصف الطالب/ة). دون أرقام أو علامات أو مقارنة "
        "بالآخرين — وصف لفظي فقط. إن لم تكفِ الأدلة قل بلطف إنك لاحظت حركة وأنكما "
        "ستكتشفان السبب معًا. لا تختلق أسبابًا."
    ),
    "en": (
        "You are Yuvi, the learning companion. On the student's activeness map, the "
        "area '{name}' changed: {direction} since they last looked at the map.\n"
        "Write a very short explanation (one or two sentences, second person, warm "
        "simple language) that tries to explain *why* this may have happened — based "
        "only on the evidence provided (lesson events, challenges, student "
        "description). No numbers, no grades, no comparison to others — verbal only. "
        "If evidence is too thin to know why, gently say you noticed something moved "
        "and you'll discover why together. Never invent reasons."
    ),
}

# When the deterministic activeness model has enough evidence to name *why* a
# domain sits where it does, we hand the coach those exact signals so the blurb
# the learner reads is the same story that actually moved the score — not an
# independent LLM guess. Empty causes (thin evidence) → this directive is
# omitted and the coach falls back to the bundle + "we'll find out together".
_SIGNALS_DIRECTIVE = {
    "he": (
        "\nהמערכת זיהתה את האותות ההתנהגותיים הבאים בתחום הזה (מצורפים כ-"
        "activeness_signals) — בסס/י את ההסבר בעיקר עליהם, בניסוח מילולי וחם משלך, "
        "בלי לצטט אותם מילה במילה ובלי מספרים."
    ),
    "ar": (
        "\nرصدت المنظومة الإشارات السلوكية التالية في هذا المجال (مرفقة كـ"
        "activeness_signals) — اعتمد/ي عليها أساسًا في تفسيرك، بصياغتك اللفظية "
        "الدافئة، دون اقتباسها حرفيًا ودون أرقام."
    ),
    "en": (
        "\nThe system detected the following behavioural signals in this area "
        "(attached as activeness_signals) — base your explanation primarily on them, "
        "in your own warm verbal phrasing, without quoting them verbatim or using "
        "numbers."
    ),
}

# Internal, non-numeric descriptor for each cause tag the activeness model can
# surface. Never shown verbatim — it grounds the coach's own phrasing.
_CAUSE_HINTS = {
    "inconsistent": {
        "he": "הופעה לא סדירה — פערים בין ימי הלמידה",
        "ar": "حضور غير منتظم — فجوات بين أيام التعلّم",
        "en": "irregular attendance — gaps between learning days",
    },
    "quits_on_fail": {
        "he": "אחרי טעות נוטה לעצור במקום לנסות שוב",
        "ar": "بعد الخطأ يميل إلى التوقّف بدل المحاولة مجددًا",
        "en": "after a mistake tends to stop instead of trying again",
    },
    "guessing": {
        "he": "תשובות מהירות מדי — סימן לניחוש במקום עצירה לחשוב",
        "ar": "إجابات سريعة جدًا — إشارة إلى التخمين بدل التوقّف للتفكير",
        "en": "very fast answers — a sign of guessing rather than pausing to think",
    },
    "hint_reliance": {
        "he": "פנייה מהירה לרמזים לפני ניסיון עצמאי",
        "ar": "اللجوء السريع إلى التلميحات قبل محاولة مستقلة",
        "en": "reaching for hints before an independent attempt",
    },
    "low_engagement": {
        "he": "מעט פעילות והשלמות בתקופה האחרונה",
        "ar": "نشاط وإنجازات قليلة في الفترة الأخيرة",
        "en": "little activity and few completions recently",
    },
    "low_reflection": {
        "he": "כמעט בלי רפלקציה או עצירה לחשוב אחרי שיעורים",
        "ar": "شبه غياب للتأمّل بعد الدروس",
        "en": "almost no reflection after lessons",
    },
    "isolation": {
        "he": "התמודדות עם קושי בלי לבקש עזרה",
        "ar": "مواجهة الصعوبة دون طلب المساعدة",
        "en": "facing difficulty without asking for help",
    },
    "keep": {
        "he": "המשך יציב וטוב — כדאי לשמור על הקצב",
        "ar": "تقدّم ثابت وجيد — يُستحسن الحفاظ على الوتيرة",
        "en": "steady, good progress — worth keeping the pace",
    },
    "stretch": {
        "he": "ביצוע חזק — אפשר לקחת אתגר גדול יותר",
        "ar": "أداء قوي — يمكن خوض تحدٍّ أكبر",
        "en": "strong performance — ready for a bigger challenge",
    },
}


# In the interactive chat, the kid may ask "why did this go down?" / "how do I
# get better here?". This hands the coach the same deterministic signals the map
# uses, so those answers are grounded in real behaviour rather than guessed.
_CHAT_SIGNALS_DIRECTIVE = {
    "he": (
        "\nלגבי התחום הזה, המערכת זיהתה את האותות ההתנהגותיים ב-activeness_signals. "
        "אם התלמיד/ה שואל/ת מה השתנה, למה התחום עלה או ירד, או איך להשתפר — "
        "התבסס/י על האותות האלה כדי להסביר בשפה מילולית וחמה ולהציע צעד קטן ומעשי, "
        "בלי מספרים, בלי ציונים ובלי לצטט אותם מילה במילה. אם אין אותות, אמור/י "
        "בכנות שעדיין אין מספיק עדות ושתגלו יחד תוך כדי."
    ),
    "ar": (
        "\nبخصوص هذا المجال، رصدت المنظومة الإشارات السلوكية في activeness_signals. "
        "إذا سأل الطالب/ة عمّا تغيّر، أو لماذا ارتفع المجال أو انخفض، أو كيف يتحسّن — "
        "اعتمد/ي على هذه الإشارات لتشرح بلغة لفظية دافئة وتقترح خطوة صغيرة عملية، "
        "دون أرقام أو علامات ودون اقتباسها حرفيًا. إن لم تكن هناك إشارات فقل بصدق "
        "إنه لا توجد أدلة كافية بعد وأنكما ستكتشفان ذلك معًا."
    ),
    "en": (
        "\nFor this area, the system detected the behavioural signals in "
        "activeness_signals. If the student asks what changed, why the area went "
        "up or down, or how to improve — use these signals to explain in warm "
        "verbal language and offer one small practical step, with no numbers, no "
        "grades, and without quoting them verbatim. If there are no signals, say "
        "honestly that there isn't enough evidence yet and you'll find out together."
    ),
}


async def _activeness_signals(learner_id: str, brain: dict, competency: str, lang: str) -> list[str]:
    """The deterministic model's own causes for this domain, as internal phrases.

    Best-effort: any failure (or thin evidence → empty causes) yields [], and the
    coach then explains from the bundle alone. Never raises, never leaks numbers.
    """
    try:
        from app.agents.tutor_decision import recent_tutor_decisions
        from app.brain.activeness import effective_activeness
        from app.services.events import get_learner_events

        events = await get_learner_events(learner_id)
        decisions = await recent_tutor_decisions(learner_id)
        causes = (effective_activeness(brain, events, decisions).get(competency) or {}).get("causes") or []
        return [
            _CAUSE_HINTS[c].get(lang, _CAUSE_HINTS[c]["he"])
            for c in causes
            if c in _CAUSE_HINTS
        ]
    except Exception:
        return []


async def run_change_explanation(
    learner_id: str,
    competency: str,
    direction: str,
    language: str = "he",
) -> Optional[str]:
    """A short, verbal, non-numeric explanation of *why* an activeness domain
    likely moved since the learner last opened the map. Grounded in the same
    coach bundle as the competency chat; fabricates nothing; leaks no scores."""
    lang = normalize_language(language)
    if competency not in COMPETENCY_KEYS:
        return None
    direction = direction if direction in ("up", "down") else "up"

    usage_context = UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="/api/agent/activeness/change-explain",
        feature="feature_4_dashboard",
        operation="coach.activeness_change_explain",
        source="competency_coach_agent",
    )

    brain = await get_brain(learner_id)
    bundle = await build_coach_bundle(learner_id, surface_context={"screen": "student_dashboard"})
    signals = await _activeness_signals(learner_id, brain, competency, lang)

    import json as _json
    context_payload = {
        "competency": _COMPETENCY_NAMES[competency].get(lang, _COMPETENCY_NAMES[competency]["he"]),
        "evidence": {
            "mastery_stance": bundle.get("mastery_stance"),
            "challenges": bundle.get("challenges"),
            "recent_events": (bundle.get("current") or {}).get("recent_events"),
            "coaching_hints": bundle.get("coaching_hints"),
        },
        "student_description": bundle.get("student_description"),
    }
    if signals:
        context_payload["activeness_signals"] = signals
    instructions = _CHANGE_INSTRUCTIONS[lang].format(
        name=context_payload["competency"],
        direction=_CHANGE_DIRECTION_WORDS[direction].get(lang, _CHANGE_DIRECTION_WORDS[direction]["he"]),
    )
    if signals:
        instructions += _SIGNALS_DIRECTIVE[lang]
    messages = [
        {"role": "system", "content": instructions},
        {
            "role": "system",
            "content": "Context (internal, never quote verbatim):\n"
            + _json.dumps(context_payload, ensure_ascii=False),
        },
    ]
    text = await call_llm(messages, usage_context=usage_context, max_tokens=220, model_tier="mini")
    return (text or "").strip() or None


async def run_competency_chat_stream(
    learner_id: str,
    competency: str,
    transcript: list[dict],
    language: str = "he",
    *,
    conversation_id: str = "default",
    exchange_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream a focused competency reply. Persists NOTHING to conversation
    history; runs the memory consolidator on the learner's turn afterwards."""
    lang = normalize_language(language)
    if competency not in COMPETENCY_KEYS:
        competency = "self_regulation"
    exchange_id = exchange_id or uuid4().hex

    usage_context = UsageContext(
        actor_id=learner_id,
        actor_type="learner",
        endpoint="/api/agent/competency-chat",
        feature="feature_4_dashboard",
        operation="coach.competency_chat",
        source="competency_coach_agent",
        session_id=conversation_id,
        exchange_id=exchange_id,
    )

    # PII-screen every learner turn (the client holds the transcript, so we
    # cannot trust earlier turns to have been screened).
    turns: list[dict] = []
    for entry in transcript[-12:]:
        role = "user" if entry.get("role") == "user" else "assistant"
        text = str(entry.get("text") or "").strip()[:1500]
        if not text:
            continue
        if role == "user":
            text = safety.screen_input(text, lang).text or text
        turns.append({"role": role, "content": text})
    if not turns or turns[-1]["role"] != "user":
        return
    last_user = turns[-1]["content"]

    # Same cross-cutting Safety gate as the main coach: distress/personal
    # disclosures get a redirect, distress raises the wellbeing flag.
    category = await safety.classify_disclosure(
        last_user,
        lang,
        usage_context=usage_context.for_operation("safety.disclosure_classification"),
    )
    if category in ("distress", "personal"):
        if category == "distress":
            await safety.record_wellbeing_flag(
                learner_id, evidence=last_user, language=lang, source="competency_chat"
            )
        yield safety.redirect_message(category, lang)
        return

    brain = await get_brain(learner_id)
    band = _band_for(brain, competency)
    bundle = await build_coach_bundle(
        learner_id,
        surface_context={"screen": "student_dashboard"},
        user_message=last_user,
    )
    signals = await _activeness_signals(learner_id, brain, competency, lang)

    import json as _json
    context_payload = {
        "competency": _COMPETENCY_NAMES[competency].get(lang, _COMPETENCY_NAMES[competency]["he"]),
        "band": _BAND_WORDS[band].get(lang, _BAND_WORDS[band]["he"]),
        "evidence": {
            "mastery_stance": bundle.get("mastery_stance"),
            "challenges": bundle.get("challenges"),
            "recent_events": (bundle.get("current") or {}).get("recent_events"),
            "coaching_hints": bundle.get("coaching_hints"),
        },
        "profile": bundle.get("profile"),
        "student_description": bundle.get("student_description"),
        "goals": bundle.get("goals"),
    }
    if signals:
        context_payload["activeness_signals"] = signals

    instructions = _INSTRUCTIONS[lang].format(
        name=context_payload["competency"], band=context_payload["band"]
    )
    instructions += _CHAT_SIGNALS_DIRECTIVE[lang]
    messages = [
        {"role": "system", "content": instructions},
        {
            "role": "system",
            "content": "Context (internal, never quote verbatim):\n"
            + _json.dumps(context_payload, ensure_ascii=False),
        },
        *turns,
    ]

    async for chunk in call_llm_stream(
        messages,
        usage_context=usage_context,
        max_tokens=600,
        model_tier="mini",
    ):
        yield chunk

    # Memory lane: this chat is history-less, but durable learner facts still
    # flow into the brain through the ordinary consolidator path.
    try:
        from app.brain.consolidator import capture_and_consolidate
        await capture_and_consolidate(
            learner_id,
            last_user,
            lang,
            session_id=f"competency-{competency}",
            exchange_id=exchange_id,
        )
    except Exception as exc:  # pragma: no cover - memory must never break chat
        print(f"⚠️ competency-chat memory capture failed: {exc}")
