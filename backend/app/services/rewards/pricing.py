"""Yuvi prices each goal (F5 → F3).

The reward for a goal is not a flat rate: when a goal is agreed in a mentoring
conversation, Yuvi reads it and decides what the *learning effort* behind it is
worth in sparks. That keeps the currency meaningful — a real piece of work pays
more than a small step — without ever grading the learner.

Guardrails, because the model must not be able to mint currency:
- the model returns one number, the server clamps it into a fixed band and
  rounds it, so a hallucinated 100000 becomes the band maximum;
- every failure path (no gateway, bad JSON, nonsense value) falls back to a
  deterministic value, so goal creation never depends on the LLM;
- the split across progress stages is server-side and fixed.
"""

from __future__ import annotations

import json
from typing import Any

from app.services.ai_usage import UsageContext
from app.services.llm import call_llm

# The band a goal can be worth. Narrow enough that the difference between goals
# is felt, wide enough that a week-long goal is clearly worth more than a step.
GOAL_VALUE_MIN = 15
GOAL_VALUE_MAX = 80
GOAL_VALUE_DEFAULT = 30
_STEP = 5

# How one goal's value is paid out. Finishing is worth more than starting, so
# the pull is always towards completion.
STAGE_SHARE: dict[str, float] = {"started": 0.25, "progressed": 0.25, "summarized": 0.50}

_LANG_NAME = {"he": "Hebrew", "ar": "Arabic", "en": "English"}

_PRICE_SYSTEM = (
    "You are Yuvi, a learning companion for a school student (grades 7-9). You are pricing ONE "
    "learning goal in 'sparks', the effort currency of the app. Judge only how much learning work "
    "and new knowledge the goal really demands: how many sessions it needs, how new or demanding "
    "the material is, and how specific the goal is. A tiny one-off step is cheap; a goal that "
    "requires practising new material over a week is expensive. Never judge the student, their "
    "ability or their grades — only the goal itself. "
    f"Return ONLY JSON: {{{{\"value\": <integer between {GOAL_VALUE_MIN} and {GOAL_VALUE_MAX}>, "
    "\"why\": \"<one short warm sentence, addressed to the student, explaining what makes this goal "
    "worth that much>\"}}. Write \"why\" in {language}."
)

_WHY_FALLBACK = {
    "he": "היעד הזה שווה ניצוצות כי הוא דורש ממך תרגול והתמדה.",
    "ar": "هذا الهدف يستحق شرارات لأنه يتطلب منك تدريبًا ومثابرة.",
    "en": "This goal is worth sparks because it asks you for real practice and persistence.",
}


def clamp_goal_value(raw: Any) -> int:
    """Force any model output into the allowed band, rounded to a clean step."""
    try:
        value = int(round(float(raw)))
    except (TypeError, ValueError):
        return GOAL_VALUE_DEFAULT
    value = max(GOAL_VALUE_MIN, min(GOAL_VALUE_MAX, value))
    return int(round(value / _STEP) * _STEP)


def stage_amount(goal_value: Any, stage: str) -> int:
    """Sparks paid for reaching ``stage`` on a goal worth ``goal_value``."""
    share = STAGE_SHARE.get(stage)
    if not share:
        return 0
    value = clamp_goal_value(goal_value if goal_value else GOAL_VALUE_DEFAULT)
    return max(1, int(round(value * share)))


def _fallback(language: str) -> dict[str, Any]:
    return {
        "value": GOAL_VALUE_DEFAULT,
        "why": _WHY_FALLBACK.get(language, _WHY_FALLBACK["he"]),
        "ai": False,
    }


async def price_goal(
    learner_id: str,
    *,
    title: str,
    next_steps: str = "",
    deadline: str = "",
    language: str = "he",
) -> dict[str, Any]:
    """Ask Yuvi what one goal is worth. Returns ``{value, why, ai}``."""
    language = language if language in _LANG_NAME else "he"
    goal_text = " · ".join(part for part in (title.strip(), (next_steps or "").strip()) if part)
    if not goal_text:
        return _fallback(language)

    try:
        raw = await call_llm(
            [
                {"role": "system", "content": _PRICE_SYSTEM.format(language=_LANG_NAME[language])},
                {
                    "role": "user",
                    "content": f"Goal: {goal_text}" + (f"\nTarget date: {deadline}" if deadline else ""),
                },
            ],
            usage_context=UsageContext(
                actor_id=learner_id,
                actor_type="learner",
                endpoint="/api/mentoring",
                feature="feature_5_mentoring",
                operation="mentoring.goal_pricing",
                source="rewards_pricing",
            ),
            max_tokens=160,
            json_mode=True,
            model_tier="mini",
        )
        data = json.loads(raw or "{}") or {}
        why = str(data.get("why") or "").strip()
        if why:
            from app.agents.safety import screen_output
            why = screen_output(why, language).text or why
        if data.get("value") is not None:
            return {
                "value": clamp_goal_value(data.get("value")),
                "why": why or _WHY_FALLBACK.get(language, _WHY_FALLBACK["he"]),
                "ai": True,
            }
    except Exception as exc:  # never block goal creation on the model
        print(f"⚠️ goal pricing failed: {type(exc).__name__}")

    return _fallback(language)
