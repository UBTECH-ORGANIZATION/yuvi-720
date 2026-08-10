"""Gentle correction of a learner's spoken English (נספח 2: Spoken Production).

The pedagogy here is deliberate and is the whole point of the module.

A 12-14 year old who is talked over every time they make a mistake stops
talking. The technique used instead is a RECAST: Yuvi says the sentence back the
way a speaker would say it, keeps the conversation moving, and the learner hears
the correct form right next to their own. So this module returns at most ONE
correction per utterance — the one that most gets in the way of being understood
— never a list, never a score, and never the word "wrong".

An important limitation to be honest about: the text we see is Whisper's
transcript, and Whisper tidies grammar and punctuation as it transcribes. Some
of what the child actually said never reaches us, so this is a helpful second
pair of ears, NOT an assessment. Nothing here may feed mastery — the scored
path is `pronunciation.py` plus the graded items in the lomda.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional

from app.agents import safety
from app.services.ai_usage import UsageContext

# Below this there is no sentence to recast — a greeting or a single word is a
# turn in the conversation, not an attempt at a structure.
_MIN_WORDS = 3
_MAX_CHARS = 400

_PROMPT = {
    "task": (
        "You help a 12-14 year old practise SPOKEN English. You are given one "
        "sentence they just said out loud. Decide whether a speaker would say it "
        "differently, and if so give the natural version."
    ),
    "rules": [
        'Return JSON only: {"ok": true} when the sentence already works, or '
        '{"say": "<the whole sentence said naturally>", "note": "<one short line>"}.',
        "Correct AT MOST ONE thing — the one that most gets in the way of being understood. Ignore the rest.",
        "'say' must be their own sentence with that one thing fixed. Keep their words, their meaning and their length. Never answer them, never continue the conversation, never add a new idea.",
        "'note' explains that one thing to a child in ONE short line, in the note_language. No grammar jargon unless it is a word they meet in class.",
        "'note' MUST be written in note_language. If note_language is Hebrew, the sentence of the note is in Hebrew; only the English forms being taught stay in English (e.g. \"אחרי he משתמשים ב-has\"). The same for Arabic. Never write the note in English unless note_language is English.",
        "Never use the words wrong, mistake, error, bad. Never use numbers, scores, percentages or levels. Never compare them to anyone.",
        "A missing full stop or capital letter is not worth a correction — this was speech, not writing.",
        "If they mixed in a word of their own language because they did not know the English one, the correction IS the English word.",
        "If the sentence is already natural, return {\"ok\": true}. Most turns should be ok — silence is the default.",
    ],
}

_NOTE_LANGUAGE = {"he": "Hebrew", "ar": "Arabic", "en": "English"}


def _looks_english(text: str) -> bool:
    latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    return latin >= 3


def _worth_correcting(text: str) -> bool:
    """Cheap gate so an ordinary turn never costs a model call."""
    stripped = (text or "").strip()
    if not stripped or len(stripped) > _MAX_CHARS:
        return False
    if not _looks_english(stripped):
        return False
    return len(re.findall(r"[A-Za-z']+", stripped)) >= _MIN_WORDS


def _parse(raw: str) -> Optional[dict[str, str]]:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return None
        try:
            obj = json.loads(match.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(obj, dict) or obj.get("ok") is True:
        return None
    say = str(obj.get("say") or "").strip()
    note = str(obj.get("note") or "").strip()
    if not say:
        return None
    return {"say": say[:300], "note": note[:220]}


def _clean(correction: dict[str, str], original: str) -> Optional[dict[str, str]]:
    """Drop a "correction" that is really a no-op or a rule break."""
    say = correction["say"]
    # A recast that only re-punctuates teaches nothing and reads as nagging.
    if _normalized(say) == _normalized(original):
        return None
    if any(ch.isdigit() for ch in correction["note"]):
        correction["note"] = ""
    return correction


def _normalized(text: str) -> str:
    return re.sub(r"[^a-z]+", "", text.lower())


async def suggest(
    text: str,
    language: str,
    *,
    usage_context: UsageContext,
) -> Optional[dict[str, str]]:
    """One recast for one spoken sentence, or None to stay quiet.

    Staying quiet is not a failure mode — it is the common case, and a model
    outage must never interrupt a conversation the child is in the middle of.
    """
    if not _worth_correcting(text):
        return None
    try:
        from app.services.llm import call_llm  # lazy: avoid an import cycle

        payload = dict(_PROMPT)
        payload["note_language"] = _NOTE_LANGUAGE.get(language, "Hebrew")
        payload["sentence"] = text.strip()
        raw = await call_llm(
            [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
            usage_context=usage_context,
            max_tokens=160,
        )
    except Exception as exc:
        print(f"⚠️ english correction unavailable ({type(exc).__name__})")
        return None

    correction = _parse(raw)
    if not correction:
        return None
    correction = _clean(correction, text)
    if not correction:
        return None
    # It is about to be shown to a child, so it passes the same gate as any
    # other model output.
    correction["say"] = safety.screen_output(correction["say"], "en").text
    if correction["note"]:
        correction["note"] = safety.screen_output(correction["note"], language).text
    return correction


def summarize(corrections: list[dict[str, Any]], language: str) -> str:
    """One closing line naming what to carry into the next conversation."""
    notes = [str(item.get("note") or "").strip() for item in corrections if item]
    notes = [note for note in notes if note][:2]
    if not notes:
        return _NOTHING_TO_FIX.get(language, _NOTHING_TO_FIX["he"])
    lead = _CARRY_FORWARD.get(language, _CARRY_FORWARD["he"])
    return lead + " " + " ".join(notes)


_NOTHING_TO_FIX = {
    "he": "דיברת באנגלית וזה עבר — אפשר להמשיך משם בפעם הבאה.",
    "ar": "تحدّثت بالإنجليزية ونجح الأمر — يمكننا المتابعة من هنا في المرّة القادمة.",
    "en": "You spoke English and it worked — we can carry on from here next time.",
}

_CARRY_FORWARD = {
    "he": "מה ששווה לקחת לשיחה הבאה:",
    "ar": "ما يستحقّ أن تأخذه إلى المحادثة القادمة:",
    "en": "Worth taking into the next conversation:",
}
