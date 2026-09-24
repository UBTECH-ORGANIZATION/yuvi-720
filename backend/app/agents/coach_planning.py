"""When a lesson turn may spend a planning call, and on which tools.

Before a lesson reply the coach made a non-streamed planning call that
re-sent the whole prompt so the model could pick a tool. On dev (08-25 →
09-24) that was 13.8% of all AI spend and ~97% of the calls picked nothing:
the mark moved to the deterministic resolver (coach_focus), the read tools
duplicate what the bundle already holds, and lesson visuals only fire on an
explicit ask. What is left worth a model's judgement in a lesson is one
thing — whether a teacher should be invited — and that needs evidence the
conversation shows. So:

``COACH_LESSON_PLANNING``
- ``full``: the old behavior (every tool the mode allows, minus
  ``point_at_screen`` while focus marks are on);
- ``gated`` (default): plan only when ``teacher_help_cue`` fires, and then
  with ``suggest_teacher_help`` alone;
- ``off``: never plan in a lesson.

General (companion) chat is untouched: its navigation offers need the model.
"""

from __future__ import annotations

import os
import re
from typing import Any, Optional

_ASKED_FOR_TEACHER = re.compile(
    # A whole Hebrew word (optionally with a one-letter prefix): a bare
    # substring also hit "אמורה" ("supposed to"), which learners say a lot.
    r"(?<![א-ת])[הלשבו]?מור(ה|ת|ים|ות)(?![א-ת])|לקרוא למבוגר|معلم|معلّم|المعلمة|الأستاذ|أستاذ|\bteacher\b",
    re.IGNORECASE)
_FRUSTRATED = re.compile(
    r"קשה לי|לא מצליח|לא מצליחה|נמאס|מעצבן|אני מוותר|אני מוותרת|שונא את|בא לי לבכות|"
    r"לא מבין כלום|לא מבינה כלום|محبط|صعب|زهقت|ما بفهم|مش فاهم|"
    r"\b(frustrated|give up|too hard|hate this|i can'?t do (this|it))\b",
    re.IGNORECASE)
_STILL_LOST = re.compile(
    r"עדיין לא|עוד לא הבנתי|לא הבנתי|לא מבין|לא מבינה|לא עזר|ما زلت|لم أفهم|ما فهمت|"
    r"\b(still (don'?t|do not)|didn'?t help|don'?t understand|do not understand)\b",
    re.IGNORECASE)


def lesson_planning_mode() -> str:
    value = (os.environ.get("COACH_LESSON_PLANNING") or "gated").strip().lower()
    return value if value in {"full", "gated", "off"} else "gated"


def teacher_help_cue(
    message: Optional[str], history: list[dict[str, Any]], query_intent: Optional[str],
) -> bool:
    """Evidence in THIS turn that a person may need to join: asked for the
    teacher, frustration, or still lost after Yuvi already helped. A plain
    question, a first hint or a single mistake is never a cue."""
    text = message or ""
    if not text.strip():
        return False
    if _ASKED_FOR_TEACHER.search(text) or _FRUSTRATED.search(text):
        return True
    if query_intent == "encouragement":
        return True
    helped = sum(1 for turn in history or []
                 if isinstance(turn, dict) and turn.get("role") == "assistant"
                 and str(turn.get("content") or "").strip())
    return helped >= 2 and bool(_STILL_LOST.search(text))


def lesson_tools(*, cue: bool, focus_marks_on: bool) -> Optional[frozenset[str]]:
    """The tool names a lesson turn may plan with; None = do not plan.
    An empty frozenset never comes back — "plan with nothing" is "don't"."""
    planning = lesson_planning_mode()
    if planning == "off":
        return None
    if planning == "gated":
        return frozenset({"suggest_teacher_help"}) if cue else None
    excluded = {"point_at_screen"} if focus_marks_on else set()
    from app.agents.coach_modes import CoachMode
    from app.agents.coach_tools import registry

    names = frozenset(name for name in registry.names(CoachMode.LESSON)
                      if name not in excluded)
    return names or None
