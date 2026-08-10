"""Pronunciation assessment — provider scores in, actionable words out.

Azure returns numbers (accuracy / fluency / completeness / prosody, per word and
per phoneme). The learner must never see them: 720 is explicit that student
feedback is verbal and effort-based, and a 61 next to a child's voice is the
fastest way to stop them speaking. So the numbers stay on this side and are
turned, deterministically, into one honest sentence plus at most two words to
try again.

The assessment itself runs in the BROWSER, against a short-lived token, so the
learner's audio goes straight to Azure and never touches our servers. What
arrives here is the score sheet, which is exactly what we are allowed to keep.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.services.ai_usage import UsageContext, UsageTimer, record_usage

PROVIDER = "azure_speech"
GATEWAY = "azure_speech_browser_sdk"
DEPLOYMENT = "pronunciation-assessment"

# Bands are deliberately coarse. Finer grading would imply a precision the
# learner cannot act on, and would tempt us to show the number.
_STRONG = 80.0
_FAIR = 60.0

# Below this a word is worth naming as "try this one again". Above it, naming it
# would be nagging about something that was already understood.
_WORD_RETRY = 65.0
_MAX_RETRY_WORDS = 2

_HEADLINE = {
    "strong": {
        "he": "שמעתי אותך ברור מאוד. ההגייה שלך עובדת.",
        "ar": "سمعتك بوضوح تام. لفظك يؤدّي الغرض.",
        "en": "I heard you clearly. Your pronunciation is working.",
    },
    "fair": {
        "he": "הבנתי אותך. יש כמה מילים שכדאי לחדד, וזה בהחלט בהישג יד.",
        "ar": "فهمتك. هناك بعض الكلمات تستحقّ الصقل، وهي في متناولك تماماً.",
        "en": "I understood you. A couple of words are worth sharpening, and they are within reach.",
    },
    "developing": {
        "he": "שמעתי אותך, וחלק מהמילים עוד מתיישבות. זה בדיוק מה שקורה כשמתחילים לדבר.",
        "ar": "سمعتك، وبعض الكلمات ما زالت تستقرّ. هذا بالضبط ما يحدث عند بداية المحادثة.",
        "en": "I heard you, and some words are still settling. That is exactly what happens when you start speaking.",
    },
}

_FLUENCY_NOTE = {
    "he": "נסו להשמיע את המשפט ברצף אחד, בלי לעצור באמצע — זה עושה הבדל גדול.",
    "ar": "حاولوا قول الجملة دفعة واحدة دون توقّف في المنتصف — هذا يُحدث فرقاً كبيراً.",
    "en": "Try saying the sentence in one flow, without stopping in the middle — it makes a big difference.",
}

_COMPLETENESS_NOTE = {
    "he": "חלק מהמילים לא נאמרו. אמרו את המשפט המלא, גם אם לאט.",
    "ar": "بعض الكلمات لم تُقل. قولوا الجملة كاملة، ولو ببطء.",
    "en": "Some words were not said. Say the whole sentence, even slowly.",
}

_RETRY_LEAD = {
    "he": "שווה לנסות שוב את: ",
    "ar": "يستحقّ إعادة المحاولة مع: ",
    "en": "Worth another go: ",
}

_NEXT_STEP = {
    "strong": {
        "he": "נסו עכשיו משפט ארוך יותר.",
        "ar": "جرّبوا الآن جملة أطول.",
        "en": "Now try a longer sentence.",
    },
    "fair": {
        "he": "השמיעו את הדוגמה עוד פעם אחת, ואז אמרו אותה שוב.",
        "ar": "استمعوا إلى النموذج مرّة أخرى، ثم قولوها من جديد.",
        "en": "Play the model once more, then say it again.",
    },
    "developing": {
        "he": "האזינו למשפט, אמרו רק את החצי הראשון, ואז את כולו.",
        "ar": "استمعوا إلى الجملة، قولوا النصف الأوّل فقط، ثم الجملة كاملة.",
        "en": "Listen to the sentence, say just the first half, then the whole thing.",
    },
}


class PronunciationError(ValueError):
    """A result we will not trust — never surfaced to the learner verbatim."""


def _score(value: Any) -> Optional[float]:
    """A provider score, or None. Out-of-range values are refused, not clamped:
    a 300 means we misread the payload, and inventing an 100 would hide that."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if 0.0 <= number <= 100.0 else None


def _band(accuracy: Optional[float]) -> str:
    if accuracy is None:
        return "developing"
    if accuracy >= _STRONG:
        return "strong"
    if accuracy >= _FAIR:
        return "fair"
    return "developing"


def normalize_result(payload: Any) -> dict[str, Any]:
    """Reduce the browser SDK's assessment to the fields we keep.

    Everything else — the raw audio, the recognised text, the phoneme tree — is
    either never sent or dropped here.
    """
    if not isinstance(payload, dict):
        raise PronunciationError("invalid_assessment")

    scores = {
        "accuracy": _score(payload.get("accuracyScore")),
        "fluency": _score(payload.get("fluencyScore")),
        "completeness": _score(payload.get("completenessScore")),
        "prosody": _score(payload.get("prosodyScore")),
        "pronunciation": _score(payload.get("pronunciationScore")),
    }
    if scores["accuracy"] is None and scores["pronunciation"] is None:
        raise PronunciationError("no_usable_score")

    words: list[dict[str, Any]] = []
    for row in payload.get("words") or []:
        if not isinstance(row, dict):
            continue
        word = str(row.get("word") or "").strip()[:40]
        if not word:
            continue
        words.append({
            "word": word,
            "accuracy": _score(row.get("accuracyScore")),
            "error_type": str(row.get("errorType") or "").strip()[:20] or None,
        })

    duration = payload.get("durationSeconds")
    return {
        "scores": scores,
        "words": words[:40],
        # The provider's own audio duration — Azure Speech's billing unit.
        "duration_seconds": round(float(duration), 3) if isinstance(duration, (int, float)) and duration > 0 else None,
    }


def verbal_feedback(result: dict[str, Any], language: str = "he") -> dict[str, Any]:
    """One honest sentence, up to two words to retry, and a next step.

    Deterministic on purpose: the same performance always gets the same words,
    so a learner can trust that the feedback is about them and not about the
    model's mood that turn.
    """
    lang = language if language in ("he", "ar", "en") else "he"
    scores = result.get("scores") or {}
    accuracy = scores.get("accuracy") if scores.get("accuracy") is not None else scores.get("pronunciation")
    band = _band(accuracy)

    notes: list[str] = []
    completeness = scores.get("completeness")
    fluency = scores.get("fluency")
    # Missing words matter more than choppiness, so only the top issue is raised —
    # two corrections at once is what makes a learner stop trying.
    if completeness is not None and completeness < _FAIR:
        notes.append(_COMPLETENESS_NOTE[lang])
    elif fluency is not None and fluency < _FAIR:
        notes.append(_FLUENCY_NOTE[lang])

    retry = [
        row["word"] for row in result.get("words") or []
        if row.get("accuracy") is not None and row["accuracy"] < _WORD_RETRY
    ][:_MAX_RETRY_WORDS]
    if retry:
        notes.append(_RETRY_LEAD[lang] + ", ".join(retry))

    return {
        "band": band,
        "headline": _HEADLINE[band][lang],
        "notes": notes,
        "nextStep": _NEXT_STEP[band][lang],
        "retryWords": retry,
        # Never rendered — the player uses it to tint a word, not to show a number.
        "wordAccuracy": {row["word"]: row["accuracy"] for row in result.get("words") or []},
    }


def spoke_english(result: dict[str, Any]) -> bool:
    """Did this count as an English turn for the ladder?

    A recognised utterance that produced word-level scores IS English speech —
    the recognizer was running against an English reference. Silence and noise
    produce no words and must not be credited.
    """
    return bool(result.get("words"))


async def record_assessment_usage(
    result: dict[str, Any],
    *,
    context: UsageContext,
    timer: UsageTimer,
    error: Optional[BaseException] = None,
) -> None:
    """One metering event per assessed utterance, in the provider's own unit.

    Azure Speech bills recognition by audio duration, and the duration is the
    provider's, not a wall clock: the request happened in the learner's browser,
    so our elapsed time would measure the network, not the audio.
    """
    duration = result.get("duration_seconds") if isinstance(result, dict) else None
    await record_usage(
        context=context,
        timer=timer,
        provider=PROVIDER,
        gateway=GATEWAY,
        deployment=DEPLOYMENT,
        api_version=None,
        streaming=False,
        meter="seconds",
        status="failed" if error else "completed",
        usage_status="exact" if duration is not None else "unavailable",
        quantity=int(round(duration)) if duration is not None else None,
        quantity_unit="seconds",
        error=error,
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
