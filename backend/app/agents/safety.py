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
_ISRAELI_ID = re.compile(r"\b\d{9}\b")                       # ת"ז
_PHONE = re.compile(r"(?:\+972[-\s]?|0)\d(?:[-\s]?\d){7,8}\b")
_LONG_DIGITS = re.compile(r"\b\d{7,}\b")
_URL = re.compile(r"https?://\S+")

REDACTION = "▮"

# Minimal blocklist (extend as policy evolves). Tier-2 LLM handles nuance.
_BLOCKLIST = re.compile(
    r"\b(כתובת\s+הבית|address|תעודת\s*זהות|social\s+security)\b", re.IGNORECASE
)

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
    sanitized, found = strip_pii(text or "")
    flagged = found or bool(_BLOCKLIST.search(sanitized))
    return SafetyResult(text=sanitized.strip(), flagged=flagged,
                        reason="pii_or_blocklist" if flagged else None)


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

_DISCLOSURE_CATEGORIES = ("none", "personal", "interest", "distress")

# Language-keyed distress screening classifier (LLM). Kept JSON-only + fallback so
# the app stays demoable offline; a distress miss falls back to "none" (the tier-1
# gate and teacher review remain), never inventing a flag without the model.
_CLASSIFY_PROMPT = {
    "task": "Classify a learner's chat message for a school AI safety gate.",
    "categories": {
        "none": "ordinary learning talk, questions, answers, or neutral chat.",
        "interest": "a hobby, interest, favorite team/player/game, or preference to remember (e.g. 'I like Messi').",
        "personal": "NON-harmful personal/identifying info about self or family (e.g. 'my mom is pregnant', an address, family jobs) — not a safety concern, just private.",
        "distress": "emotional, social, or family harm/distress: self-harm or wanting to die, self-hatred, being bullied or friendless, family conflict/divorce, abuse, or serious sadness.",
    },
    "rules": [
        "Return JSON only: {\"category\": one of [none, interest, personal, distress]}.",
        "Prefer distress if there is any real emotional/safety concern.",
        "'personal' is only for private facts with no distress.",
    ],
}


async def classify_disclosure(
    text: str,
    language: str,
    *,
    usage_context: "UsageContext",
) -> str:
    """Return one of none|interest|personal|distress for a learner message.

    LLM-driven (no brittle keyword lists); on any error returns "none" so the
    reply flow is never blocked. Callers decide how to respond per category.
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
        return "none"


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
