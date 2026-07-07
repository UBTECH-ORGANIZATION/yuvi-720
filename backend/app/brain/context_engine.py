"""Context Engine — scoped views, write allow-lists, and the Context bundle.

This is the privacy + least-context boundary (architecture doc §4.4, §5.8). Agents
never see the whole brain: each role gets only its projected slice, and write-back
is validated against a per-agent allow-list — enforced in **code**, so even a
jailbroken prompt cannot read or write outside its scope. PII (name/grade/etc.)
lives under `identity` and is *never* placed in a bundle sent to an AI.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain.repository import get_brain, apply_brain_updates
from app.brain.schema import project, flatten_updates, path_allowed, get_path


class AgentScopeError(PermissionError):
    """Raised when an agent attempts a write outside its allow-list (§5.8)."""


# Per-agent read/write scopes — the single source of truth for least-context.
# `read` = dotted paths projected into the agent's view; `write` = dotted paths
# the agent may `$set`. Durable learner facts (profile.*, strategies, challenges)
# are written only via the consolidator (§5.7), not directly by conversational
# agents — reflected here by keeping them out of the coach/reflection write lists.
AGENT_VIEWS: dict[str, dict[str, list[str]]] = {
    "onboarding": {
        "read": ["identity.locale", "profile.mapping_scores"],
        "write": [
            "profile.activeness", "profile.interests", "profile.preferences",
            "profile.learning_style", "profile.environment", "profile.source",
            "profile.updated_at", "strengths", "challenges",
        ],
    },
    "pedagogical": {
        "read": ["mastery", "current_state", "next_recommendations", "enrollments"],
        "write": ["current_state", "next_recommendations", "mastery"],
    },
    "coach": {
        "read": [
            "identity.locale", "profile.interests", "goals",
            "current_state", "teacher_directives",
        ],
        "write": ["agent_notes"],   # durable fields only via consolidator (§5.7)
    },
    "reflection": {
        "read": ["mastery", "reflections_recent"],
        "write": ["reflections_recent"],
    },
    "teacher_insights": {
        "read": ["progress", "mastery", "strengths", "challenges", "enrollments"],
        "write": [],                # never writes the learner brain (read-only)
    },
    "safety": {
        "read": ["identity.locale"],
        "write": ["agent_notes"],
    },
}


def scopes_for(agent: str) -> dict[str, list[str]]:
    scope = AGENT_VIEWS.get(agent)
    if scope is None:
        raise AgentScopeError(f"unknown agent scope: {agent!r}")
    return scope


async def view_for(agent: str, learner_id: Optional[str]) -> dict[str, Any]:
    """Return ONLY the agent's readable slice of the brain (§5.8)."""
    scope = scopes_for(agent)
    brain = await get_brain(learner_id)
    return project(brain, scope["read"])


async def apply_writes(
    agent: str, learner_id: Optional[str], updates: dict[str, Any]
) -> dict[str, Any]:
    """Validate updates against the agent's write allow-list, then persist.

    Rejects any out-of-scope path before touching the database (fail closed).
    """
    scope = scopes_for(agent)
    flat = flatten_updates(updates)
    for path in flat:
        if not path_allowed(path, scope["write"]):
            raise AgentScopeError(
                f"agent {agent!r} may not write {path!r} (allowed: {scope['write']})"
            )
    return await apply_brain_updates(learner_id, flat)


async def build_coach_bundle(learner_id: Optional[str]) -> dict[str, Any]:
    """Assemble the non-identifying Coach Context bundle (§4.4).

    Contains no name/PII. `informationToBot` (from the current component's
    metadata) lets the Coach give item-specific help; `recent_events` let it
    detect struggle. Content/event lookups are imported lazily to avoid cycles.
    """
    from app.services.content_catalog import information_to_bot
    from app.services.events import get_recent_events

    brain = await get_brain(learner_id)
    goals = get_path(brain, "goals") or []
    component_id = get_path(brain, "current_state.component_id")
    objective_hint = None

    recent = await get_recent_events(learner_id or "", limit=5)
    recent_view = [
        {
            "verb": e.get("verb"),
            "success": (e.get("result") or {}).get("success"),
            "misconception": e.get("misconception"),
        }
        for e in recent
    ]

    return {
        "profile": {
            "interests": get_path(brain, "profile.interests") or [],
            "learning_style": get_path(brain, "profile.learning_style"),
            "preferences": get_path(brain, "profile.preferences") or [],
        },
        "goals": [
            {"text": g.get("text"), "deadline": g.get("deadline")}
            for g in goals
            if isinstance(g, dict) and g.get("visible_to_learner", True)
        ],
        "current": {
            "objective_id": objective_hint or component_id,
            "informationToBot": information_to_bot(component_id),
            "recent_events": recent_view,
        },
        "locale": get_path(brain, "identity.locale") or "he",
    }
