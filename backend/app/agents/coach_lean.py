"""Lean live nudges: the same coach, a smaller prompt, for a one-line reaction.

`coach.proactive` was 15.1% of all AI spend on dev (08-25 → 09-24) at ~4.1K
input tokens a call — the full learner context, eight turns of history and an
800-token output cap, to write "take another look at the table 🙂". A nudge is
a reaction to what just happened on THIS screen; most of that prompt is about
everything else.

``COACH_LEAN_NUDGES=on`` (default off until the eval signs it off) keeps:
- the system instructions **byte-identical** — they are the cached prefix the
  provider bills at a tenth of the price, shared with every full turn, and
  they carry every rule that makes Yuvi Yuvi (tone, safety, never the answer);
- the learner's interests, preferences and known strategies, and teacher
  guidance — a nudge stays personal;
- everything about the current screen, question and recent evidence;

and drops the rest of the context (profile essay, mastery narrative,
calendar, goals, older conversation memory), trims history to the last
``HISTORY_TURNS`` messages, and caps the output (``max_tokens``). The
delivery path — safety screen, sentence cap, answer guard, persistence — is
the same code as every other turn: only the messages change.
"""

from __future__ import annotations

import os
from typing import Optional

HISTORY_TURNS = 4
REACTION_MAX_TOKENS = 180
ARRIVAL_MAX_TOKENS = 260
DEFAULT_MAX_TOKENS = 800

REACTIONS = frozenset({"idle", "mistake", "misconception", "partial", "slow_progress",
                       "rapid_guessing", "wheel_spinning", "success"})
ARRIVALS = frozenset({"question_intro", "lesson_step_intro"})

#: Context lines a nudge does not need. Everything not listed stays — a new
#: context line is kept by default, never silently dropped.
_DROP = frozenset({
    "characteristics", "learning_style", "environment", "strengths", "challenges",
    "student_description", "mastery_stance", "weekly_movement", "learner_map",
    "personalization_gaps", "learner_clarifications", "goals", "visible_screen_areas",
    "open_learning_task", "current_pace", "query_intent",
    "portrait_characteristics", "portrait_strengths", "portrait_active_goal",
    "older_conversation_summary", "older_learner_stated_facts",
})
_DROP_PREFIXES = ("calendar_context_",)


def enabled_triggers() -> frozenset[str]:
    raw = os.environ.get("COACH_LEAN_NUDGE_TRIGGERS")
    if not raw:
        return REACTIONS | ARRIVALS
    return frozenset(t.strip() for t in raw.split(",") if t.strip())


def applies(trigger: Optional[str], *, lesson: bool, typed: bool, support: bool) -> bool:
    if typed or support or not lesson or not trigger:
        return False
    if (os.environ.get("COACH_LEAN_NUDGES") or "off").strip().lower() not in {"1", "on", "true", "yes"}:
        return False
    return trigger in enabled_triggers()


def max_tokens(trigger: Optional[str]) -> int:
    if trigger in ARRIVALS:
        return ARRIVAL_MAX_TOKENS
    if trigger in REACTIONS:
        return REACTION_MAX_TOKENS
    return DEFAULT_MAX_TOKENS


def compact_context(block: str) -> str:
    """The context block minus the lines a nudge does not need."""
    kept = []
    for line in block.split("\n"):
        key = line.split(":", 1)[0].strip()
        if key in _DROP or key.startswith(_DROP_PREFIXES):
            continue
        kept.append(line)
    return "\n".join(kept)


def trim_history(history: list[dict]) -> list[dict]:
    return list(history or [])[-HISTORY_TURNS:]
