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
from app.services import content_catalog, kata_catalog
from app.services.events import get_learner_events
from app.services.planner import next_focus, plan_next


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def select_next(learner_id: str, locale: str = "he") -> dict[str, Any]:
    """Choose the next objective + component and record it in the brain (F1)."""
    await kata_catalog.ensure_loaded()
    brain = await get_brain(learner_id)
    # Cross-subject focus: global review-due first, else most-behind subject.
    focus = next_focus(brain)
    plan = focus["plan"]
    next_recommendations = {**plan, "computed_at": _now()}
    focus_subject, objective_id, focus_mode = focus["subject"], focus["objective_id"], focus["mode"]

    component = None
    if objective_id:
        from app.brain.mastery import entry_for
        events = await get_learner_events(learner_id)
        component = content_catalog.select_component(
            objective_id,
            mastery_entry=entry_for(brain.get("mastery"), objective_id),
            completed_ids=content_catalog.completed_component_ids(events),
            signals=content_catalog.learner_signals(brain),
            locale=locale,
        )

    updates: dict[str, Any] = {"next_recommendations": next_recommendations}
    if component:
        updates["current_state.unit_id"] = component.get("unit_id") or None
        updates["current_state.component_id"] = component["id"]
        updates["current_state.item_id"] = None
        updates["current_state.resume_token"] = None
    await apply_writes("pedagogical", learner_id, updates)

    return {
        "subject": focus_subject,
        "objective_id": objective_id,
        "component": component,
        "difficulty": (component or {}).get("_band"),
        "reason": (component or {}).get("_reason"),
        "plan": plan,
        # Explainable: review-due (any subject) beats new material; new material
        # goes to the most-behind / least-recently-practiced subject.
        "explanation": (
            f"next = {objective_id} — spaced-review due (mastered skill decayed or "
            f"failed after mastery) in {focus_subject}"
            if focus_mode == "review"
            else f"next = {objective_id} — new material in {focus_subject} "
                 f"(most-behind / least-recently-practiced subject), prerequisites met"
        ) if objective_id else "all enrolled objectives mastered",
    }


async def route_after_fail(learner_id: str, locale: str = "he") -> Optional[dict[str, Any]]:
    """Route to the `recommendedAfterFail` alternative for the current component."""
    await kata_catalog.ensure_loaded()
    brain = await get_brain(learner_id)
    current = brain.get("current_state") or {}
    component_id = current.get("component_id")
    alt = content_catalog.recommended_after_fail(component_id, locale)
    if not alt:
        return None
    await apply_writes("pedagogical", learner_id, {
        "current_state.component_id": alt["id"],
        "current_state.item_id": None,
        "current_state.resume_token": None,
    })
    return alt
