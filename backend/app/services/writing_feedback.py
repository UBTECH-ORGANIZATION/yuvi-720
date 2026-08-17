"""Formative feedback on a learner's free-written English text.

Writing was the one productive skill the lomda could only ask the learner to
self-check: they wrote, ticked a checklist and moved on. This closes that —
the text comes back with a comment on WHAT WORKS and ONE next step, in the
learner's own language.

Three rules the whole module is built around:

* **No score, ever.** 720 §2 and the product's own feedback rules: student-facing
  learning feedback is verbal. No mark, no percentage, no "4 out of 5".
* **The model phrases, it does not judge.** Which checklist lines were met is
  decided by deterministic checks over the text (sentence count, capitalisation,
  connectors); the model turns that into warm, age-appropriate prose. When the
  gateway is down the deterministic half still produces real feedback.
* **Nothing identifying is sent.** The payload is the learner's own text and the
  task — no name, no id, no profile. The pseudonymous id lives in the
  ``UsageContext`` only, which is what ``ai_usage_events`` attributes on.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

MAX_TEXT_CHARS = 1200

_CONNECTORS = ("and", "but", "because", "so", "then", "also")
_SENTENCE_SPLIT = re.compile(r"[.!?]+")

# The learner reads this when the gateway is unavailable — never an error, and
# never silence: the deterministic checks alone are already useful feedback.
_OPENERS = {
    "he": "קראתי את מה שכתבת.",
    "ar": "قرأت ما كتبته.",
    "en": "I read what you wrote.",
}
_NEXT_STEP_FALLBACK = {
    "he": "עברו שוב על הרשימה למטה ובדקו איזה סעיף עוד אפשר להוסיף לטקסט.",
    "ar": "راجعوا القائمة أدناه وتحقّقوا من البند الذي يمكن إضافته إلى النصّ.",
    "en": "Go over the list below again and see which line you can still add to your text.",
}


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in _SENTENCE_SPLIT.split(text) if part.strip()]


def observe(text: str) -> dict[str, Any]:
    """What is verifiably true about this text. No judgement, no model."""
    clean = (text or "").strip()
    sentences = _sentences(clean)
    words = re.findall(r"[A-Za-z']+", clean)
    lowered = clean.lower()
    used = [c for c in _CONNECTORS if re.search(rf"\b{c}\b", lowered)]
    capitalised = [s for s in sentences if s[:1].isupper()]
    return {
        "sentence_count": len(sentences),
        "word_count": len(words),
        "connectors_used": used,
        "explains_why": "because" in used,
        "all_sentences_capitalised": bool(sentences) and len(capitalised) == len(sentences),
        "capitalised_sentences": len(capitalised),
    }


def _localized(entry: Any, language: str) -> str:
    if isinstance(entry, dict):
        return str(entry.get(language) or entry.get("he") or entry.get("en") or "")
    return str(entry or "")


def _checklist_state(
    checklist: list[Any], language: str, facts: dict[str, Any]
) -> list[dict[str, Any]]:
    """Mark each checklist line met / not-met / undecidable, from the facts only.

    ``met=None`` means "we cannot tell from the text" (e.g. "I read it again").
    An undecidable line is shown neutrally rather than guessed at.
    """
    out: list[dict[str, Any]] = []
    for index, entry in enumerate(checklist or []):
        label = _localized(entry, language)
        probe = _localized(entry, "en").lower()
        met: Optional[bool] = None
        if "three sentences" in probe or "at least three" in probe:
            met = facts["sentence_count"] >= 3
        elif "capital" in probe:
            met = facts["all_sentences_capitalised"]
        elif "because" in probe:
            met = facts["explains_why"]
        elif "linking word" in probe or "and, but" in probe:
            met = len(facts["connectors_used"]) >= 2
        elif "why" in probe:
            met = facts["explains_why"]
        out.append({"index": index, "label": label, "met": met})
    return out


def _prompt(
    text: str,
    task: str,
    language: str,
    cefr_level: str,
    facts: dict[str, Any],
    checklist: list[dict[str, Any]],
) -> list[dict[str, str]]:
    lines = "\n".join(
        f"- {row['label']} → {'met' if row['met'] else 'not met' if row['met'] is False else 'cannot be checked automatically'}"
        for row in checklist
    ) or "- (no checklist)"
    system = (
        "You are a warm middle-school English teacher writing formative feedback for a "
        f"{cefr_level} learner in Israel. Reply ONLY with JSON: "
        '{"praise": "...", "next_step": "..."}\n'
        "Rules, all mandatory:\n"
        f"- Write both fields in this language code: {language}. English words the learner "
        "used may be quoted inside, but the sentences themselves are in that language.\n"
        "- NEVER give a score, mark, percentage, grade or count out of anything.\n"
        "- `praise` is one or two sentences naming something CONCRETE the learner actually "
        "did, quoting a short phrase from their text.\n"
        "- `next_step` is exactly ONE actionable improvement, phrased as an invitation, "
        "with a tiny worked example the learner can copy. Never rewrite their whole text.\n"
        "- Never blame the learner. Never mention this checklist as a checklist.\n"
        "- If the text is empty or off-task, say so kindly and give a first sentence to start from."
    )
    user = (
        f"The task the learner was given:\n{task}\n\n"
        f"What the learner wrote:\n{text}\n\n"
        f"Verified facts about the text (do not contradict these):\n"
        f"- sentences: {facts['sentence_count']}, words: {facts['word_count']}\n"
        f"- connectors used: {', '.join(facts['connectors_used']) or 'none'}\n"
        f"- every sentence starts with a capital letter: {facts['all_sentences_capitalised']}\n\n"
        f"Checklist outcome:\n{lines}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


async def review(
    *,
    text: str,
    task: str,
    checklist: list[Any],
    language: str,
    cefr_level: str,
    learner_id: str,
    component_id: str,
    session_id: Optional[str] = None,
) -> dict[str, Any]:
    """Return `{praise, next_step, checklist, ai_generated}` — never a score."""
    trimmed = (text or "").strip()[:MAX_TEXT_CHARS]
    facts = observe(trimmed)
    state = _checklist_state(checklist, language, facts)
    lang = language if language in _OPENERS else "he"
    result = {
        "praise": _OPENERS[lang],
        "next_step": _NEXT_STEP_FALLBACK[lang],
        "checklist": state,
        "ai_generated": False,
    }
    if not trimmed:
        return result

    content = await call_llm(
        _prompt(trimmed, task, lang, cefr_level, facts, state),
        usage_context=UsageContext(
            actor_id=learner_id,
            actor_type="learner",
            endpoint="/content/player/writing-feedback",
            feature="english_writing",
            operation="writing_feedback",
            source="content_player",
            session_id=session_id,
        ),
        max_tokens=400,
        json_mode=True,
    )
    if not content:
        return result
    try:
        parsed = json.loads(content)
    except (TypeError, ValueError):
        return result
    praise = str(parsed.get("praise") or "").strip()
    next_step = str(parsed.get("next_step") or "").strip()
    if not praise and not next_step:
        return result
    # A model that slipped a number in anyway does not reach the learner.
    if re.search(r"\d+\s*(/|out of|מתוך|من)\s*\d+", f"{praise} {next_step}"):
        return result
    result.update({
        "praise": praise or result["praise"],
        "next_step": next_step or result["next_step"],
        "ai_generated": True,
    })
    return result
