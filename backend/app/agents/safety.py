"""Safety Agent (cross-cutting gate) — §5.5, §11.

Tiered so it doesn't double cost/latency (R4): **tier 1 is deterministic** (PII
redaction, blocklist, disclosure/format checks) and runs on *every* message;
**tier 2 (LLM screening) runs only** when tier 1 flags. The non-negotiable it
enforces: **PII never reaches the AI** — the learner's own message is stripped of
identifying details before it enters any prompt (the Context bundle is already
non-identifying by construction).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from app.services.ai_usage import UsageContext

# Deterministic PII patterns (redacted before anything reaches the model).
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_ISRAELI_ID = re.compile(r"\b\d{9}\b")                       # ת"ז (checksum-verified)
_PHONE = re.compile(r"(?:\+972[-\s]?|0)\d(?:[-\s]?\d){7,8}\b")
_LONG_DIGITS = re.compile(r"\b\d{7,}\b")
_URL = re.compile(r"https?://\S+")


def is_valid_israeli_id(digits: str) -> bool:
    """Luhn-style ת"ז checksum — distinguishes a real ID from an arbitrary
    9-digit number (redaction still covers all long digit runs; the checksum
    only upgrades the *flag* so teachers aren't alerted on phone-free numerics)."""
    if not digits.isdigit() or len(digits) != 9:
        return False
    total = 0
    for index, char in enumerate(digits):
        value = int(char) * (1 + index % 2)
        total += value - 9 if value > 9 else value
    return total % 10 == 0

REDACTION = "▮"

# Minimal blocklist (extend as policy evolves). Tier-2 LLM handles nuance.
_BLOCKLIST = re.compile(
    r"\b(כתובת\s+הבית|address|תעודת\s*זהות|social\s+security)\b", re.IGNORECASE
)

# ── Content safety for what the brain STORES/USES (not distress) ──────────────
# A real LLM judges whether extracted memory values are appropriate to keep on a
# minor's (12–15) educational profile. This is an INDEPENDENT guardian, separate
# from the extraction model that produced the values — so an extractor that
# wrongly treats "זונות" as an interest cannot get it stored. No keyword lists:
# the judge understands morphology, slang, and context across he/ar/en.
_MEMORY_SAFETY_PROMPT = {
    "he": (
        "את/ה שכבת בטיחות תוכן לפרופיל תלמיד/ה בגילאי 12–15. לפניך ערכים שהמערכת "
        "שוקלת לשמור כתחומי עניין/העדפות ולהשתמש בהם כדי להתאים לימוד. "
        "סמן/י כלא-בטוח כל ערך שהוא מיני, וולגרי, מגונה, פוגעני, אלים, שנאה או גזענות, "
        "סמים/אלכוהול/עישון, פעילות בלתי חוקית, או כל דבר שאינו הולם פרופיל חינוכי של קטין. "
        "שקול/י משמעות והקשר, לא רק מילים. תחביבים לגיטימיים (ספורט, מוזיקה, גיימינג וכו') בטוחים. "
        "החזר/י JSON בלבד: {\"unsafe\": [\"הערך המדויק שיש לפסול\", ...]} (רשימה ריקה אם הכל תקין)."
    ),
    "ar": (
        "أنت طبقة أمان محتوى لملف طالب/ة بعمر 12–15. أمامك قيم يفكّر النظام بحفظها كاهتمامات/تفضيلات "
        "لاستخدامها في تخصيص التعلّم. علّم كـ«غير آمن» أي قيمة جنسية أو بذيئة أو مسيئة أو عنيفة أو تحضّ على "
        "الكراهية/العنصرية، أو مخدرات/كحول/تدخين، أو نشاط غير قانوني، أو أي شيء لا يليق بملف تعليمي لقاصر. "
        "راعِ المعنى والسياق لا الكلمات فقط. الهوايات المشروعة (رياضة، موسيقى، ألعاب...) آمنة. "
        "أعِد JSON فقط: {\"unsafe\": [\"القيمة المرفوضة بالضبط\", ...]} (قائمة فارغة إن كان كل شيء سليمًا)."
    ),
    "en": (
        "You are a content-safety layer for a 12–15-year-old student's profile. You are given values the "
        "system is considering saving as interests/preferences and using to personalize learning. "
        "Flag as unsafe any value that is sexual, vulgar, obscene, harassing, violent, hateful/racist, "
        "drug/alcohol/smoking-related, illegal, or otherwise inappropriate for a minor's educational profile. "
        "Judge meaning and context, not just words. Legitimate hobbies (sports, music, gaming, etc.) are safe. "
        "Return JSON only: {\"unsafe\": [\"the exact value to reject\", ...]} (empty list if all are fine)."
    ),
}


async def screen_memory_values(
    values: list[str], language: str = "he", *, usage_context=None
) -> set[str]:
    """LLM guardian → the subset of `values` that must NOT be stored/used.

    Fails CLOSED: on any error or unparseable reply, every value is treated as
    unsafe (a memory can always be re-captured later; storing harm cannot be
    undone from a minor's profile)."""
    clean = [str(v).strip() for v in (values or []) if str(v or "").strip()]
    if not clean:
        return set()
    lang = language if language in _MEMORY_SAFETY_PROMPT else "he"
    import json
    from app.services.ai_usage import UsageContext
    from app.services.llm import call_llm

    ctx = (usage_context.for_operation("safety.memory_content")
           if usage_context is not None else UsageContext(
               actor_id="unknown", actor_type="learner",
               endpoint="internal:memory-safety",
               feature="feature_3_learning_companion",
               operation="safety.memory_content", source="memory_safety"))
    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _MEMORY_SAFETY_PROMPT[lang]},
                {"role": "user", "content": _json_dumps({"values": clean})},
            ],
            usage_context=ctx, max_tokens=200, json_mode=True, model_tier="mini",
        )
        payload = json.loads(raw or "{}")
        unsafe = payload.get("unsafe") if isinstance(payload, dict) else None
        if not isinstance(unsafe, list):
            return set(clean)                       # unparseable → fail closed
        flagged = {str(v).strip().casefold() for v in unsafe if str(v or "").strip()}
        return {v for v in clean if v.strip().casefold() in flagged}
    except Exception as exc:                        # LLM down / bad JSON → fail closed
        print(f"⚠️ memory content-safety screen failed (dropping candidates): {type(exc).__name__}")
        return set(clean)

AI_DISCLOSURE = {
    "he": "את/ה משוחח/ת עם יובי, עוזר/ת למידה מבוסס/ת בינה מלאכותית.",
    "ar": "أنت تتحدث مع يوفي، مساعد تعلّم يعمل بالذكاء الاصطناعي.",
    "en": "You are chatting with Yuvi, an AI-based learning helper.",
}

# Reply when a learner shares NON-harmful personal/PII details (e.g. "my mom is
# pregnant"): remind them it's an AI, discourage sharing personal data, redirect
# to learning. Not stored as a wellbeing flag; nothing personal is persisted.
PERSONAL_REDIRECT = {
    "he": "רגע לפני שנמשיך — אני יובי, בינה מלאכותית 🤖. עדיף לא לשתף איתי פרטים אישיים עליך או על המשפחה. בוא/י נחזור ללמידה 💜",
    "ar": "لحظة قبل أن نكمل — أنا يوفي، ذكاء اصطناعي 🤖. من الأفضل ألّا تشارك معي تفاصيل شخصية عنك أو عن عائلتك. لنعد إلى التعلّم 💜",
    "en": "One moment before we continue — I'm Yuvi, an AI 🤖. It's best not to share personal details about you or your family with me. Let's get back to learning 💜",
}

RESPECTFUL_LANGUAGE_REDIRECT = {
    "he": "רגע לפני שנמשיך — חשוב לדבר כאן בכבוד. אני יובי, בינה מלאכותית 🤖, ואשמח לעזור כשננסח את השאלה בלי קללות או פגיעה. בוא/י נחזור ללמידה 💜",
    "ar": "لحظة قبل أن نكمل — من المهم أن نتحدث هنا باحترام. أنا يوفي، ذكاء اصطناعي 🤖، وسأساعدك بكل سرور عندما نصوغ السؤال من دون شتائم أو إساءة. لنعد إلى التعلّم 💜",
    "en": "One moment before we continue — it is important to speak respectfully here. I'm Yuvi, an AI 🤖, and I'll be glad to help when we phrase the question without swearing or hurtful language. Let's get back to learning 💜",
}

# Reply when a learner shares emotional/social/family DISTRESS (e.g. "my friends
# don't like me", "my parents are divorcing", "I hate myself"): AI disclosure +
# warmly point them to a trusted adult. A wellbeing flag is recorded for the
# teacher (with the learner's own words as raw evidence — F6 explainability).
DISTRESS_SUPPORT = {
    "he": "תודה ששיתפת, זה נשמע לא פשוט 💜. חשוב שתדע/י — אני יובי, בינה מלאכותית, ולדברים כאלה הכי טוב לדבר עם מבוגר/ת שאת/ה סומך/ת עליו/ה: הורה, מורה או יועץ/ת בבית הספר. אני כאן כדי לעזור לך בלמידה.",
    "ar": "شكرًا لمشاركتك، يبدو أن هذا ليس سهلًا 💜. من المهم أن تعرف — أنا يوفي، ذكاء اصطناعي، ولمثل هذه الأمور من الأفضل التحدث مع شخص بالغ تثق به: أحد الوالدين، معلّم، أو مستشار في المدرسة. أنا هنا لمساعدتك في التعلّم.",
    "en": "Thank you for sharing — that sounds hard 💜. It's important to know I'm Yuvi, an AI, and for things like this it's best to talk to a trusted adult: a parent, a teacher, or a school counselor. I'm here to help you with learning.",
}


def redirect_message(category: str, language: str) -> str:
    """Localized learner-facing reply for a Safety disclosure category."""
    table = (
        DISTRESS_SUPPORT if category == "distress"
        else RESPECTFUL_LANGUAGE_REDIRECT if category == "respect"
        else PERSONAL_REDIRECT
    )
    return table.get(language, table["he"])


def is_safety_redirect(text: str) -> bool:
    """True if `text` is one of the fixed safety-redirect scripts. A redirect is
    not a tutoring turn, so the route uses this to skip downstream work (e.g. the
    visual planner) — a math animation must never attach to a crisis reply."""
    if not text:
        return False
    stripped = text.strip()
    return any(
        stripped == table[lang]
        for table in (DISTRESS_SUPPORT, PERSONAL_REDIRECT, RESPECTFUL_LANGUAGE_REDIRECT)
        for lang in table
    )



@dataclass
class SafetyResult:
    text: str
    flagged: bool
    reason: Optional[str] = None


def strip_pii(text: str) -> tuple[str, bool]:
    """Redact identifying details. Returns (sanitized_text, found_pii)."""
    found = False
    for pattern in (_EMAIL, _URL, _ISRAELI_ID, _PHONE, _LONG_DIGITS):
        if pattern.search(text):
            found = True
            text = pattern.sub(REDACTION, text)
    return text, found


def screen_input(text: str, language: str = "he") -> SafetyResult:
    """Tier-1 gate on the learner's message before it enters a prompt."""
    raw = text or ""
    real_id = any(is_valid_israeli_id(m.group(0)) for m in _ISRAELI_ID.finditer(raw))
    sanitized, found = strip_pii(raw)
    flagged = found or bool(_BLOCKLIST.search(sanitized))
    reason = "israeli_id" if real_id else "pii_or_blocklist" if flagged else None
    return SafetyResult(text=sanitized.strip(), flagged=flagged, reason=reason)


def has_unrespectful_language(text: str) -> bool:
    """Whether deterministic moderation recognizes profanity or an insult."""
    from app.services import content_filter

    return content_filter.check_content(text).category == content_filter.PROFANITY


def screen_output(text: str, language: str = "he") -> SafetyResult:
    """Tier-1 gate on model output: never let PII leak back to the learner."""
    sanitized, found = strip_pii(text or "")
    return SafetyResult(text=sanitized, flagged=found,
                        reason="pii_in_output" if found else None)


async def deep_screen(text: str, language: str = "he") -> bool:
    """Tier-2 LLM screening — invoked ONLY when tier-1 flags (or on sampling).

    Returns True if the content is safe. Kept conservative + optional so the app
    stays demoable without the model; on any error we fail safe (treat as unsafe
    only the already-flagged content, which tier-1 has redacted anyway).
    """
    # Placeholder for the LLM policy check; tier-1 redaction already applied.
    return True


def disclosure(language: str = "he") -> str:
    return AI_DISCLOSURE.get(language, AI_DISCLOSURE["he"])


# ── Wellbeing flags (teacher-facing safety signal) ───────────────────────────
# A learner-shared distress signal is NOT profile memory — it's a teacher alert.
# Stored on the brain under `wellbeing_flags` with the learner's own words as raw
# evidence (F6 explainability). The Coach/Onboarding surfaces never *diagnose*;
# they record the signal and point the learner to a trusted adult.
_MAX_WELLBEING_FLAGS = 30

_DISCLOSURE_CATEGORIES = ("none", "frustration", "personal", "interest", "distress")
_DISCLOSURE_CONTEXT_TURNS = 4
_DISCLOSURE_CONTEXT_CHARS = 500

# The deep-flow test caught the classifier's worst failure mode live: a routine
# "קשה לי עם השאלה הזאת, אני לא מבין איך להתחיל" was labeled distress, so the
# struggling learner got the talk-to-an-adult script instead of help — the
# anti-personalized outcome. `frustration` is now a first-class category with an
# explicit boundary rule: schoolwork frustration is a COACHING moment, not a
# safety event.
_CLASSIFY_PROMPT = {
    "task": "Classify a learner's chat message for a school AI safety gate.",
    "categories": {
        "none": "ordinary learning talk, questions, answers, or neutral chat.",
        "frustration": "frustration ABOUT SCHOOLWORK: the task is hard, they don't understand, they're stuck, want to give up on an exercise, bored, tired of the topic. This is a coaching moment, NOT a safety concern.",
        "interest": "a hobby, interest, favorite team/player/game, or preference to remember (e.g. 'I like Messi').",
        "personal": "NON-harmful personal/identifying info about self or family (e.g. 'my mom is pregnant', an address, family jobs) — not a safety concern, just private.",
        "distress": "emotional, social, or family harm/distress BEYOND schoolwork: self-harm or wanting to die, self-hatred as a person, being bullied or friendless, family conflict/divorce, abuse, or serious persistent sadness.",
    },
    "rules": [
        "Return JSON only: {\"category\": one of [none, frustration, interest, personal, distress]}.",
        "'I can't do it / this is hard / I don't understand / I want to quit' about a TASK or SUBJECT is frustration, never distress.",
        "distress requires harm to the child as a person or their relationships — not difficulty with learning material.",
        "When genuinely ambiguous between frustration and distress, choose distress.",
        "'personal' is only for a private fact about the learner or family with no distress. Do not use it merely because the learner says they have, carry, like, or choose an ordinary object.",
        "Use recent_conversation only to understand the current learning exchange. A learner repeating, selecting, or paraphrasing the tutor's immediately preceding example or choice is ordinary learning talk, not personal, unless the learner supplies a concrete identifying detail.",
        "Words such as 'address' and 'phone number' can be educational concepts or tutor-provided examples. Classify them as personal only when the learner actually shares a private fact about themselves or family.",
        "Examples that are NONE, not personal: 'I have my phone', 'my backpack and house keys', 'a phone and a notebook', or choosing one of those objects in a learning exercise. These name ordinary possessions and reveal no identifying or sensitive private fact.",
        "Hebrew examples that are NONE, not personal: 'כמו כתובת', 'אני אראה דברים כמו הכתובת', 'הכתובת של הנקודה היא 3, 2', 'טלפון נייד', and 'המפתחות של הבית'. Here כתובת means an abstract learning concept, not the learner's home address.",
        "Examples that are PERSONAL: an actual home address, phone number, email address, identity number, or a private family fact such as 'my mother is pregnant'.",
    ],
}

# Fail-closed throttle: one classifier-unavailable review flag per learner per window.
_REVIEW_FLAG_WINDOW_SECONDS = 30 * 60
_last_review_flag: dict[str, float] = {}


async def classify_disclosure(
    text: str,
    language: str,
    *,
    usage_context: "UsageContext",
    recent_conversation: Optional[list[dict[str, object]]] = None,
) -> str:
    """Return none|frustration|interest|personal|distress for a learner message.

    ``recent_conversation`` is a small role-tagged window ending before this
    learner turn. It gives the classifier the immediate tutoring context, but
    is redacted and bounded here so callers cannot accidentally send a full
    transcript or raw identifiers to the provider.

    LLM-driven (no brittle keyword lists). Fails CLOSED (B-8): if the model is
    unreachable the category is "review" — the reply continues normally, but a
    throttled wellbeing flag tells the teacher the safety screen was down, so an
    outage can never silently disable distress detection.
    """
    message = (text or "").strip()
    if len(message) < 2:
        return "none"
    try:
        from app.services.llm import call_llm  # lazy: avoid import cycle
        payload = dict(_CLASSIFY_PROMPT)
        payload["output_language"] = language
        payload["message"] = message
        context = _disclosure_context_window(recent_conversation)
        if context:
            payload["recent_conversation"] = context
        raw = await call_llm(
            [{"role": "user", "content": _json_dumps(payload)}],
            usage_context=usage_context,
            max_tokens=60,
        )
        category = _extract_category(raw)
        return category if category in _DISCLOSURE_CATEGORIES else "none"
    except Exception:
        return "review"


def _disclosure_context_window(
    turns: Optional[list[dict[str, object]]],
) -> list[dict[str, str]]:
    """Return the smallest privacy-safe history useful to a turn classifier."""
    window: list[dict[str, str]] = []
    for turn in (turns or [])[-_DISCLOSURE_CONTEXT_TURNS:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "")
        if role not in {"user", "assistant"}:
            continue
        content, _ = strip_pii(str(turn.get("content") or ""))
        content = " ".join(content.split())[:_DISCLOSURE_CONTEXT_CHARS]
        if content:
            window.append({"role": role, "content": content})
    return window


async def record_classifier_outage(learner_id: str, language: str) -> None:
    """Throttled teacher signal that the safety screen was unavailable (B-8)."""
    import time
    now = time.monotonic()
    last = _last_review_flag.get(learner_id, 0.0)
    if now - last < _REVIEW_FLAG_WINDOW_SECONDS:
        return
    _last_review_flag[learner_id] = now
    await record_wellbeing_flag(
        learner_id,
        evidence="safety classifier unavailable — messages in this window were not screened",
        language=language,
        source="classifier_outage",
        category="review",
    )


def _json_dumps(value: dict) -> str:
    import json
    return json.dumps(value, ensure_ascii=False)


def _extract_category(raw: str) -> str:
    import json
    import re as _re
    text = (raw or "").strip()
    if not text:
        return "none"
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        match = _re.search(r"\{.*\}", text, _re.DOTALL)
        if not match:
            return "none"
        try:
            obj = json.loads(match.group(0))
        except json.JSONDecodeError:
            return "none"
    return str(obj.get("category") or "none").strip().lower()


#: What the child was told back, per source. A teacher walking into this
#: conversation needs to know what the child has already heard — "we told them
#: to talk to an adult they trust" changes the first sentence you say.
#:
#: Derived here rather than passed in by four call sites: this module owns both
#: halves (it writes the redirect the child sees), and a caller that forgot to
#: pass it would leave the teacher guessing.
def _reply_shown_to_learner(source: str, category: str, language: str) -> str:
    if source == "direct_message":
        # The message was refused, not delivered — and the child was told so.
        return _DM_DISTRESS_REPLY.get(language, _DM_DISTRESS_REPLY["he"])
    return redirect_message(category, language)


#: The learner-facing copy `direct_messages` answers a blocked distress message
#: with, kept beside its siblings. Mirrors `moderation.distress` in the locales;
#: the string is repeated rather than imported because the frontend renders that
#: key and the backend has no access to the locale tables.
_DM_DISTRESS_REPLY = {
    "he": ("מה שכתבת נשמע קשה, ואנחנו לא רוצים שתישאר/י עם זה לבד. ההודעה לא "
           "נשלחה, אבל דיווחנו למורה שלך כדי שמישהו יהיה איתך."),
    "ar": ("ما كتبته يبدو صعبًا، ولا نريدك أن تبقى مع هذا وحدك. لم تُرسَل "
           "الرسالة، لكننا أبلغنا معلّمك كي يكون أحد إلى جانبك."),
    "en": ("What you wrote sounds hard, and we don't want you to be alone with "
           "it. The message wasn't sent, but we told your teacher so someone "
           "can be there with you."),
}


async def record_wellbeing_flag(
    learner_id: str,
    evidence: str,
    language: str = "he",
    source: str = "mapping_reflection",
    category: str = "distress",
) -> Optional[dict]:
    """Record a distress signal for the teacher (single writer here).

    `evidence` is the learner's own words (raw, for F6 explainability). Non-fatal:
    any failure returns None so the learner-facing reply is never blocked.

    Written twice, deliberately, to two stores with two different jobs:

    * ``wellbeing_flags`` (its own collection) is the RECORD — durable, never
      trimmed, and the thing the teacher's bell links at. It carries state a
      human changes: claimed by whom, closed by whom, and why.
    * ``brain.wellbeing_flags`` is CONTEXT — inside the coach's read scope, and
      what `insights` and `moments` compute the "needs attention" strip from.

    They were one array until a notification outlived its own evidence: the bell
    still held the alert days after the array had been trimmed away, so clicking
    it landed on a profile with nothing on it.
    """
    try:
        from app.brain.repository import apply_brain_updates, get_brain  # lazy
        from app.services import wellbeing

        flag_id = wellbeing.new_flag_id()
        brain = await get_brain(learner_id)
        flags = list(brain.get("wellbeing_flags") or [])
        flag = {
            "id": flag_id,
            "category": category,
            "evidence": (evidence or "").strip()[:400],
            "language": language,
            "source": source,
            "at": datetime.now(timezone.utc).isoformat(),
            "resolved": False,
            "acknowledged_by": None,
        }
        flags.append(flag)
        await apply_brain_updates(learner_id, {"wellbeing_flags": flags[-_MAX_WELLBEING_FLAGS:]})
        await wellbeing.record(
            learner_id,
            evidence=flag["evidence"],
            category=category,
            source=source,
            language=language,
            reply=_reply_shown_to_learner(source, category, language),
            # A blocked message reached nobody. Anything else was said and seen.
            delivered=source != "direct_message",
            flag_id=flag_id,
        )
        await _escalate_to_teachers(learner_id, flag)
        return flag
    except Exception as exc:  # pragma: no cover - never block the reply
        print(f"⚠️ wellbeing flag not recorded: {exc}")
        return None


async def _escalate_to_teachers(learner_id: str, flag: dict) -> None:
    """Ring the teacher's bell, now.

    This is the one alert that must not wait for a dashboard refresh: a child has
    just said something that needs an adult. The flag is already durable in the
    brain by the time we get here, so a failure to reach the realtime layer loses
    the interrupt, not the record — and it is swallowed rather than raised,
    because nothing here may block the reply the child is waiting for.

    The evidence is the learner's own words. That is deliberate and narrow: the
    teacher does not get the coach transcript, they get the sentence that
    triggered the flag.
    """
    try:
        from app.services import presence, teacher_alerts, wellbeing
        presence.note_help_requested(learner_id)
        raised = await teacher_alerts.raise_alert(
            learner_id,
            "safety_flag",
            title_key="tch.alert.safety",
            params={"category": flag.get("category")},
            severity=teacher_alerts.SEVERITY_URGENT,
            bucket=teacher_alerts.default_bucket("safety_flag", flag_id=flag.get("id")),
            evidence={
                "label_key": "tch.evidence.learnerWords",
                "value": flag.get("category"),
                "raw": {
                    "evidence": flag.get("evidence"),
                    "category": flag.get("category"),
                    "source": flag.get("source"),
                    "at": flag.get("at"),
                    "flag_id": flag.get("id"),
                },
            },
            # The bell must land ON the disclosure, not at the top of a profile
            # with seven tabs. The flag id travels in the route because a
            # notification's action is written once and never rewritten — a
            # link that only says "open the student" can never be improved
            # later, as every alert raised before this line still proves.
            route=f"/teacher/student/{learner_id}?tab=wellbeing&flag={flag.get('id')}",
        )
        # Who was told. The single most useful line on the card when two
        # teachers share a class and each assumes the other went.
        await wellbeing.note_notified(
            str(flag.get("id") or ""),
            [str(alert.get("teacher_id")) for alert in raised if alert.get("teacher_id")],
        )
    except Exception as exc:  # pragma: no cover - never block the reply
        print(f"⚠️ safety escalation failed: {type(exc).__name__}: {exc}")
