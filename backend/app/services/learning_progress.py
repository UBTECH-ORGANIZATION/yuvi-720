"""Evidence-backed roadmap projection for approved provider content.

The provider owns component order and recovery links. Spark owns learner event
evidence. This module combines those two sources without inventing completion:
only stored xAPI ``completed`` statements mark a node complete.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.brain.repository import get_brain
from app.services.events import get_unit_events
from learner_state import normalize_learner_id  # type: ignore


async def project_unit_roadmap(
    unit: dict[str, Any], learner_id: str
) -> dict[str, Any]:
    """Return a provider unit with deterministic, evidence-cited node states."""
    safe_learner_id = normalize_learner_id(learner_id)
    projected = deepcopy(unit)
    components = sorted(
        projected.get("components") or [],
        key=lambda row: (
            row.get("order") is None,
            row.get("order") if row.get("order") is not None else 0,
            row.get("id") or "",
        ),
    )
    events = await get_unit_events(safe_learner_id, projected.get("id") or "")
    brain = await get_brain(safe_learner_id)
    current = brain.get("current_state") or {}

    completed: dict[str, str] = {}
    recovery_ids: set[str] = set()
    for event in events:
        component_id = str(event.get("launch") or "")
        if not component_id or event.get("verb") != "completed":
            continue
        result = event.get("result") or {}
        component = next((row for row in components if row.get("id") == component_id), None)
        if component and component.get("is_assessment") and result.get("success") is False:
            recovery_ids.update(component.get("recommended_after_fail") or [])
            continue
        completed[component_id] = str(event.get("_id") or "")

    ordered_stages = sorted({
        row.get("order") for row in components if isinstance(row.get("order"), (int, float))
    })
    completed_stages = {
        row.get("order") for row in components if row.get("id") in completed
    }
    next_stage = next(
        (stage for stage in ordered_stages if stage not in completed_stages),
        None,
    )
    first_incomplete_id = next(
        (
            row.get("id") for row in components
            if row.get("id") not in completed and row.get("order") == next_stage
        ),
        None,
    )
    current_component_id = (
        current.get("component_id") if current.get("unit_id") == projected.get("id") else None
    )

    for component in components:
        component_id = component.get("id")
        if component_id in completed:
            state = "completed"
            evidence = {"kind": "xapi_completed", "event_id": completed[component_id]}
        elif component_id == current_component_id:
            state = "current"
            evidence = {"kind": "brain_current_state"}
        elif (
            component.get("order") == next_stage
            or component.get("order") in completed_stages
            or component_id in recovery_ids
        ):
            state = "available"
            evidence = {
                "kind": (
                    "provider_order" if component.get("order") == next_stage
                    else "provider_alternative" if component.get("order") in completed_stages
                    else "provider_recovery"
                ),
            }
        else:
            state = "locked"
            evidence = {"kind": "awaiting_prior_completion"}
        component["progress_state"] = state
        component["progress_evidence"] = evidence

    projected["components"] = components
    projected["current_component_id"] = current_component_id
    projected["next_component_id"] = first_incomplete_id
    return projected