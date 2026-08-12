"""Harmful-language detection for the teacher↔learner message channel.

Pure functions, no I/O, no model call. `check_content(text)` returns a verdict
with a **category**, because the categories are not equivalent: profanity is
denied and logged, and a child writing about hurting themselves is denied
delivery *and* escalated to their teachers. A boolean cannot carry that.

Ported from `vibe-coding-kids/src/backend/content_filter.py` — its
normalization pipeline (niqqud stripping, leet decoding, separator removal,
repeat collapsing, word-boundary matching) is sound and evasion-tested, and it
is reproduced here. Two things are deliberately NOT ported:

**The category was vestigial there.** `check_content` returned a bare bool and
every caller treated every hit the same way. Self-harm is the one signal in this
product that must not be swallowed by a "please use kind words" toast, so the
category is real here and `moderation.py` routes on it.

**The word list was tuned for a comments feed, not for a maths lesson.** Its
single-word set includes `אפס` (zero), `שמן` (oil), `תחת` (under/beneath),
`חמור` (severe — and donkey), `מוות`, `תיזהר` ("be careful"), `שטויות`, and the
English `die`, `death`, `kill`, `dumb`, `lame`, `crap`, `hate`. On a channel
where a science teacher writes "היזהרו, השמן חם" and a maths teacher writes
"התשובה היא אפס", that list denies ordinary teaching several times a day, and a
filter that cries wolf is one the school turns off. So the bare words are gone
and the PHRASES that made them dangerous are kept: `kill you`, `go die`,
`want to die`, `לך תמות`, `אני אהרוג`. Intent lives in the phrase.

The residual risk is stated plainly: this is a keyword filter, and a keyword
filter misses novel phrasing. It is a floor, not a ceiling — the deny path also
carries an audit row so a human can review what got through and what did not.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

# ── categories, most urgent first ────────────────────────────────────────────
# Order is the resolution order in `check_content`: a message that is both a
# threat and profane is reported as the threat, because that is what a reviewer
# needs to see first.
SELF_HARM = "self_harm"
SEXUAL = "sexual"
HATE = "hate"
THREAT = "threat"
PROFANITY = "profanity"

CATEGORIES = (SELF_HARM, SEXUAL, HATE, THREAT, PROFANITY)


@dataclass(frozen=True)
class ContentVerdict:
    flagged: bool
    category: Optional[str] = None


# ── normalization ────────────────────────────────────────────────────────────

LEET_MAP = {
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
    "@": "a", "$": "s", "!": "i", "+": "t",
}

# Digits that look like Hebrew letters — the Hebrew half of the same trick.
HEBREW_LEET_MAP = {"1": "ו", "0": "ס"}

_NIQQUD = re.compile(r"[֑-ׇ]")
_SEPARATORS = re.compile(r"[_\-.*~|/\\]")
_REPEATS = re.compile(r"(.)\1{2,}")
_PUNCT = str.maketrans("", "", ".,!?;:'\"()[]{}…–-<>+=`~^&*#%")

# Hebrew is agglutinative at the front: ה/ו/ב/ל/מ/ש/כ/א/ת/י/נ attach to a word
# without a space, so `הזונה` must match `זונה`.
_HEBREW_PREFIXES = set("הובלמשכאתינ")

# ...but only down to a four-letter stem. Below that the prefix rule starts
# manufacturing hits out of ordinary words: `מזין` (nutritious), `הזין` and
# `תזין` (entered / will enter — "הזן את התשובה" is a sentence this product
# says to children) all reduce to a three-letter entry in the profanity set.
# The cost of the floor is a missed prefixed three-letter insult; the cost of
# removing it is denying a science lesson about food.
_MIN_STEM = 4


def _normalize(text: str) -> str:
    text = text.lower()
    text = unicodedata.normalize("NFD", text)
    text = _NIQQUD.sub("", text)
    text = unicodedata.normalize("NFC", text)
    # `@` and `$` survive: the leet pass decodes them.
    return _SEPARATORS.sub("", text)


def _decode(text: str, table: dict[str, str]) -> str:
    return "".join(table.get(char, char) for char in text)


def _collapse(text: str) -> str:
    return _REPEATS.sub(r"\1", text)


def _variants(text: str) -> set[str]:
    """Every reading of the message a filter has to consider at once.

    `s-h-i-t` and `sh1t` and `shiiiiit` are one message; they differ only in
    which evasion was used, so all of them are checked against the same lists.
    """
    normalized = _normalize(text)
    leet = _decode(normalized, LEET_MAP)
    return {
        normalized,
        _collapse(normalized),
        leet,
        _collapse(leet),
        _decode(normalized, HEBREW_LEET_MAP),
    }


# ── self-harm ────────────────────────────────────────────────────────────────
# The category that must never be silently swallowed. A learner writing any of
# these is denied delivery AND escalated to their teachers.

SELF_HARM_PATTERNS = [
    # Hebrew
    r"רוצ[הא]\s*למות",
    r"לא\s*רוצ[הא]\s*לחיות",
    r"לסיים\s*את\s*החיים",
    r"לשים\s*סוף\s*ל?חיי",
    r"לפגוע\s*בעצמ",
    r"לחתוך\s*את\s*עצמ",
    r"להתאבד",
    r"אתאבד",
    r"התאבדות",
    r"לא\s*יתגעגע",
    r"עדיף\s*ש?אמות",
    r"אין\s*לי\s*סיבה\s*לחיות",
    # English
    r"want\s*to\s*die",
    r"wanna\s*die",
    r"kill\s*my\s*self",
    r"killing\s*my\s*self",
    r"k\s*y\s*s\b",
    r"end\s*it\s*all",
    r"end\s*my\s*life",
    r"cut\s*my\s*self",
    r"cutting\s*my\s*self",
    r"hurt\s*my\s*self",
    r"life\s*isn.?t\s*worth",
    r"no\s*body\s*would\s*miss\s*me",
    r"no\s*one\s*would\s*miss\s*me",
    r"suicid",
    # Arabic
    r"انتحار",
    r"اريد\s*ان\s*اموت",
    r"أريد\s*أن\s*أموت",
]

# ── threats and wishes of harm ───────────────────────────────────────────────

THREAT_PATTERNS = [
    # Hebrew
    r"לך\s*תמות", r"לכי\s*תמותי",
    r"אני\s*א?הרוג", r"אהרוג\s*אותך",
    r"אשבור\s*לך", r"אשבור\s*את\s*הפנים",
    r"אדפוק\s*אותך", r"אתפוס\s*אותך",
    r"ימח\s*שמ",
    r"מקווה\s*שתמות",
    # English
    r"kill\s*you", r"i.?ll\s*kill", r"gonna\s*kill",
    r"go\s*die", r"drop\s*dead",
    r"hope\s*you\s*(die|choke|drown|burn)",
    r"hope\s*you\s*get\s*hit",
    r"beat\s*you\s*up",
    r"no\s*one\s*likes\s*you",
    r"nobody.{0,10}will\s*(ever\s*)?talk\s*to\s*you",
    r"make\s*sure\s*nobody.{0,20}talks\s*to\s*you",
]

# ── sexual content and solicitation ──────────────────────────────────────────

SEXUAL_PATTERNS = [
    # Hebrew
    r"תמונות\s*עירום",
    r"תשלח[יי]?\s*תמונ[הת]\s*בלי\s*בגדים",
    r"הגוף\s*שלך\s*בלי\s*בגדים",
    r"לגעת\s*ב.{0,10}מקומות\s*פרטי",
    r"תזדיין", r"תיזדיין", r"מזדיין",
    # English
    r"send\s*(me\s*)?n[ua]+[dk]+e?[ds]?\s*(pic|photo|image)",
    r"naked\s*(pic|photo|image)",
    r"touch\s*(your|my|her|his)\s*private",
    r"show\s*me\s*your\s*body",
    r"sext\s*(with|me)",
    r"underage\s*\w*\s*(naked|nude)",
]

SEXUAL_WORDS = {
    # Unambiguous in any context on a minors' platform.
    "זונה", "שרמוטה", "שרמוט", "כוסאמק", "כוסאימק", "כוסעמק",
    "porn", "pornhub", "nudes", "blowjob", "handjob",
    "pussy", "cunt", "whore", "slut", "dick", "cock",
    "pedo", "pedophile", "groomer",
    "عاهرة", "شرموطة",
}

# ── hate ─────────────────────────────────────────────────────────────────────

HATE_PATTERNS = [
    r"לא\s*שייכים\s*ל?כאן",
    r"מוות\s*ל(ערבים|יהודים|ערבי)",
    r"genetically\s*inferior",
    r"should\s*be\s*deported",
    r"belong\s*in\s*the\s*kitchen",
    r"are\s*terrorists",
    r"control\s*the\s*(world|bank|media)",
]

HATE_WORDS = {
    "nigger", "nigga", "kike", "spic", "chink", "gook", "wetback",
    "faggot", "fag", "tranny", "dyke",
    "nazi", "hitler",
    "מפגר", "מפגרת", "מפגרים",   # a disability slur, not an insult like the rest
    "קוקסינל",
    "היטלר", "נאצי",
}

# ── profanity and personal abuse ─────────────────────────────────────────────
# Everything here would be denied even between two adults. Words a lesson uses
# — `אפס`, `שמן`, `תחת`, `חמור`, `מוות`, `die`, `kill`, `hate`, `dumb`, `lame`
# — are deliberately absent; see the module docstring.

PROFANITY_WORDS = {
    # Hebrew
    "חרא", "חארה", "חארא", "אחרא",
    "זין", "בולבול",
    "מניאק", "מניאקית", "מנוול", "מנוולת",
    "ממזר", "ממזרת",
    "מטומטם", "מטומטמת",
    "אידיוט", "אידיוטית",
    "דביל", "דבילה", "דבילית",
    "טמבל", "טמבלית",
    "חלאה", "נבזה", "נבזית",
    "מסריח", "מסריחה", "מגעיל", "מגעילה",
    "ערס", "ערסית",
    "פאק", "פאקינג", "לוזר",
    # English
    "fuck", "fucking", "fucker", "motherfucker", "fuk", "fck", "fuc",
    # `f4ck` decodes to `fack`, not `fuck` — the leet table maps 4→a, which is
    # right for `4sshole` and useless here. Vowel-swap spellings are listed as
    # their own entries rather than by widening the table, which would start
    # rewriting arithmetic into words.
    "fack", "fick", "phuck",
    "shit", "shitty", "bullshit", "sht",
    "bitch", "btch", "bastard", "asshole", "arsehole", "dumbass", "jackass",
    "wanker", "twat", "douchebag",
    "stfu", "gtfo",
    "moron", "imbecile", "retard", "retarded",
    "scumbag",
    # Arabic
    "شرموط", "منيوك", "زبالة",
    # Russian
    "блять", "сука", "хуй", "пизда", "ебать", "нахуй", "мудак",
}

PROFANITY_PATTERNS = [
    # Hebrew multi-word — spaced spellings the single-word set cannot see.
    r"בן\s*זונה", r"בת\s*זונה",
    r"יא\s*(בן\s*זונה|מניאק|כלב|חמור|בהמה|ערס|חלאה|שפל)",
    r"חתיכת\s*(חרא|זבל|אשפה)",
    r"סתום\s*(את)?\s*ה?פה", r"סתמי\s*(את)?\s*ה?פה",
    r"פה\s*סרוח",
    # English — spaced-out spellings, which is the classic bypass.
    r"f\s*u\s*c\s*k", r"s\s*h\s*i\s*t",
    r"shut\s*up",
    r"you\s*suck",
    r"you.?re\s*(stupid|dumb|ugly|worthless|pathetic)",
    r"piece\s*of\s*sh",
    r"son\s*of\s*a\s*b\b",
    r"eat\s*sh",
]

# Compiled once. `re.UNICODE` is the default in py3; `re.IGNORECASE` is
# redundant after normalization but harmless and survives a future caller.
_COMPILED: list[tuple[str, list[re.Pattern[str]]]] = [
    (SELF_HARM, [re.compile(p) for p in SELF_HARM_PATTERNS]),
    (SEXUAL, [re.compile(p) for p in SEXUAL_PATTERNS]),
    (HATE, [re.compile(p) for p in HATE_PATTERNS]),
    (THREAT, [re.compile(p) for p in THREAT_PATTERNS]),
    (PROFANITY, [re.compile(p) for p in PROFANITY_PATTERNS]),
]

_WORD_SETS: list[tuple[str, set[str]]] = [
    (SEXUAL, SEXUAL_WORDS),
    (HATE, HATE_WORDS),
    (PROFANITY, PROFANITY_WORDS),
]


def _has_word(text: str, words: set[str]) -> bool:
    """Word-boundary matching, which is the whole difference between a usable
    filter and an unusable one: `ass` is in `class`, `die` is in `gradient`, and
    `כוס` is in `כוסות`. Substring matching is reserved for entries that already
    contain a space, where a false positive is vanishingly unlikely.
    """
    for entry in words:
        if " " in entry and entry in text:
            return True
    for raw in text.split():
        cleaned = raw.translate(_PUNCT)
        if not cleaned:
            continue
        if cleaned in words:
            return True
        if len(cleaned) > _MIN_STEM and cleaned[0] in _HEBREW_PREFIXES \
                and cleaned[1:] in words:
            return True
    return False


def check_content(text: str) -> ContentVerdict:
    """Judge one message. Categories resolve most-urgent-first."""
    if not text or not text.strip():
        return ContentVerdict(False, None)

    readings = _variants(text)

    for category, patterns in _COMPILED:
        for pattern in patterns:
            if any(pattern.search(reading) for reading in readings):
                return ContentVerdict(True, category)

    for category, words in _WORD_SETS:
        if any(_has_word(reading, words) for reading in readings):
            return ContentVerdict(True, category)

    return ContentVerdict(False, None)


def is_distress(category: Optional[str]) -> bool:
    """Whether this is a cry for help rather than an offence.

    The message is denied either way. This decides whether an adult is told."""
    return category == SELF_HARM
