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

#: name → js file(s) (the first is required, the rest are optional plugins injected after it),
#: skill doc, globals that reveal it in HTML, chips that imply it, modules it requires.
REGISTRY: dict[str, dict[str, object]] = {
    "world3d": {
        "js": ("yuvi_world3d.js", "yuvi_world3d_materials.js", "yuvi_world3d_props.js", "yuvi_world3d_atmo.js"),
        "skill": ("world3d.md", "world3d_materials.md", "world3d_props.md", "world3d_atmo.md"),
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
    "fps": {
        "js": "yuvi_fps.js", "skill": "fps.md", "requires": ("world3d",),
        "tokens": ("YuviFPS",),
        "chips": ("shooter", "fps"),
        "words": ("fps", "shooter", "ירי", "יריות", "יורים", "נשק", "כלי נשק", "גוף ראשון", "first person", "gun", "weapon", "إطلاق", "سلاح", "منظور الشخص الأول"),
    },
}
ORDER = tuple(REGISTRY)  # injection and prompt order, fixed for the cache
_NEEDS_RE = re.compile(r"^\s*NEEDS\s*[:：]\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE)


def known(name: str) -> bool:
    return name in REGISTRY


def js_files(name: str) -> tuple[str, ...]:
    js = REGISTRY[name]["js"]
    return tuple(js) if isinstance(js, (tuple, list)) else (str(js),)


def available(name: str) -> bool:
    """The module's main JS exists on disk (a module can be registered before it ships)."""
    return known(name) and (HARNESS_DIR / js_files(name)[0]).is_file()


def js_text(name: str) -> str:
    """The module's script: its main file plus every plugin file that exists, in order."""
    parts = []
    for i, fname in enumerate(js_files(name)):
        path = HARNESS_DIR / fname
        if i == 0 or path.is_file():
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def requires(name: str) -> tuple[str, ...]:
    return tuple(REGISTRY[name].get("requires", ()))  # type: ignore[arg-type]


def skill_text(name: str) -> str:
    """The module's skill doc: one file, or a main doc plus the fragments that exist."""
    skill = REGISTRY[name]["skill"]
    names = tuple(skill) if isinstance(skill, (tuple, list)) else (str(skill),)
    parts = []
    for fname in names:
        path = SKILLS_DIR / fname
        if path.is_file():
            parts.append(path.read_text(encoding="utf-8").strip())
    return "\n\n".join(p for p in parts if p)


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
    for n in list(names):  # a module pulls in what it requires (fps → world3d)
        if n in REGISTRY:
            names.update(requires(n))
    return [n for n in ORDER if n in names and available(n)]


def _order(names: Iterable[str]) -> list[str]:
    wanted = {n for n in names if n in REGISTRY}
    return [n for n in ORDER if n in wanted]
