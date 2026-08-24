"""Server-authoritative reservation of a Coach hint or explanation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from app.agents import tutor_decision


@dataclass(frozen=True)
class SupportReservation:
    question_key: str
    hint_level: Optional[int]


async def reserve_support(
    learner_id: str,
    support: str,
    *,
    surface_component_id: Optional[str],
    session_id: Optional[str],
    conversation_id: str,
) -> Optional[SupportReservation]:
    """Reserve one support use and record its shared learning evidence.

    Both the support button and a qualifying chat request call this function, so
    their per-question allowance, activity evidence, and LRS reporting remain
    one policy.
    """
    from app.brain.repository import get_brain
    from app.services import learner_activity
    from app.services.lrs import config as lrs_config
    from app.services.lrs import reporter as lrs_reporter

    brain = await get_brain(learner_id)
    current_state = brain.get("current_state") or {}
    question_key = tutor_decision.support_question_key(current_state, surface_component_id)
    if tutor_decision.support_used(current_state, question_key).get(support):
        return None

    hint_level = await tutor_decision.record_support_used(learner_id, question_key, support)
    try:
        await learner_activity.record(
            learner_id,
            support,
            component_id=current_state.get("component_id") or surface_component_id,
            item_id=current_state.get("item_id"),
            question_id=current_state.get("question_id"),
        )
    except Exception:
        pass

    if session_id:
        component_id = surface_component_id
        component_iri = (
            f"{lrs_config.supplier_domain()}/component/{component_id}"
            if component_id else None
        )
        await lrs_reporter.report_help_requested(
            learner_id,
            session_id,
            object_id=component_iri or f"{lrs_config.supplier_domain()}/conversation/{conversation_id}",
            object_type="component" if component_iri else "conversation",
            help_source="platform",
            help_type=support,
            component_id=component_id if component_iri else None,
        )
    return SupportReservation(question_key=question_key, hint_level=hint_level)