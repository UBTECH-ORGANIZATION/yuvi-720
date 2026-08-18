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

import copy
from typing import Any

from app.services.kata_catalog import objectives_for

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


def _subject_last_activity(subject: str, mastery: dict[str, Any]) -> str:
    """Most-recent evidence timestamp across a subject's objectives ('' if never).

    Lexicographic ISO comparison == chronological; '' sorts first, so a subject
    never practiced reads as the most overdue for attention.
    """
    from app.brain.mastery import entry_for
    stamps = [
        entry_for(mastery, o["id"]).get("last_evidence_at")
        for o in objectives_for(subject)
    ]
    stamps = [s for s in stamps if s]
    return max(stamps) if stamps else ""


def next_focus(brain: dict[str, Any], subjects: tuple[str, ...] = DEFAULT_SUBJECTS) -> dict[str, Any]:
    """Choose the focus objective ACROSS subjects (720 leaves this to the platform).

    Order of preference — deterministic + explainable:
      1. Global spaced review — any objective due for review, across all subjects,
         most-overdue first. (A science skill due today beats brand-new math.)
      2. New material — the subject that is **most behind** (lowest mastered/total),
         tie-broken by **least-recently practiced**, then fixed subject order for
         stability (so it can't ping-pong every session).
    Returns ``{subject, objective_id, mode, plan}`` with ``mode`` in
    ``review | new | complete``.
    """
    from app.brain.mastery import entry_for
    mastery = brain.get("mastery") or {}
    plan = plan_next(brain, subjects)

    # 1. Global review-due, most overdue first.
    review: list[tuple[str, str, str]] = []
    for subject in subjects:
        for oid in (plan.get(subject) or {}).get("review_due") or []:
            due = entry_for(mastery, oid).get("review_due") or ""
            review.append((str(due), subject, oid))
    if review:
        review.sort(key=lambda r: r[0])   # earliest due date = most overdue
        _due, subject, oid = review[0]
        return {"subject": subject, "objective_id": oid, "mode": "review", "plan": plan}

    # 2. New material — most behind, then least-recently practiced, then order.
    candidates = [s for s in subjects if (plan.get(s) or {}).get("next")]
    if not candidates:
        return {"subject": None, "objective_id": None, "mode": "complete", "plan": plan}

    def ratio(subject: str) -> float:
        info = plan.get(subject) or {}
        total = int(info.get("total") or 0)
        return (int(info.get("mastered") or 0) / total) if total else 0.0

    order_index = {s: i for i, s in enumerate(subjects)}
    chosen = min(
        candidates,
        key=lambda s: (ratio(s), _subject_last_activity(s, mastery), order_index[s]),
    )
    return {
        "subject": chosen,
        "objective_id": (plan[chosen]["next"][0]),
        "mode": "new",
        "plan": plan,
    }


def focus_roadmap(brain: dict[str, Any], steps: int = 6,
                  subjects: tuple[str, ...] = DEFAULT_SUBJECTS) -> list[dict[str, Any]]:
    """The planner's own prediction of the road ahead: run `next_focus`, mark
    its pick completed on a SIMULATED mastery table, and ask again — `steps`
    times. Because each step is the real ranking function over the simulated
    state, the roadmap can never disagree with what the planner would actually
    serve; it IS the planner, played forward.

    The simulation marks a step complete the way reality would read it: the
    objective achieved, its review satisfied, and its subject freshly
    practiced — which is what lets the ranking switch subjects mid-road
    exactly as it would live. The caller's brain is never touched.
    """
    from app.brain.mastery import mastery_key

    sim = {**brain, "mastery": copy.deepcopy(brain.get("mastery") or {})}
    road: list[dict[str, Any]] = []
    for index in range(max(0, steps)):
        focus = next_focus(sim, subjects)
        if focus.get("mode") == "complete" or not focus.get("objective_id"):
            if not road:
                road.append({"subject": None, "objective_id": None, "mode": "complete"})
            break
        road.append({"subject": focus["subject"],
                     "objective_id": focus["objective_id"],
                     "mode": focus["mode"]})
        key = mastery_key(focus["objective_id"])
        entry = dict(sim["mastery"].get(key)
                     or sim["mastery"].get(str(focus["objective_id"])) or {})
        entry.update({
            "achieved": True,
            "needs_review": False,
            # Far enough that no simulated step re-triggers spaced review.
            "review_due": "9999-01-01T00:00:00+00:00",
            # Monotonic future stamps: the completed subject reads as the most
            # recently practiced, exactly as it would after a real completion.
            "last_evidence_at": f"9998-01-01T00:00:{index:02d}+00:00",
        })
        sim["mastery"][key] = entry
        # A stale duplicate under the raw (dotted) key would shadow nothing —
        # entry_for prefers the safe key — but tidy it away all the same.
        if str(focus["objective_id"]) != key:
            sim["mastery"].pop(str(focus["objective_id"]), None)
    return road
