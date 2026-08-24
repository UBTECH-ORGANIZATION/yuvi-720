"""Server-owned navigation actions the learner Coach may offer.

The model selects a stable action id, never a URL or an endpoint. This keeps
navigation capability-aware and makes client rendering a simple validation step
rather than a trust boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.agents.coach_modes import CoachMode


@dataclass(frozen=True)
class CoachAction:
    action_id: str
    path: str
    label_key: str
    category: str
    allowed_modes: frozenset[CoachMode]


_BOTH_MODES = frozenset({CoachMode.LESSON, CoachMode.GENERAL})

_ACTIONS: dict[str, CoachAction] = {
    "open_dashboard": CoachAction(
        "open_dashboard", "/student-dashboard", "companion.action.dashboard", "navigation", _BOTH_MODES,
    ),
    "open_learning": CoachAction(
        "open_learning", "/learning", "companion.action.learning", "navigation", _BOTH_MODES,
    ),
    "open_tasks": CoachAction(
        "open_tasks", "/tasks", "companion.action.tasks", "navigation", _BOTH_MODES,
    ),
    "open_calendar": CoachAction(
        "open_calendar", "/student-dashboard/calendar", "companion.action.calendar", "navigation", _BOTH_MODES,
    ),
    "open_goals": CoachAction(
        "open_goals", "/mentoring", "companion.action.goals", "navigation", _BOTH_MODES,
    ),
    "open_profile": CoachAction(
        "open_profile", "/results", "companion.action.profile", "navigation", _BOTH_MODES,
    ),
    "open_badges": CoachAction(
        "open_badges", "/badges", "companion.action.badges", "navigation", _BOTH_MODES,
    ),
}


def action_ids(mode: CoachMode) -> list[str]:
    """Stable action ids eligible for the active Coach mode."""
    return [action_id for action_id, action in _ACTIONS.items() if mode in action.allowed_modes]


def offer(action_id: str, mode: CoachMode) -> dict[str, Any]:
    """Return a client-safe card, or an explicit not-applicable result."""
    action = _ACTIONS.get(action_id)
    if action is None or mode not in action.allowed_modes:
        return {"data": None, "status": "not_applicable", "reason": "action_not_available"}
    return {
        "data": {
            "action_id": action.action_id,
            "path": action.path,
            "label_key": action.label_key,
            "category": action.category,
        },
        "status": "available",
        "reason": "catalog_action",
    }