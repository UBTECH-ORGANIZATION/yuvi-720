"""Speech-to-text for learners who mix Hebrew and English inside one sentence.

Azure Speech identifies one locale per utterance, so a Hebrew sentence with
English inside it comes back either as Hebrew phonetics ("I play" -> "אייפליי")
or, when English wins, with the Hebrew Latinised. A transcription model has no
locale to pin, and a steering prompt tells it which script each language belongs
in. Lesson vocabulary is passed through the same prompt because short fragments
carry too little audio for the model to decide on their own.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx

DEFAULT_DEPLOYMENT = "gpt-4o-mini-transcribe"
API_VERSION = "2025-03-01-preview"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_VOCABULARY = 12

_BASE_PROMPT = (
    "The speaker is an Israeli student in a language lesson. They mix Hebrew and "
    "English inside a single sentence. Write Hebrew words in Hebrew script and "
    "English words in Latin script. Never transliterate English words into Hebrew "
    "letters, and never transliterate Hebrew words into Latin letters."
)


class TranscriptionUnavailable(RuntimeError):
    """Raised when the transcription model is not configured or refuses."""


def is_configured() -> bool:
    return bool(os.getenv("AZURE_OPENAI_REALTIME_ENDPOINT") and os.getenv("AZURE_OPENAI_REALTIME_KEY"))


def build_prompt(vocabulary: Optional[list[str]] = None) -> str:
    terms = [term.strip() for term in (vocabulary or []) if term and term.strip()]
    if not terms:
        return _BASE_PROMPT
    joined = ", ".join(terms[:MAX_VOCABULARY])
    return f"{_BASE_PROMPT} Words likely to appear in this lesson: {joined}."


def dominant_language(text: str) -> str:
    """Which language the learner mostly spoke, so the coach answers in kind."""
    hebrew = sum(1 for ch in text if "\u0590" <= ch <= "\u05FF")
    arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06FF" or "\u0750" <= ch <= "\u077F")
    latin = sum(1 for ch in text if ch.isascii() and ch.isalpha())
    if arabic > hebrew and arabic > latin:
        return "ar"
    if hebrew >= latin and hebrew:
        return "he"
    return "en" if latin else "he"


def wav_duration_seconds(audio: bytes) -> Optional[float]:
    """Duration from a PCM WAV header, for per-second usage metering."""
    if len(audio) < 44 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        return None
    try:
        channels = int.from_bytes(audio[22:24], "little")
        rate = int.from_bytes(audio[24:28], "little")
        bits = int.from_bytes(audio[34:36], "little")
        frame = channels * max(1, bits // 8)
        if not rate or not frame:
            return None
        return round(max(0, len(audio) - 44) / (rate * frame), 3)
    except Exception:
        return None


async def transcribe(
    audio: bytes,
    *,
    filename: str = "speech.wav",
    content_type: str = "audio/wav",
    vocabulary: Optional[list[str]] = None,
) -> tuple[str, httpx.Response]:
    """Return the transcript plus the raw response, for usage recording."""
    endpoint = (os.getenv("AZURE_OPENAI_REALTIME_ENDPOINT") or "").rstrip("/")
    key = os.getenv("AZURE_OPENAI_REALTIME_KEY") or ""
    if not endpoint or not key:
        raise TranscriptionUnavailable("transcription endpoint not configured")
    if not audio:
        raise TranscriptionUnavailable("empty audio")
    if len(audio) > MAX_AUDIO_BYTES:
        raise TranscriptionUnavailable("audio too large")

    deployment = os.getenv("AZURE_TRANSCRIBE_DEPLOYMENT", DEFAULT_DEPLOYMENT)
    url = f"{endpoint}/openai/deployments/{deployment}/audio/transcriptions?api-version={API_VERSION}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            url,
            headers={"api-key": key},
            files={"file": (filename, audio, content_type)},
            data={"response_format": "json", "prompt": build_prompt(vocabulary)},
        )
    if response.status_code != 200:
        raise TranscriptionUnavailable(f"transcription failed ({response.status_code})")
    return (response.json().get("text") or "").strip(), response
