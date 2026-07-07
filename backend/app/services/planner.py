"""Deterministic curriculum planner (§5.6) — decides WHAT to learn next.

The LLM never sequences the syllabus. `plan_next` walks the ordered
`learning_objectives` spine and the learner's real `mastery` to pick the frontier
of unmastered objectives whose prerequisites are met. Interests only break ties.
Fully explainable: next = earliest unmastered objective with prerequisites done.
"""

from __future__ import annotations

from typing import Any

from app.brain.curriculum import objectives_for

DEFAULT_SUBJECTS = ("math", "science")


def _mastered(objective_id: str, mastery: dict[str, Any]) -> bool:
    entry = mastery.get(objective_id) or {}
    return bool(entry.get("achieved"))


def _prerequisites_met(objective: dict[str, Any], mastery: dict[str, Any]) -> bool:
    return all(_mastered(pid, mastery) for pid in objective.get("prerequisites", []))


def plan_next(brain: dict[str, Any], subjects: tuple[str, ...] = DEFAULT_SUBJECTS) -> dict[str, Any]:
    """Return, per subject: the next objectives, and mastered/total counts."""
    mastery = brain.get("mastery") or {}
    plan: dict[str, Any] = {}
    for subject in subjects:
        objectives = objectives_for(subject)
        frontier = [
            o for o in objectives
            if _prerequisites_met(o, mastery) and not _mastered(o["id"], mastery)
        ]
        # Curriculum order is the primary key; the spine is already ordered.
        frontier.sort(key=lambda o: o["order"])
        plan[subject] = {
            "next": [o["id"] for o in frontier[:3]],
            "next_titles": [o["title"] for o in frontier[:3]],
            "mastered": sum(1 for o in objectives if _mastered(o["id"], mastery)),
            "total": len(objectives),
        }
    return plan
