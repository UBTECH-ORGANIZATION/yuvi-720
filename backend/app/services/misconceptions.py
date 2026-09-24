"""The vendor's "common mistakes" catalog, parsed instead of truncated.

Kata's authored note (`informationToBot`) often ends in a numbered catalog —
"טעויות נפוצות – יעד 2" then "1. <title>", "תיאור: …", "דוגמה: …", items
separated by rule lines. The coach context cut the whole note at 900
characters, so the coach saw the first two or three of ten-plus mistakes and
never the one the learner was actually making.

With ``COACH_MISCONCEPTION_CATALOG=on`` the note is split: the prose keeps
its 900 characters, and the catalog becomes one compact line — every
mistake by title, plus the full description of the one that matches the
learner's latest misconception evidence. Deterministic (no model), cached per
note, parsed from the live note — nothing is committed. Off by default: it
changes the prompt, so the coach eval decides.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from typing import Any, Optional

_HEADER = re.compile(r"^\s*(?:טעויות\s+נפוצות|תפיסות\s+שגויות|קשיים\s+נפוצים|common\s+mistakes)\b.*$",
                     re.IGNORECASE | re.MULTILINE)
_ITEM = re.compile(r"^\s*(\d{1,2})[.)]\s+(.+?)\s*$")
_FIELD = re.compile(r"^\s*(תיאור|דוגמה|דוגמאות|לדוגמה|בפועל)\s*:\s*(.*)$")
_RULE = re.compile(r"^\s*[_\-–—=]{5,}\s*$")
LINE_CAP = 900


def enabled() -> bool:
    return (os.environ.get("COACH_MISCONCEPTION_CATALOG") or "off").strip().lower() in {
        "1", "on", "true", "yes"}


@lru_cache(maxsize=512)
def split_information(info: str) -> tuple[str, tuple[tuple[str, str], ...]]:
    """(the note without its catalog, ((title, description), …))."""
    text = str(info or "")
    header = _HEADER.search(text)
    if not header:
        return text, ()
    note = text[:header.start()].rstrip()
    items: list[list[str]] = []
    field = None
    for line in text[header.end():].splitlines():
        if _RULE.match(line) or not line.strip():
            continue
        item = _ITEM.match(line)
        if item:
            items.append([item.group(2).strip(), ""])
            field = None
            continue
        if not items:
            continue            # the catalog's own subtitle ("השלמת שיעורי קודקודים…")
        found = _FIELD.match(line)
        if found:
            field = found.group(1)
            if field == "תיאור" and found.group(2).strip():
                items[-1][1] = found.group(2).strip()
            continue
        if field == "תיאור" and not items[-1][1]:
            items[-1][1] = line.strip()
    return note, tuple((title, desc) for title, desc in items if title)


def _stems(text: str) -> set[str]:
    from app.agents.answer_guard import stems
    return stems(text)


def relevant(items: tuple[tuple[str, str], ...], evidence: str) -> Optional[int]:
    """The catalog item the learner's misconception evidence names, if any
    (best word-stem overlap, at least two shared stems)."""
    wanted = _stems(evidence)
    if not wanted:
        return None
    best, score = None, 1
    for index, (title, desc) in enumerate(items):
        overlap = len(wanted & _stems(f"{title} {desc}"))
        if overlap > score:
            best, score = index, overlap
    return best


def compact_line(items: tuple[tuple[str, str], ...], focus: Optional[int]) -> str:
    """"1) title; 2) title; … — now likely: title: description", capped."""
    if not items:
        return ""
    titles = "; ".join(f"{n}) {title}" for n, (title, _) in enumerate(items, start=1))
    line = titles
    if focus is not None and items[focus][1]:
        title, desc = items[focus]
        line = f"{titles} — likely now #{focus + 1}: {desc}"
    return line[:LINE_CAP]


def for_bundle(info: Optional[str], recent_events: list[dict[str, Any]]) -> tuple[str, str]:
    """(note for `informationToBot`, `common_mistakes` line or "")."""
    note, items = split_information(str(info or ""))
    if not items:
        return str(info or ""), ""
    evidence = " ".join(str(e.get("misconception") or "") for e in recent_events or []
                        if isinstance(e, dict))
    return note, compact_line(items, relevant(items, evidence))
