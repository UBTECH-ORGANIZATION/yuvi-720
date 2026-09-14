"""Opt-in runtime modules: what a game needs beyond the core kit.

A game gets the core kit always (``yuvi_kit.js``). The modules here are
injected only when the game needs them — the plan pass names them in a
``NEEDS:`` line, the brief's inspiration chips infer them, and the served
HTML is sniffed for their globals so an old game or an edit never loses one.
Each module ships with a skill doc (``skills/<name>.md``) the builder reads
only when that module is in play — progressive disclosure keeps the prompt
prefix stable and the cache warm.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

HARNESS_DIR = Path(__file__).parent / "harness"
SKILLS_DIR = Path(__file__).parent / "skills"

#: name → js file, skill doc, globals that reveal it in HTML, chips that imply it.
REGISTRY: dict[str, dict[str, object]] = {
    "world3d": {
        "js": "yuvi_world3d.js", "skill": "world3d.md",
        "tokens": ("YuviWorld3D",),
        "chips": ("3d", "shooter", "fps", "adventure", "race", "explore"),
        "words": ("3d", "תלת", "ثلاثي", "fps", "גוף ראשון", "first person", "third person", "מעוף", "world"),
    },
    "ui": {
        "js": "yuvi_ui.js", "skill": "ui.md",
        "tokens": ("YuviUI",),
        "chips": ("puzzle", "quiz", "story"),
        "words": ("שאלה", "שאלות", "question", "سؤال", "תרגיל", "dialogue", "דיאלוג", "timer", "טיימר"),
    },
    "arcade2d": {
        "js": "yuvi_arcade2d.js", "skill": "arcade2d.md",
        "tokens": ("YuviArcade",),
        "chips": ("platformer", "arcade", "runner", "topdown"),
        "words": ("פלטפורמה", "platformer", "arcade", "מסלול 2d", "2d"),
    },
}
ORDER = tuple(REGISTRY)  # injection and prompt order, fixed for the cache
_NEEDS_RE = re.compile(r"^\s*NEEDS\s*[:：]\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)


def known(name: str) -> bool:
    return name in REGISTRY


def available(name: str) -> bool:
    """The module's JS exists on disk (a module can be registered before it ships)."""
    return known(name) and (HARNESS_DIR / str(REGISTRY[name]["js"])).is_file()


def js_text(name: str) -> str:
    return (HARNESS_DIR / str(REGISTRY[name]["js"])).read_text(encoding="utf-8")


def skill_text(name: str) -> str:
    path = SKILLS_DIR / str(REGISTRY[name]["skill"])
    return path.read_text(encoding="utf-8").strip() if path.is_file() else ""


def parse_needs(text: str) -> list[str]:
    """The ``NEEDS: world3d, ui`` line of a pitch → known module names."""
    m = _NEEDS_RE.search(text or "")
    if not m:
        return []
    raw = re.split(r"[,\s/;]+", m.group(1).lower())
    return _order(n.strip("`'\".") for n in raw if n)


def sniff(html: str) -> list[str]:
    """Modules a game already uses, by the globals it references."""
    if not html:
        return []
    return _order(name for name, meta in REGISTRY.items() if any(tok in html for tok in meta["tokens"]))  # type: ignore[union-attr]


def infer(inspirations: Iterable[str] | None = None, vibe: str = "") -> list[str]:
    """A fallback when the pitch names nothing: chips and words in the brief."""
    chips = {str(c).lower() for c in (inspirations or [])}
    text = (vibe or "").lower()
    found = []
    for name, meta in REGISTRY.items():
        if chips & set(meta["chips"]) or any(w in text for w in meta["words"]):  # type: ignore[arg-type]
            found.append(name)
    return _order(found)


def resolve(*sources: Iterable[str] | None, html: str = "") -> list[str]:
    """Union of every source plus what the HTML reveals, known and available only, in ORDER."""
    names: set[str] = set()
    for src in sources:
        names.update(str(n).lower() for n in (src or []))
    names.update(sniff(html))
    return [n for n in ORDER if n in names and available(n)]


def _order(names: Iterable[str]) -> list[str]:
    wanted = {n for n in names if n in REGISTRY}
    return [n for n in ORDER if n in wanted]
