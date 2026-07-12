"""Math-aware text-to-speech for Yuvi's completed Coach messages.

Azure Speech is called only from the backend so its subscription key never
reaches the browser. The frontend falls back to the Web Speech API when this
optional service is not configured.
"""

from __future__ import annotations

from html import escape
import os
import re

import httpx

from app.services.ai_usage import UsageContext, UsageTimer, provider_request_id, record_usage


MAX_SPEECH_CHARACTERS = 6000

VOICES = {
    "he": {
        "classic": ("he-IL", "he-IL-AvriNeural"),
        "girl": ("he-IL", "he-IL-HilaNeural"),
    },
    "ar": {
        "classic": ("ar-SA", "ar-SA-HamedNeural"),
        "girl": ("ar-SA", "ar-SA-ZariyahNeural"),
    },
    "en": {
        "classic": ("en-US", "en-US-GuyNeural"),
        "girl": ("en-US", "en-US-JennyNeural"),
    },
}

_SPEECH_TERMS = {
    "he": {
        "equals": "שווה",
        "plus": "ועוד",
        "minus": "פחות",
        "times": "כפול",
        "divided": "חלקי",
        "sqrt": "שורש של",
        "squared": "בריבוע",
        "cubed": "בחזקת שלוש",
        "power": "בחזקת",
        "less_equal": "קטן או שווה ל",
        "greater_equal": "גדול או שווה ל",
        "not_equal": "לא שווה ל",
        "theta": "תטא",
        "alpha": "אלפא",
        "beta": "בטא",
        "pi": "פאי",
    },
    "ar": {
        "equals": "يساوي",
        "plus": "زائد",
        "minus": "ناقص",
        "times": "ضرب",
        "divided": "على",
        "sqrt": "الجذر التربيعي لـ",
        "squared": "تربيع",
        "cubed": "تكعيب",
        "power": "أس",
        "less_equal": "أصغر من أو يساوي",
        "greater_equal": "أكبر من أو يساوي",
        "not_equal": "لا يساوي",
        "theta": "ثيتا",
        "alpha": "ألفا",
        "beta": "بيتا",
        "pi": "باي",
    },
    "en": {
        "equals": "equals",
        "plus": "plus",
        "minus": "minus",
        "times": "times",
        "divided": "divided by",
        "sqrt": "the square root of",
        "squared": "squared",
        "cubed": "cubed",
        "power": "to the power of",
        "less_equal": "is less than or equal to",
        "greater_equal": "is greater than or equal to",
        "not_equal": "is not equal to",
        "theta": "theta",
        "alpha": "alpha",
        "beta": "beta",
        "pi": "pi",
    },
}

_FENCED_BLOCK = re.compile(r"```[^\n]*\n?[\s\S]*?```", re.MULTILINE)
_MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LATEX_WRAPPER = re.compile(r"\\[\[(]([\s\S]*?)\\[\])]")
_FRAC = re.compile(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}")
_SQRT = re.compile(r"\\sqrt\s*\{([^{}]+)\}")
_POWER_BRACED = re.compile(r"([\w\d)]+)\s*\^\s*\{([^{}]+)\}")
_POWER_SIMPLE = re.compile(r"([\w\d)]+)\s*\^\s*([\w\d]+)")


def normalize_math_for_speech(text: str, language: str) -> str:
    """Convert Coach prose and common math notation into speakable text.

    The function intentionally receives text only. Visual data URLs, image
    pixels, and image alternative text are never submitted for synthesis.
    """
    lang = language if language in _SPEECH_TERMS else "he"
    terms = _SPEECH_TERMS[lang]
    spoken = _FENCED_BLOCK.sub(" ", text or "")
    spoken = _MARKDOWN_IMAGE.sub(" ", spoken)
    spoken = _LATEX_WRAPPER.sub(lambda match: f" {match.group(1)} ", spoken)
    spoken = spoken.replace("$$", " ").replace("$", " ")

    for _ in range(3):
        spoken = _FRAC.sub(
            lambda match: f" {match.group(1)} {terms['divided']} {match.group(2)} ",
            spoken,
        )
    spoken = _SQRT.sub(lambda match: f" {terms['sqrt']} {match.group(1)} ", spoken)

    def power_replacement(match: re.Match[str]) -> str:
        base, exponent = match.group(1), match.group(2)
        if exponent == "2":
            return f" {base} {terms['squared']} "
        if exponent == "3":
            return f" {base} {terms['cubed']} "
        return f" {base} {terms['power']} {exponent} "

    spoken = _POWER_BRACED.sub(power_replacement, spoken)
    spoken = _POWER_SIMPLE.sub(power_replacement, spoken)

    latex_terms = {
        r"\theta": terms["theta"],
        r"\alpha": terms["alpha"],
        r"\beta": terms["beta"],
        r"\pi": terms["pi"],
        r"\times": terms["times"],
        r"\cdot": terms["times"],
        r"\div": terms["divided"],
        r"\leq": terms["less_equal"],
        r"\le": terms["less_equal"],
        r"\geq": terms["greater_equal"],
        r"\ge": terms["greater_equal"],
        r"\neq": terms["not_equal"],
        r"\ne": terms["not_equal"],
    }
    for notation, word in latex_terms.items():
        spoken = spoken.replace(notation, f" {word} ")

    symbol_terms = [
        ("≤", terms["less_equal"]),
        ("≥", terms["greater_equal"]),
        ("≠", terms["not_equal"]),
        ("×", terms["times"]),
        ("÷", terms["divided"]),
        ("=", terms["equals"]),
        ("+", terms["plus"]),
        ("−", terms["minus"]),
    ]
    for symbol, word in symbol_terms:
        spoken = spoken.replace(symbol, f" {word} ")

    spoken = re.sub(r"(?<=\s)-(?=\s|\d)", f" {terms['minus']} ", spoken)
    spoken = spoken.replace("**", "").replace("__", "").replace("`", "")
    spoken = re.sub(r"\\(?:left|right|mathrm|text|operatorname)\b", " ", spoken)
    spoken = re.sub(r"[{}]", " ", spoken)
    spoken = re.sub(r"\s+", " ", spoken).strip()
    return spoken[:MAX_SPEECH_CHARACTERS]


class SpeechUnavailable(RuntimeError):
    """Azure Speech is optional or temporarily unavailable."""


def voice_for(language: str, avatar_variant: str) -> tuple[str, str]:
    """Resolve a locale and voice from the persisted non-identifying avatar."""
    lang = language if language in VOICES else "he"
    variant = avatar_variant if avatar_variant in {"classic", "girl"} else "classic"
    return VOICES[lang][variant]


async def synthesize_speech(
    text: str,
    language: str,
    *,
    avatar_variant: str = "classic",
    usage_context: UsageContext,
) -> bytes:
    """Return an MP3 synthesized by Azure Speech."""
    timer = UsageTimer.start()
    key = os.getenv("AZURE_SPEECH_KEY", "").strip()
    region = os.getenv("AZURE_SPEECH_REGION", "").strip()
    if not key or not region:
        await record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_speech",
            gateway="azure_speech_rest",
            deployment="text_to_speech",
            api_version=None,
            streaming=False,
            meter="characters",
            status="unavailable",
            usage_status="not_applicable",
        )
        raise SpeechUnavailable("Azure Speech is not configured")

    lang = language if language in VOICES else "he"
    locale, voice = voice_for(lang, avatar_variant)
    spoken = normalize_math_for_speech(text, lang)
    if not spoken:
        raise ValueError("No speakable text")

    endpoint = os.getenv(
        "AZURE_SPEECH_ENDPOINT",
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
    ).strip()
    ssml = (
        f'<speak version="1.0" xml:lang="{locale}">'
        f'<voice name="{voice}"><prosody rate="-4%">{escape(spoken)}</prosody></voice>'
        "</speak>"
    )
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "Yuvilab-Spark-Yuvi",
    }
    response = None
    error = None
    status = "failed"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(endpoint, content=ssml.encode("utf-8"), headers=headers)
        response.raise_for_status()
        status = "completed"
    except httpx.HTTPError as exc:
        error = exc
        raise SpeechUnavailable("Azure Speech request failed") from exc
    finally:
        await record_usage(
            context=usage_context,
            timer=timer,
            provider="azure_speech",
            gateway="azure_speech_rest",
            deployment=voice,
            api_version=None,
            streaming=False,
            meter="characters",
            status=status,
            usage_status="exact",
            quantity=len(spoken),
            quantity_unit="characters",
            provider_request=provider_request_id(response.headers) if response is not None else None,
            error=error,
            response_bytes=len(response.content) if response is not None and status == "completed" else None,
        )
    return response.content
