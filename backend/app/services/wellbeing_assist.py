"""Something to start from, for a teacher who has just read something hard.

A teacher opening a disclosure at 07:40 between two lessons is not short of
judgement — they are short of a first sentence. That is the whole scope of this
module: three short options they can edit, for one of three moments.

  message   what to say to the child
  handle    what to do next, in this hour and this week
  close     how to write up what was done

## The rules that are enforced in code, not asked for in a prompt

* **Nothing here acts.** The route returns text. No message is sent, no flag is
  closed, no note is written. A model that could message a child in distress is
  a model one bad completion away from harm.
* **The protocol line is never generated.** "If you believe the child is in
  immediate danger, follow the school's procedure now" is returned as a locale
  key the frontend renders, identically every time. A model rephrasing that
  sentence is a model that can soften it.
* **The child's own words never come back as a script.** The suggestions may
  refer to the disclosure; they must not quote it back at the child, which
  reads as surveillance rather than care.
* **No model, no problem.** Every intent has written fallbacks. The button is
  useful with the provider down, which for a safety surface is not optional.

The model is asked for openings and next steps a form tutor would recognise. It
is told, explicitly, not to diagnose, not to name conditions, not to promise
confidentiality, and not to give clinical instructions — those are the four ways
this goes wrong, and they are worth stating in the prompt as well as filtering
for afterwards.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.services.ai_usage import UsageContext

INTENTS = ("message", "handle", "close")

MAX_OPTIONS = 3
MAX_OPTION_CHARS = 220

#: Rendered by the frontend, identically every time. Not the model's to phrase.
PROTOCOL_KEY = "tch.wellbeing.protocol"

_SOURCE_WORDS = {
    "he": {
        "coach_chat": "בצ'אט עם יובי",
        "competency_chat": "בשיחת תרגול עם יובי",
        "direct_message": "בהודעה למורה שנחסמה ולא נשלחה",
        "mapping_reflection": "בשאלון ההיכרות",
    },
    "ar": {
        "coach_chat": "في المحادثة مع يوفي",
        "competency_chat": "في محادثة تدريب مع يوفي",
        "direct_message": "في رسالة للمعلّم حُجبت ولم تُرسل",
        "mapping_reflection": "في استبيان التعارف",
    },
    "en": {
        "coach_chat": "in a chat with Yuvi",
        "competency_chat": "in a practice conversation with Yuvi",
        "direct_message": "in a message to the teacher that was blocked and never sent",
        "mapping_reflection": "in the getting-to-know-you questionnaire",
    },
}

_ASK = {
    "message": (
        "The teacher is about to write to this student. Suggest three openings "
        "they could send. Warm, short, no interrogation. Offer a way to talk "
        "rather than demanding an explanation, and leave the student an easy "
        "way to say 'not now'."
    ),
    "handle": (
        "Suggest three next steps for this teacher, in the order a form tutor "
        "would take them: something today, something this week, and one that "
        "involves another adult in the school. Concrete and small."
    ),
    "close": (
        "The teacher is writing up what they did before closing this. Suggest "
        "three short summaries they could adapt — factual, in the past tense, "
        "the kind of line a colleague reading it in three months can use."
    ),
}

_FALLBACKS = {
    "he": {
        "message": [
            "רציתי להגיד שראיתי מה שכתבת, ואני כאן. אפשר לדבר מתי שנוח לך.",
            "חשבתי עלייך/עליך. בא לך שנשב כמה דקות היום אחרי השיעור?",
            "אם בא לך לספר עוד — אני מקשיב/ה. ואם לא, זה גם בסדר.",
        ],
        "handle": [
            "לדבר עם התלמיד/ה ביחידות היום, במקום שקט ובלי קהל.",
            "לעדכן את היועצ/ת לפי נוהל בית הספר ולתעד כאן מה סוכם.",
            "לשים לב השבוע לנוכחות, להשתתפות ולשינויים בהתנהגות.",
        ],
        "close": [
            "שוחחתי עם התלמיד/ה ביחידות; סוכם להמשיך לעקוב.",
            "העברתי ליועצ/ת בית הספר, שממשיכה מכאן.",
            "עדכנתי את ההורים בשיחה, וסוכם על מעקב משותף.",
        ],
    },
    "ar": {
        "message": [
            "أردت أن أقول إنني رأيت ما كتبته، وأنا هنا. يمكننا التحدث متى شئت.",
            "فكّرت بك. هل تودّ أن نجلس بضع دقائق اليوم بعد الحصة؟",
            "إن أردت أن تحكي أكثر — أنا أسمعك. وإن لم ترغب، لا بأس أيضًا.",
        ],
        "handle": [
            "التحدث مع الطالب على انفراد اليوم، في مكان هادئ.",
            "إبلاغ المرشد/ة حسب إجراءات المدرسة وتوثيق ما اتُّفق عليه هنا.",
            "الانتباه هذا الأسبوع للحضور والمشاركة وأي تغيّر في السلوك.",
        ],
        "close": [
            "تحدثت مع الطالب على انفراد؛ اتُّفق على متابعة الوضع.",
            "أحلت الأمر إلى مرشد/ة المدرسة، وهي تتابع من هنا.",
            "تحدثت مع الأهل، واتُّفق على متابعة مشتركة.",
        ],
    },
    "en": {
        "message": [
            "I wanted to say I saw what you wrote, and I'm here. We can talk whenever suits you.",
            "I was thinking of you. Would you like to sit for a few minutes after class today?",
            "If you want to tell me more, I'm listening. And if not, that's alright too.",
        ],
        "handle": [
            "Speak with the student one to one today, somewhere quiet.",
            "Tell the school counsellor under your safeguarding procedure, and log what was agreed here.",
            "Watch attendance, participation and any change in behaviour this week.",
        ],
        "close": [
            "Spoke with the student one to one; agreed to keep an eye on things.",
            "Referred to the school counsellor, who is taking it from here.",
            "Called home; agreed to keep in touch about how things go.",
        ],
    },
}

_SYSTEM = {
    "he": "אתה עוזר למורה בבית ספר בישראל. תשובה בעברית בלבד.",
    "ar": "أنت تساعد معلّمًا في المدرسة. أجب بالعربية فقط.",
    "en": "You are helping a schoolteacher. Answer in English only.",
}

_RULES = """
Rules, all of them:
- Never diagnose, never name a condition, never use clinical language.
- Never promise the student confidentiality, and never suggest the teacher does.
- No medical, legal or therapeutic instructions. You are not the professional
  in this room; you are helping a teacher take the first step.
- Do not quote the student's words back at them.
- Do not invent anything about the student beyond what is written below.
- Each option is one or two sentences, under 200 characters.
Return JSON only: {"options": ["...", "...", "..."]}
"""


def _clean(options: Any, limit: int = MAX_OPTIONS) -> list[str]:
    out: list[str] = []
    for option in options if isinstance(options, list) else []:
        text = " ".join(str(option or "").split()).strip()
        if not text:
            continue
        # A model that returns a numbered list inside the strings.
        text = re.sub(r"^[\d\-•.)\s]+", "", text)
        if len(text) > MAX_OPTION_CHARS:
            text = text[:MAX_OPTION_CHARS].rstrip() + "…"
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _fallback(intent: str, language: str) -> list[str]:
    table = _FALLBACKS.get(language) or _FALLBACKS["he"]
    return list(table.get(intent) or table["handle"])


async def suggest(flag: dict[str, Any], *, intent: str, language: str,
                  teacher_id: str) -> dict[str, Any]:
    """Three editable options, and the protocol line that is not the model's.

    `generated` says which the teacher is reading. A suggestion that quietly
    fell back to a written list should not be presented as if a model had
    weighed this particular child's words.
    """
    if intent not in INTENTS:
        intent = "handle"
    language = language if language in _FALLBACKS else "he"

    words = str(flag.get("evidence") or "").strip()
    source = str(flag.get("source") or "")
    where = (_SOURCE_WORDS.get(language) or _SOURCE_WORDS["he"]).get(source, "")
    reply = str(flag.get("reply") or "").strip()

    prompt = f"""{_ASK[intent]}

What the student wrote{f' ({where})' if where else ''}:
"{words}"

What the student was already told in reply:
"{reply or '—'}"
{_RULES}"""

    options: list[str] = []
    try:
        from app.services.llm import call_llm

        raw = await call_llm(
            [{"role": "system", "content": _SYSTEM.get(language, _SYSTEM["he"])},
             {"role": "user", "content": prompt}],
            usage_context=UsageContext(
                # Attributed to the teacher who asked, not to "system": this is
                # a person pressing a button on a screen.
                actor_id=teacher_id, actor_type="teacher",
                endpoint="internal:wellbeing_suggest",
                feature="feature_6_teacher_dashboard",
                operation=f"wellbeing.suggest.{intent}",
                source="wellbeing_assist",
            ),
            max_tokens=400, json_mode=True, model_tier="mini",
        )
        parsed = json.loads(raw) if raw else {}
        options = _clean(parsed.get("options"))
    except Exception as exc:  # pragma: no cover - the button must still work
        print(f"⚠️ wellbeing suggestion fell back: {type(exc).__name__}: {exc}")
        options = []

    generated = bool(options)
    if not options:
        options = _fallback(intent, language)

    return {"intent": intent, "options": options, "generated": generated,
            "protocol_key": PROTOCOL_KEY}
