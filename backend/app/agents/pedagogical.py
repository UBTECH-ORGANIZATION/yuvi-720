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

    # A teacher's pin outranks the planner (#249): "next" was chosen by a
    # person standing in the room, so the route honours it until the component
    # is completed — the xAPI fold clears the pin at that moment, and a spent
    # or expired pin is skipped here rather than served again. One judgement,
    # shared with the hero (`pinning.active_pin`), so route and hero can never
    # disagree about whether a pin is live.
    #
    # A TASK pin is deliberately NOT honoured here (#244): this agent speaks
    # only catalog components, and a task has none. The hero owns task-pin
    # steering — its start button navigates straight to `/tasks/{launch_id}`
    # without asking this route — so a caller landing here under a task pin is
    # mid-something-else, and the planner's own answer is the right one.
    from app.services import pinning

    if (pinned := pinning.active_pin(brain)) is not None \
            and pinning.pin_kind(pinned) == pinning.KIND_COMPONENT:
        component = kata_catalog.get_component(str(pinned["component_id"]))
        events = await get_learner_events(learner_id)
        completed = content_catalog.completed_component_ids(events)
        if component and str(pinned["component_id"]) not in completed:
            objective_id = pinned.get("objective_id") or component.get("objective_id")
            return {
                "subject": component.get("subject"),
                "objective_id": objective_id,
                "component": component,
                "difficulty": None,
                "reason": "pinned",
                "plan": {},
                "explanation": f"next = {objective_id} — pinned by the teacher",
            }

    # An OBJECTIVE pin names the goal and leaves the allocation to this very
    # planner: `objective_next` runs the same per-objective engine the roadmap
    # reads, so the child moves through the pinned goal exactly as they would
    # have moved through it unpinned. A goal that has run dry falls through —
    # the planner's own answer resumes.
    if pinned is not None and pinning.pin_kind(pinned) == pinning.KIND_OBJECTIVE:
        events = await get_learner_events(learner_id)
        completed = content_catalog.completed_component_ids(events)
        component = pinning.objective_next(pinned, brain, completed, locale)
        if component is not None:
            objective_id = str(pinned["objective_id"])
            return {
                "subject": component.get("subject") or pinned.get("subject"),
                "objective_id": objective_id,
                "component": component,
                "difficulty": component.get("_band"),
                "reason": "pinned",
                "plan": {},
                "explanation": (
                    f"next = {objective_id} — the goal is pinned by the teacher; "
                    "the component is the planner's own allocation within it"
                ),
            }

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

    # `current_state.component_id` means "where the learner IS", and it used to be
    # written here — by a *recommendation*. The roadmap then painted that
    # recommendation as `current`, so a suggestion the learner never acted on
    # could contradict the route on screen. Only the real launch
    # (`learning_sessions`) and the xAPI fold (`events`) write it now; this agent
    # publishes its recommendation and nothing else.
    await apply_writes("pedagogical", learner_id,
                       {"next_recommendations": next_recommendations})

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
    # Same reason as `select_next`: this names where the learner SHOULD go. The
    # path engine already inserts the repair round from the same provider
    # metadata, and the pointer moves when they actually launch it.
    return alt
