"""Shared localization helpers for backend routes and prompts."""

from typing import Optional


SUPPORTED_LANGUAGES = {"he", "en", "ar"}
LANGUAGE_NAMES = {
    "he": "Hebrew",
    "en": "English",
    "ar": "Arabic",
}

LOCALIZED_FALLBACKS = {
    "empty_chat": {
        "he": "לא הבנתי, אפשר לכתוב שוב? 😊",
        "en": "I did not understand. Can you write that again? 😊",
        "ar": "لم أفهم، هل يمكنك أن تكتب ذلك مرة أخرى؟ 😊",
    },
    "chat_saved": {
        "he": "תודה ששיתפת! רשמתי את זה. יש עוד משהו שתרצה לספר לי?",
        "en": "Thanks for sharing! I wrote that down. Is there anything else you want to tell me?",
        "ar": "شكرًا لمشاركتك! سجلت ذلك. هل هناك شيء آخر تريد إخباري به؟",
    },
}


def normalize_language(language: Optional[str]) -> str:
    """Return a supported 2-letter language code."""
    normalized = (language or "he").lower()[:2]
    return normalized if normalized in SUPPORTED_LANGUAGES else "he"


def output_language_instruction(language: str) -> str:
    """Instruction for learner-facing AI output language."""
    return f"Write only in {LANGUAGE_NAMES.get(language, 'Hebrew')}."


def localized_fallback(key: str, language: str) -> str:
    """Return a localized fallback string with Hebrew as the safe default."""
    return LOCALIZED_FALLBACKS.get(key, {}).get(language) or LOCALIZED_FALLBACKS[key]["he"]