"""Hard guard against the coach handing the learner the correct answer.

The coach is given the ground-truth answer (`current_question_correct_answer`)
so it can guide accurately — but a prompt rule alone is not a guarantee. Asked
directly ("just give me the answer"), the model complies: observed in Hebrew
production chat, "התשובה היא שהבלון המנופח כבד יותר, כי ...". Once stated, the
question is spent — the learner reports an answer they did not reach, and the
mastery signal built from it is a lie.

So the reveal is blocked deterministically, on the way OUT, per sentence, before
anything reaches the client. Two independent detectors:

1. **Answer assertion** — the reply says "the answer is …" in any supported
   language. A coach never has a reason to; guiding phrasings ("what would you
   check first?") never match.
2. **Correct-option naming** — the reply contains the correct option verbatim, or
   every token that distinguishes it from the distractors. Naming *several*
   options is exempt: "is it the inflated one or the empty one?" compares, it
   does not reveal — only singling the correct one out does.

Deliberate limitation: an answer of one or two characters (yes/no, a single
letter) is not token-guarded, because "לא" appears in ordinary Hebrew sentences
and flagging it would gut every reply. Those rest on the prompt rule and on
detector 1. Guarding is skipped entirely when the question data is unknown, so a
sparse-events gap can never silence the coach.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Optional


# Diacritics that must not defeat a match: Hebrew niqqud/cantillation, Arabic
# harakat, and the Arabic tatweel elongation character.
_DIACRITICS = re.compile(r"[֑-ׇً-ْٰـ]")
_NON_WORD = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")

# "The answer is …" — an assertion no guiding turn needs to make. Kept narrow on
# purpose: "your answer is correct" and "what is the answer?" must NOT match.
_ANSWER_ASSERTION = re.compile(
    r"(?:"
    r"התשובה\s+(?:היא|הנכונה)"          # he: "the answer is" / "the correct answer"
    r"|התשובה\s+הנכונה\s+היא"
    r"|הפתרון\s+הוא"                     # he: "the solution is"
    r"|الإجابة\s+(?:هي|الصحيحة)"         # ar: "the answer is" / "the correct answer"
    r"|الجواب\s+هو"
    r"|الحل\s+هو"                        # ar: "the solution is"
    r"|the\s+(?:correct\s+)?answer\s+is"
    r"|the\s+solution\s+is"
    r")",
    re.IGNORECASE | re.UNICODE,
)

# Words too common to distinguish an option from its distractors. Kept small:
# the distractor subtraction below already removes most shared vocabulary, and an
# over-long list would blunt real detections.
_STOPWORDS = {
    # Hebrew
    "של", "את", "זה", "זו", "הוא", "היא", "הם", "יש", "אין", "יותר", "פחות",
    "כי", "עם", "על", "כל", "גם", "אבל", "אז", "כמו", "לכן", "אשר", "מה",
    # Arabic
    "من", "في", "على", "هو", "هي", "هذا", "هذه", "التي", "الذي", "أكثر", "أقل",
    "مع", "كل", "لأن", "لكن", "ما",
    # English
    "the", "a", "an", "is", "are", "was", "were", "of", "in", "on", "to", "and",
    "or", "it", "this", "that", "more", "less", "than", "with", "for", "be",
    "because", "but", "so", "as", "at", "by",
}

# A token shorter than this cannot single out an option on its own — see the
# module docstring on why "לא" must never be a trigger. Digits are exempt: a
# numeric answer ("12") is a reveal at any length.
_MIN_TOKEN_LEN = 3

# Hebrew and Arabic glue their particles onto the word, so plain token equality
# misses the reveal: the option says "חנקן" and the coach writes "בחנקן". Strip
# up to two leading particles, never below the minimum stem length — so "מסה"
# stays "מסה" rather than collapsing to a two-letter stub that matches anything.
_HE_PREFIXES = ("ו", "ה", "ב", "כ", "ל", "מ", "ש")
_AR_PREFIXES = ("ال", "و", "ب", "ل", "ك", "ف")


def _canon(token: str) -> str:
    """Token reduced to a comparable stem (leading particles removed)."""
    stem = token
    for _ in range(2):
        for prefix in _AR_PREFIXES + _HE_PREFIXES:
            if stem.startswith(prefix) and len(stem) - len(prefix) >= _MIN_TOKEN_LEN:
                stem = stem[len(prefix):]
                break
        else:
            break
    return stem

REDIRECT = {
    "he": (
        "את התשובה עצמה אני לא אתן — היא שווה הרבה יותר כשמגיעים אליה לבד. "
        "אבל אפשר להגיע לשם יחד: מה הדבר הראשון שכדאי לבדוק בשאלה הזאת?"
    ),
    "ar": (
        "لن أعطي الإجابة نفسها — قيمتها أكبر بكثير عند الوصول إليها بالتفكير. "
        "لكن يمكننا الوصول معًا: ما أول شيء يستحق التحقّق منه في هذا السؤال؟"
    ),
    "en": (
        "I won't hand over the answer itself — it's worth far more when you get "
        "there yourself. But we can get there together: what's the first thing "
        "worth checking in this question?"
    ),
}


def normalize(text: str) -> str:
    """Casefold, strip diacritics and punctuation, collapse whitespace."""
    folded = unicodedata.normalize("NFKC", text or "").casefold()
    folded = _DIACRITICS.sub("", folded)
    folded = _NON_WORD.sub(" ", folded)
    return _WHITESPACE.sub(" ", folded).strip()


def _tokens(text: str) -> list[str]:
    return [t for t in normalize(text).split(" ") if t]


def _usable(token: str) -> bool:
    if token in _STOPWORDS:
        return False
    return token.isdigit() or len(token) >= _MIN_TOKEN_LEN


def _stems(text: str) -> set[str]:
    """Comparable stems of the meaningful tokens in `text`."""
    return {_canon(t) for t in _tokens(text) if _usable(t)}


class AnswerGuard:
    """Decides whether a produced sentence hands over the current answer."""

    def __init__(self, correct: list[str], options: list[str]) -> None:
        self._phrases: list[str] = []
        self._distinctive: list[set[str]] = []
        # Tokens that identify a WRONG option. A sentence carrying one of these
        # is comparing options, not revealing the answer.
        self._distractor_marks: set[str] = set()

        correct_norms = {normalize(c) for c in correct if normalize(c)}
        distractors = [o for o in options if normalize(o) not in correct_norms]

        distractor_tokens: set[str] = set()
        for option in distractors:
            distractor_tokens.update(_stems(option))
        correct_tokens: set[str] = set()
        for answer in correct:
            correct_tokens.update(_stems(answer))
        self._distractor_marks = distractor_tokens - correct_tokens

        for answer in correct:
            phrase = normalize(answer)
            if len(phrase) >= _MIN_TOKEN_LEN:
                self._phrases.append(phrase)
            marks = _stems(answer) - distractor_tokens
            if marks:
                self._distinctive.append(marks)

    @property
    def active(self) -> bool:
        """True when the correct option is known, so naming it can be detected."""
        return bool(self._phrases or self._distinctive)

    def reveals(self, sentence: str) -> bool:
        text = normalize(sentence)
        if not text:
            return False
        # Runs even with no question data. Kata's events are sparse, so the
        # current question is often unresolved — exactly when the model is most
        # likely to assert an answer it cannot possibly have grounded. "The
        # answer is …" is never a coaching move, whatever the answer turns out
        # to be, so this detector must not depend on knowing it.
        if _ANSWER_ASSERTION.search(sentence) or _ANSWER_ASSERTION.search(text):
            return True
        if not self.active:
            return False
        padded = f" {text} "
        present = _stems(text)
        # Weighing options against each other is legitimate coaching; singling
        # the correct one out is not.
        if self._distractor_marks & present:
            return False
        if any(f" {phrase} " in padded for phrase in self._phrases):
            return True
        return any(marks <= present for marks in self._distinctive)


def build(question: Optional[dict[str, Any]]) -> AnswerGuard:
    """Guard for the learner's current question.

    Always returns a guard: with the question known it blocks naming the correct
    option; without it, the answer-assertion detector still stands. Never returns
    None — a gap in Kata's event stream must not switch the protection off.
    """
    question = question or {}
    correct = [str(c) for c in (question.get("correct") or []) if str(c).strip()]
    options = [str(o) for o in (question.get("options") or []) if str(o).strip()]
    return AnswerGuard(correct, options)
