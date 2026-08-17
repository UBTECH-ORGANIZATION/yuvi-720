"""Split mixed-language prose into runs, one per language.

Yuvi's replies routinely carry both languages in one breath — a Hebrew
explanation wrapped around the English sentence being taught. A single neural
voice can only be native to one of them, so the text is cut into runs here and
each run is spoken by its own voice.

The cut is made on script, not on a language model. Hebrew, Arabic and Latin
occupy disjoint Unicode blocks, so which language a character belongs to is a
fact rather than a guess.
"""

from __future__ import annotations

# A run needs at least this many letters of its own script to earn a voice
# change. Without it a lone "OK" inside a Hebrew sentence would swap voices
# mid-clause, which sounds like a fault rather than a feature.
MIN_RUN_LETTERS = 3

_BLOCKS = (
    ("he", 0x0590, 0x05FF),
    ("ar", 0x0600, 0x06FF),
    ("ar", 0x0750, 0x077F),
)


def _script_of(char: str) -> str | None:
    """The language a character belongs to, or None if it is script-neutral."""
    code = ord(char)
    for language, start, end in _BLOCKS:
        if start <= code <= end:
            return language
    if ("a" <= char <= "z") or ("A" <= char <= "Z"):
        return "en"
    return None


def _letters(text: str) -> int:
    return sum(1 for char in text if _script_of(char) is not None)


def split_by_script(text: str, default_language: str = "he") -> list[tuple[str, str]]:
    """Ordered `(language, text)` runs covering the whole string.

    Digits, punctuation and spaces have no script of their own, so they stay
    with the run they were written in and no character is ever dropped —
    concatenating the runs returns the original text.
    """
    if not text:
        return []

    runs: list[list] = []
    for char in text:
        language = _script_of(char)
        if language is None:
            if runs:
                runs[-1][1].append(char)
            else:
                runs.append([None, [char]])
            continue
        if runs and runs[-1][0] == language:
            runs[-1][1].append(char)
        elif runs and runs[-1][0] is None:
            runs[-1][0] = language
            runs[-1][1].append(char)
        else:
            runs.append([language, [char]])

    merged: list[list] = []
    for language, chars in runs:
        segment = "".join(chars)
        # Too short to be worth a voice change, so it rides with its neighbour.
        if merged and (language is None or _letters(segment) < MIN_RUN_LETTERS):
            merged[-1][1] += segment
            continue
        merged.append([language, segment])

    if not merged:
        return [(default_language, text)]
    if merged[0][0] is None:
        merged[0][0] = merged[1][0] if len(merged) > 1 else default_language

    collapsed: list[tuple[str, str]] = []
    for language, segment in merged:
        if collapsed and collapsed[-1][0] == language:
            collapsed[-1] = (language, collapsed[-1][1] + segment)
        else:
            collapsed.append((language, segment))
    return collapsed
