"""Deterministic curriculum planner (§5.6) — decides WHAT to learn next.

Planner v2 (B-2): the doc's own ranking, now real —
  1. `review_due` first: an achieved skill whose spaced-review window lapsed
     (or that failed after mastery) resurfaces BEFORE new material, so learning
     compounds instead of decaying silently.
  2. curriculum `order` for new frontier objectives (prerequisites met).
  3. `interest_fit` as a tie-break within the same order rank.
The LLM never sequences the syllabus; every pick is explainable from the spine +
the learner's real mastery evidence.
"""

from __future__ import annotations

from typing import Any

from app.brain.curriculum import objectives_for

DEFAULT_SUBJECTS = ("math", "science")


def _mastered(objective_id: str, mastery: dict[str, Any]) -> bool:
    from app.brain.mastery import entry_for
    return bool(entry_for(mastery, objective_id).get("achieved"))


def _prerequisites_met(objective: dict[str, Any], mastery: dict[str, Any]) -> bool:
    return all(_mastered(pid, mastery) for pid in objective.get("prerequisites", []))


def _interest_terms(brain: dict[str, Any]) -> list[str]:
    """Lowercased learner-interest phrases (profile + memory themes)."""
    terms: list[str] = []
    for value in (brain.get("profile") or {}).get("interests") or []:
        raw = value.get("label") or value.get("text") if isinstance(value, dict) else value
        if raw:
            terms.append(str(raw).casefold())
    for theme in ((brain.get("memory") or {}).get("themes") or []):
        if isinstance(theme, dict) and theme.get("kind") == "interest" \
                and theme.get("status") not in {"forgotten", "contradicted", "expired"}:
            terms.append(str(theme.get("value") or "").casefold())
    return [t for t in terms if len(t) >= 2]


def _interest_fit(objective: dict[str, Any], terms: list[str]) -> int:
    """1 when an interest phrase appears in the objective title/topic — a
    tie-break only, never enough to jump the curriculum order."""
    haystack = f"{objective.get('title') or ''} {objective.get('topic') or ''}".casefold()
    return 1 if any(term in haystack for term in terms) else 0


def plan_next(brain: dict[str, Any], subjects: tuple[str, ...] = DEFAULT_SUBJECTS) -> dict[str, Any]:
    """Return, per subject: review-due skills, next objectives, and counts."""
    from app.brain.mastery import entry_for, is_due_for_review

    mastery = brain.get("mastery") or {}
    terms = _interest_terms(brain)
    plan: dict[str, Any] = {}
    for subject in subjects:
        objectives = objectives_for(subject)
        review_due = [
            o for o in objectives
            if _mastered(o["id"], mastery) and is_due_for_review(entry_for(mastery, o["id"]))
        ]
        review_due.sort(key=lambda o: o["order"])
        frontier = [
            o for o in objectives
            if _prerequisites_met(o, mastery) and not _mastered(o["id"], mastery)
        ]
        # order is primary; interest_fit breaks ties within the same rank.
        frontier.sort(key=lambda o: (o["order"], -_interest_fit(o, terms)))
        ranked = review_due + frontier
        plan[subject] = {
            "next": [o["id"] for o in ranked[:3]],
            "next_titles": [o["title"] for o in ranked[:3]],
            "review_due": [o["id"] for o in review_due[:3]],
            "mastered": sum(1 for o in objectives if _mastered(o["id"], mastery)),
            "total": len(objectives),
        }
    return plan
