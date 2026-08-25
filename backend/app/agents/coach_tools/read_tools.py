"""Read-only learner data tools shared by both Yuvi Coach modes."""

from __future__ import annotations

from typing import Any

from app.agents.coach_modes import CoachMode
from app.agents.coach_tools.registry import CoachTool, CoachToolContext, register


_BOTH_MODES = frozenset({CoachMode.LESSON, CoachMode.GENERAL})
_GENERAL_ONLY = frozenset({CoachMode.GENERAL})


def _available(data: Any, reason: str) -> dict[str, Any]:
    return {"data": data, "status": "available" if data else "not_applicable", "reason": reason}


async def _get_active_goals(context: CoachToolContext, _args: dict[str, Any]) -> dict[str, Any]:
    """Return the learner-visible goals already scoped by the Context Engine."""
    return _available(context.bundle.get("goals") or [], "learner_visible_goals")


async def _get_profile_summary(context: CoachToolContext, _args: dict[str, Any]) -> dict[str, Any]:
    """Return a small non-identifying projection, never raw profile fields."""
    bundle = context.bundle
    profile = bundle.get("profile") or {}
    return _available({
        "interests": profile.get("interests") or [],
        "learning_style": profile.get("learning_style") or "",
        "preferences": profile.get("preferences") or [],
        "strengths": bundle.get("strengths") or [],
        "challenges": bundle.get("challenges") or [],
        "strategies": bundle.get("strategies") or [],
    }, "coach_profile_projection")


async def _get_learning_status(context: CoachToolContext, _args: dict[str, Any]) -> dict[str, Any]:
    """Return only learner-safe current learning state for the active mode."""
    current = context.bundle.get("current") or {}
    return _available({
        "on_lesson_screen": bool(current.get("on_lesson_screen")),
        "objective_title": current.get("objective_title") or "",
        "task_status": current.get("task_status") or "no_open_task",
        "pace": current.get("pace") or "",
    }, "learner_learning_status")


async def _get_reflection_summary(context: CoachToolContext, _args: dict[str, Any]) -> dict[str, Any]:
    """Return completion metadata only; reflection answers stay private."""
    summary = context.bundle.get("reflection_summary") or {}
    return _available({
        "has_recent_reflection": bool(summary.get("has_recent_reflection")),
        "recent_count": int(summary.get("recent_count") or 0),
        "most_recent_prompt_id": summary.get("most_recent_prompt_id") or "",
        "most_recent_at": summary.get("most_recent_at") or "",
    } if summary.get("has_recent_reflection") else {}, "reflection_completion_summary")


register(CoachTool(
    name="get_active_goals",
    description="Get the learner-visible goals currently stored for this learner.",
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_active_goals,
    allowed_modes=_GENERAL_ONLY,
))

register(CoachTool(
    name="get_profile_summary",
    description="Get a non-identifying summary of the learner's learning preferences and strengths.",
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_profile_summary,
    allowed_modes=_BOTH_MODES,
))

register(CoachTool(
    name="get_learning_status",
    description="Get the learner-safe current learning status without scores or answer data.",
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_learning_status,
    allowed_modes=_BOTH_MODES,
))

register(CoachTool(
    name="get_reflection_summary",
    description="Get whether the learner recently completed a reflection, without reflection answers or ratings.",
    parameters={"type": "object", "properties": {}, "required": []},
    handler=_get_reflection_summary,
    allowed_modes=_BOTH_MODES,
))

# Calendar context is loaded deterministically by the Coach before it responds.