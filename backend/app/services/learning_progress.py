"""Evidence-backed roadmap projection for approved provider content.

The provider owns component order and recovery links. Spark owns learner event
evidence. Neither invents completion: only stored xAPI ``completed`` statements
settle a node.

The projection itself now lives in ``learning_path`` — one engine that every
surface reads, so the roadmap, the lesson flow, the dashboard hero and the launch
gate cannot disagree about "what next". This module is the async shell: fetch the
evidence, plan, and strip what the learner may not see (720 §2 — mastery levels
are internal, and no numeric score reaches the UI).
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.brain.repository import get_brain
from app.services import learning_path
from app.services.events import get_unit_events
from learner_state import normalize_learner_id  # type: ignore

# Fields that exist for the platform, the teacher view and the LRS — never for
# the learner's own payload.
_INTERNAL_UNIT_FIELDS = ("_band", "_assessment_ready")
_INTERNAL_NODE_FIELDS = ("mastery_level", "cognitive_level", "depth_level")


def strip_internal(projected: dict[str, Any]) -> dict[str, Any]:
    """The learner-facing view of a plan.

    Drops the mastery-level vocabulary (§2: "רמות השליטה אינן מוצגות ללומד") and
    the reason *evidence* — scores, EWMA, confidence — keeping only the reason
    `code`, which is what the UI turns into a sentence a child can read. The full
    plan stays available to teacher-authenticated callers via ``?explain=1``.
    """
    out = {key: value for key, value in projected.items() if key not in _INTERNAL_UNIT_FIELDS}
    nodes = []
    for node in out.get("components") or []:
        clean = {key: value for key, value in node.items() if key not in _INTERNAL_NODE_FIELDS}
        reason = clean.get("progress_reason") or {}
        clean["progress_reason"] = {"code": reason.get("code")}
        nodes.append(clean)
    out["components"] = nodes
    return out


async def project_unit_roadmap(
    unit: dict[str, Any], learner_id: str, *, locale: str = "he", explain: bool = False
) -> dict[str, Any]:
    """Return a provider unit with deterministic, evidence-cited node states."""
    safe_learner_id = normalize_learner_id(learner_id)
    unit_id = unit.get("id") or ""
    events = await get_unit_events(safe_learner_id, unit_id)
    brain = await get_brain(safe_learner_id)
    projected = learning_path.project(deepcopy(unit), brain, events, locale=locale)
    return projected if explain else strip_internal(projected)
