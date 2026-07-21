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
    table = DISTRESS_SUPPORT if category == "distress" else PERSONAL_REDIRECT
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
        for table in (DISTRESS_SUPPORT, PERSONAL_REDIRECT)
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
        "'personal' is only for private facts with no distress.",
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
) -> str:
    """Return none|frustration|interest|personal|distress for a learner message.

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
        raw = await call_llm(
            [{"role": "user", "content": _json_dumps(payload)}],
            usage_context=usage_context,
            max_tokens=60,
        )
        category = _extract_category(raw)
        return category if category in _DISCLOSURE_CATEGORIES else "none"
    except Exception:
        return "review"


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


async def record_wellbeing_flag(
    learner_id: str,
    evidence: str,
    language: str = "he",
    source: str = "mapping_reflection",
    category: str = "distress",
) -> Optional[dict]:
    """Append a distress signal to the brain for the teacher (single writer here).

    `evidence` is the learner's own words (raw, for F6 explainability). Non-fatal:
    any failure returns None so the learner-facing reply is never blocked.
    """
    try:
        from app.brain.repository import apply_brain_updates, get_brain  # lazy
        brain = await get_brain(learner_id)
        flags = list(brain.get("wellbeing_flags") or [])
        flag = {
            "id": f"wb_{datetime.now(timezone.utc).timestamp():.0f}",
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
        return flag
    except Exception as exc:  # pragma: no cover - never block the reply
        print(f"⚠️ wellbeing flag not recorded: {exc}")
        return None
