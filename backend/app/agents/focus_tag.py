"""The coach's own say in the focus mark: one hidden tag at the start of a reply.

The resolver (coach_focus) decides a mark for every turn. When
``COACH_FOCUS_TAG_ENABLED`` is on, the lesson prompt also lists the screen's
objects under short aliases (``[q]``, ``[opts]``, ``[o1]``…) and lets the model
begin its reply with ``⟦o3⟧`` to point at something else — the resolver's pick
stands when it does not.

This module only PARSES: character by character, so the tag is recognized
however the stream happens to be chunked (``⟦``, ``o``, ``3⟧`` in three
chunks), and it is stripped BEFORE the safety screen, the sentence cap and the
answer guard ever see the text — the learner never sees a tag, and a tag never
counts as a sentence. Accepted brackets: ``⟦ ⟧``, ``[[ ]]``, ``【 】`` — only at
the very start (after whitespace/RTL marks). Anything else is left in the
text as written.

Outcomes (for measurement, never shown): ``ok`` a known alias; ``none`` the
model said ``⟦-⟧``/``⟦none⟧``; ``absent`` no tag; ``unknown`` a well-formed tag
naming no alias; ``malformed`` an opener never closed in time.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

_OPENERS = {"⟦": "⟧", "【": "】", "[[": "]]"}
#: Leading characters that may precede the tag.
_LEAD = re.compile(r"^[\s‎‏‪-‮⁦-⁩﻿]*")
_ALIAS = re.compile(r"^(o\d{1,2}|q|opts|none|-)$", re.IGNORECASE)
#: A tag is short; an opener with no closer within this many characters is not one.
_MAX_TAG = 12


@dataclass
class TagResult:
    outcome: str                  # ok | none | absent | unknown | malformed
    alias: Optional[str] = None


class FocusTagParser:
    """Feed stream chunks; get back the text with a leading tag removed.

    ``feed`` returns the text that may be delivered now; while a possible
    tag is still open it holds the characters back (at most ``_MAX_TAG``
    plus the lead). ``finish`` flushes whatever is held."""

    def __init__(self, aliases: set[str], names: Optional[dict[str, str]] = None) -> None:
        """``names``: other words the model may use for an object — its label
        or its kind ("השאלה", "table") → the alias. Measured 2026-09-24: 25 of
        111 tagged replies wrote ⟦השאלה⟧ or ⟦table⟧ instead of ⟦q⟧/⟦o2⟧."""
        self.aliases = {a.lower() for a in aliases}
        self.names = {k.strip().lower(): v.lower() for k, v in (names or {}).items() if k.strip()}
        self._buffer = ""
        self._decided = False
        # After a stripped tag, the space that separated it from the reply
        # may arrive in the NEXT chunk; it goes too.
        self._trim_next = False
        self.result = TagResult("absent")

    @property
    def decided(self) -> bool:
        return self._decided

    def _decide(self, outcome: str, alias: Optional[str] = None) -> None:
        self._decided = True
        self.result = TagResult(outcome, alias)

    def feed(self, chunk: str) -> str:
        if self._decided:
            if self._trim_next and chunk:
                chunk = chunk.lstrip(" ")
                self._trim_next = not chunk
            return chunk
        self._buffer += chunk
        lead = _LEAD.match(self._buffer).group(0)
        body = self._buffer[len(lead):]
        if not body:
            return ""                         # only whitespace so far: wait
        opener = next((o for o in _OPENERS if body.startswith(o)), None)
        if opener is None:
            if any(o.startswith(body) for o in _OPENERS):
                return ""                     # "[" may become "[[": wait
            self._decide("absent")
            out, self._buffer = self._buffer, ""
            return out
        closer = _OPENERS[opener]
        end = body.find(closer, len(opener))
        if end < 0:
            if len(body) - len(opener) > _MAX_TAG:
                self._decide("malformed")
                self._buffer = ""
                if opener == "[[":
                    return lead + body        # ordinary brackets: leave as written
                # ⟦/【 never occur in prose: an unclosed one is a broken tag
                # ("⟦التص|> …", 09-24 eval) — drop it and the token stuck to it.
                return _BROKEN_TAG.sub("", body, count=1)
            return ""                         # still inside the tag: wait
        inner = body[len(opener):end].strip()
        rest = body[end + len(closer):]
        self._buffer = ""
        # ⟦ ⟧ and 【 】 never occur in a child's Hebrew reply: whatever short
        # token they hold at the start is a tag attempt and never shown.
        # "[[ ]]" can be ordinary text, so it counts only with an alias inside.
        if opener == "[[" and not _ALIAS.match(inner):
            self._decide("unknown")
            return lead + body                # not our tag — leave it as written
        name = inner.lower()
        if name in ("none", "-"):
            self._decide("none")
        elif name in self.aliases:
            self._decide("ok", name)
        elif name in self.names:
            self._decide("ok", self.names[name])
        else:
            self._decide("unknown", name[:_MAX_TAG])
        rest = rest.lstrip(" ")
        self._trim_next = not rest
        return rest

    def finish(self) -> str:
        """The held text when the stream ended inside a possible tag."""
        if self._decided:
            return ""
        self._decide("malformed" if self._buffer.strip() else "absent")
        out, self._buffer = self._buffer, ""
        return out


_BROKEN_TAG = re.compile(r"^(?:⟦|【)[^\s⟧】]{0,24}[\s⟧】]*")
_ANYWHERE = re.compile(
    r"⟦[^⟧\n]{0,24}⟧|【[^】\n]{0,24}】|\[\[\s*(?:o\d{1,2}|q|opts|none|-)\s*\]\]", re.IGNORECASE)


def strip_stray(text: str) -> str:
    """Backup for a tag the model put mid-reply (``misplaced``): removed from
    the delivered text so a learner never reads it. The frontend's markdown
    renderer strips the same pattern once more."""
    return _ANYWHERE.sub("", text)


#: The one prompt line the tag adds (lesson mode, flag on). The reply rules
#: above it are untouched — the tag is a tool, not a new voice.
RULE = {
    "he": (
        "סימון על המסך: פתח/י כל תשובה בתג אחד בדיוק, בלי רווח לפניו — ⟦שם⟧ מתוך "
        "current_screen_objects. השאר/י את ההצעה (current_focus_suggestion) אם התשובה עוסקת בה; "
        "בחר/י אובייקט אחר מהרשימה אם התשובה עוסקת בו; ⟦-⟧ אם התשובה לא עוסקת בשום דבר על המסך. "
        "התג מוסתר מהתלמיד/ה — אל תזכיר/י אותו ואל תכתוב/י תג בשום מקום אחר."
    ),
    "ar": (
        "تحديد على الشاشة: ابدأ/ي كل ردّ بوسم واحد فقط دون مسافة قبله — ⟦الاسم⟧ من "
        "current_screen_objects. أبقِ/أبقي الاقتراح (current_focus_suggestion) إذا كان الرد عنه؛ "
        "اختر/اختاري عنصرًا آخر من القائمة إذا كان الرد عنه؛ ⟦-⟧ إذا لم يكن الرد عن شيء على الشاشة. "
        "الوسم مخفي عن الطالب/ة — لا تذكره ولا تكتب وسمًا في أي مكان آخر."
    ),
    "en": (
        "Screen mark: begin every reply with exactly one tag, no space before it — ⟦name⟧ from "
        "current_screen_objects. Keep the suggestion (current_focus_suggestion) when the reply is "
        "about it; pick another listed object when the reply is about that; ⟦-⟧ when the reply is "
        "about nothing on the screen. The tag is hidden from the learner — never mention it and "
        "never write a tag anywhere else."
    ),
}
