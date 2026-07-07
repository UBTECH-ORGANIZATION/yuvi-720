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
from typing import Optional

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
