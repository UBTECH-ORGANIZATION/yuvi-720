"""What Yuvi is doing right now, in the kid's language.

The model's reasoning stream is English and technical ("replace buildWorld,
add a CanvasTexture helper…"); the kid waiting on the build page should read
"יובי מצייר את המפעל בלילה עם גשם וערפל" instead. A mini model turns each new
stretch of thinking into ONE short sentence, cached per game so every open tab
and every poll shares the same lines and the model is called once per stretch.

Called from ``GET /api/games/{id}/narration`` while the page shows the build.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from typing import Any, Optional

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

log = logging.getLogger(__name__)

#: A new sentence every time this much new reasoning has arrived.
STRETCH_CHARS = 700
#: How much of the fresh reasoning the narrator reads (the tail the worker keeps is 12k).
READ_CHARS = 2600
MAX_LINES = 40
_TTL_S = 3600

_LANG = {
    "he": "עברית", "ar": "العربية", "en": "English",
}

_SYSTEM = (
    "You narrate, for a child aged 11-14, what a game designer called Yuvi is doing right now. "
    "You get the designer's latest raw thinking (English, technical) and the previous sentence you wrote. "
    "Write exactly ONE short sentence in {language}, present tense, about what Yuvi is doing — write the name "
    "in that language's own script (Hebrew: יובי, Arabic: يوفي), never in Latin letters — "
    "about the GAME the child will play (its world, characters, levels, look, questions) — never about code, "
    "functions, files, libraries, patches or line numbers. No technical words at all. Max 14 words. "
    "Do not repeat the previous sentence; if nothing new happened, describe the next visible step. "
    "Reply with the sentence only."
)

# game_id -> {"chars": narrated up to, "lines": [...], "at": time, "lock": asyncio.Lock}
_cache: dict[str, dict[str, Any]] = {}


def _entry(game_id: str) -> dict[str, Any]:
    now = time.time()
    for key in [k for k, v in _cache.items() if now - v["at"] > _TTL_S]:
        _cache.pop(key, None)
    entry = _cache.get(game_id)
    if entry is None:
        entry = _cache[game_id] = {"chars": 0, "lines": [], "at": now, "lock": asyncio.Lock()}
    return entry


def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip().strip('"“”').strip()
    text = re.sub(r"`[^`]*`", "", text)
    return text[:160]


async def _sentence(fresh: str, previous: str, language: str, actor_id: str) -> str:
    reply = await call_llm(
        [
            {"role": "system", "content": _SYSTEM.format(language=_LANG.get(language, language))},
            {"role": "user", "content": f"PREVIOUS SENTENCE: {previous or '(none)'}\n\nLATEST THINKING:\n{fresh}"},
        ],
        usage_context=UsageContext(
            actor_id=actor_id, actor_type="learner", endpoint="internal:game_narration",
            feature="feature_7_learning_games", operation="game.narration", source="games.narration",
        ),
        max_tokens=80, model_tier="mini", timeout=20,
    )
    return _clean(reply or "")


async def narrate(game: dict[str, Any], live: Optional[dict[str, Any]], *, actor_id: str) -> dict[str, Any]:
    """The narration lines so far, extended when enough new thinking arrived.
    Cheap when nothing changed: no model call, the cached lines."""
    game_id = str(game.get("_id") or "")
    entry = _entry(game_id)
    entry["at"] = time.time()
    live = live or {}
    chars = int(live.get("thinking_chars") or 0)
    tail = str(live.get("thinking_tail") or "")
    phase = str(live.get("phase") or "")
    if phase == "thinking" and tail and chars - entry["chars"] >= STRETCH_CHARS and len(entry["lines"]) < MAX_LINES:
        async with entry["lock"]:
            if chars - entry["chars"] >= STRETCH_CHARS:  # another tab may have just done it
                fresh = tail[-min(READ_CHARS, max(chars - entry["chars"], STRETCH_CHARS)):]
                try:
                    line = await _sentence(fresh, entry["lines"][-1] if entry["lines"] else "",
                                           str(game.get("language") or "he"), actor_id)
                except Exception as exc:
                    log.warning("narration failed: %s", type(exc).__name__)
                    line = ""
                entry["chars"] = chars
                if line and (not entry["lines"] or line != entry["lines"][-1]):
                    entry["lines"].append(line)
    return {"lines": list(entry["lines"]), "chars": entry["chars"], "phase": phase}


def forget(game_id: str) -> None:
    _cache.pop(game_id, None)
