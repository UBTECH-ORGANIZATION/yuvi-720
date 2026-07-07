"""Pedagogical Agent (F1) — decides the next component/representation (§5.3).

Split from the Coach: the Coach talks *inside* the current item; the Pedagogical
agent decides *which* item/component comes next and handles the
`recommendedAfterFail` route. Sequencing is the deterministic planner's job; this
agent picks the exact component from the catalog and records the route. Writes go
through the pedagogical scoped allow-list (§5.8).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.context_engine import apply_writes
from app.brain.repository import get_brain
from app.services import content_catalog
from app.services.planner import plan_next


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def select_next(learner_id: str, locale: str = "he") -> dict[str, Any]:
    """Choose the next objective + component and record it in the brain (F1)."""
    brain = await get_brain(learner_id)
    plan = plan_next(brain)
    next_recommendations = {**plan, "computed_at": _now()}

    # Focus: earliest subject that still has a frontier objective.
    focus_subject, objective_id = None, None
    for subject, info in plan.items():
        if info["next"]:
            focus_subject, objective_id = subject, info["next"][0]
            break

    component = None
    if objective_id:
        candidates = content_catalog.list_available_content(
            objective_id, brain.get("mastery"), locale
        )
        component = candidates[0] if candidates else None

    updates: dict[str, Any] = {"next_recommendations": next_recommendations}
    if component:
        updates["current_state.unit_id"] = component["id"].rsplit("-", 1)[0]
        updates["current_state.component_id"] = component["id"]
    await apply_writes("pedagogical", learner_id, updates)

    return {
        "subject": focus_subject,
        "objective_id": objective_id,
        "component": component,
        "plan": plan,
        # Explainable: why THIS objective (earliest unmastered, prereqs met).
        "explanation": (
            f"next = {objective_id} — earliest unmastered objective in {focus_subject} "
            f"with prerequisites met"
        ) if objective_id else "all enrolled objectives mastered",
    }


async def route_after_fail(learner_id: str, locale: str = "he") -> Optional[dict[str, Any]]:
    """Route to the `recommendedAfterFail` alternative for the current component."""
    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    component_id = current.get("component_id")
    alt = content_catalog.recommended_after_fail(component_id, locale)
    if not alt:
        return None
    await apply_writes("pedagogical", learner_id, {"current_state.component_id": alt["id"]})
    return alt
