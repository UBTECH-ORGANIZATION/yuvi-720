"""Context Engine — scoped views, write allow-lists, and the Context bundle.

This is the privacy + least-context boundary (architecture doc §4.4, §5.8). Agents
never see the whole brain: each role gets only its projected slice, and write-back
is validated against a per-agent allow-list — enforced in **code**, so even a
jailbroken prompt cannot read or write outside its scope. PII (name/grade/etc.)
lives under `identity` and is *never* placed in a bundle sent to an AI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import get_brain, apply_brain_updates
from app.brain.schema import project, flatten_updates, path_allowed, get_path


class AgentScopeError(PermissionError):
    """Raised when an agent attempts a write outside its allow-list (§5.8)."""


COACH_SCREEN_AREAS: dict[str, list[str]] = {
    "results": ["learning_profile", "strengths", "challenges", "preferences"],
    "student_dashboard": [
        "current_or_next_learning", "subject_progress", "goals",
        "strengths", "challenges", "learning_profile",
    ],
    "mentoring": ["learner_visible_goals", "next_steps", "shared_mentoring_notes"],
    "learning_portal": ["recommended_learning", "subjects", "learning_status"],
    "learning_lesson": ["current_learning_item", "instructions", "activity", "feedback"],
    "learning_create": ["creation_brief", "generated_learning_activity", "preview"],
    "unknown": [],
}


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
            "identity.locale", "profile.interests", "profile.hobbies",
            "profile.characteristics", "profile.learning_style",
            "profile.preferences", "profile.environment", "strengths",
            "challenges", "strategies", "goals", "current_state",
            "teacher_directives",
        ],
        "write": ["agent_notes"],   # durable fields only via consolidator (§5.7)
    },
    "reflection": {
        "read": ["mastery", "reflections_recent"],
        "write": ["reflections_recent"],
    },
    "teacher_insights": {
        "read": ["progress", "mastery", "strengths", "challenges", "enrollments", "wellbeing_flags"],
        "write": [],                # never writes the learner brain (read-only)
    },
    "safety": {
        "read": ["identity.locale"],
        "write": ["agent_notes", "wellbeing_flags"],
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


async def build_coach_bundle(
    learner_id: Optional[str], surface_context: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    """Assemble the non-identifying Coach Context bundle (§4.4).

    Contains no name/PII. `informationToBot` (from the current component's
    metadata) lets the Coach give item-specific help; `recent_events` let it
    detect struggle. Content/event lookups are imported lazily to avoid cycles.
    """
    from app.brain.curriculum import get_component, localized_objective_title
    from app.services.content_catalog import information_to_bot
    from app.services.events import get_recent_events

    brain = await view_for("coach", learner_id)
    goals = get_path(brain, "goals") or []
    component_id = get_path(brain, "current_state.component_id")
    unit_id = get_path(brain, "current_state.unit_id")
    item_id = get_path(brain, "current_state.item_id")
    resume_token = get_path(brain, "current_state.resume_token")
    pace = get_path(brain, "current_state.pace")
    component = get_component(component_id) if component_id else None
    objective_id = (component or {}).get("objective_id")
    locale = get_path(brain, "identity.locale") or "he"
    screen = (surface_context or {}).get("screen")
    if screen not in COACH_SCREEN_AREAS:
        screen = "unknown"

    # Every free-text value is bounded and deterministically PII-redacted before
    # entering the model prompt. Internal scores and identity fields are absent
    # from the Coach scope entirely.
    from app.agents.safety import strip_pii

    def safe_text(value: Any, limit: int = 180) -> str:
        text, _ = strip_pii(str(value or ""))
        return text.replace("<", "‹").replace(">", "›").strip()[:limit]

    def labels(values: Any, limit: int = 3) -> list[str]:
        result: list[str] = []
        for value in values if isinstance(values, list) else []:
            raw = value.get("label") or value.get("text") if isinstance(value, dict) else value
            text = safe_text(raw)
            if text:
                result.append(text)
            if len(result) >= limit:
                break
        return result

    strategies: list[str] = []
    for strategy in get_path(brain, "strategies") or []:
        if not isinstance(strategy, dict):
            continue
        confidence = strategy.get("confidence")
        if isinstance(confidence, (int, float)) and confidence < 0.65:
            continue
        note = safe_text(strategy.get("note") or strategy.get("text"))
        if note:
            strategies.append(note)
        if len(strategies) >= 3:
            break

    current_ids = {value for value in (unit_id, component_id, item_id, objective_id) if value}
    now = datetime.now(timezone.utc)
    teacher_guidance: list[str] = []
    for directive in reversed(get_path(brain, "teacher_directives") or []):
        if not isinstance(directive, dict):
            continue
        expires_at = directive.get("expires_at")
        if expires_at:
            try:
                expires = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                if expires.tzinfo is None:
                    expires = expires.replace(tzinfo=timezone.utc)
                if expires <= now:
                    continue
            except ValueError:
                continue
        scope = safe_text(directive.get("scope"), 100)
        if scope and scope not in {"all", "global"}:
            scoped_id = scope.split(":", 1)[-1]
            if scoped_id not in current_ids:
                continue
        text = safe_text(directive.get("text"))
        if text:
            teacher_guidance.append(text)
        if len(teacher_guidance) >= 3:
            break
    teacher_guidance.reverse()

    recent = await get_recent_events(learner_id or "", limit=5)
    recent_view = [
        {
            "verb": safe_text(e.get("verb"), 60),
            "success": (e.get("result") or {}).get("success"),
            "misconception": safe_text(e.get("misconception"), 120),
        }
        for e in recent
    ]

    return {
        "profile": {
            "interests": labels(
                (get_path(brain, "profile.interests") or [])
                + (get_path(brain, "profile.hobbies") or []),
                limit=6,
            ),
            "characteristics": labels(get_path(brain, "profile.characteristics") or []),
            "learning_style": safe_text(get_path(brain, "profile.learning_style")),
            "preferences": labels(get_path(brain, "profile.preferences") or [], limit=5),
            "environment": safe_text(get_path(brain, "profile.environment")),
        },
        "strengths": labels(get_path(brain, "strengths") or []),
        "challenges": labels(get_path(brain, "challenges") or []),
        "strategies": strategies,
        "goals": [
            {
                "text": safe_text(g.get("text")),
                "deadline": safe_text(g.get("deadline"), 40),
                "status": safe_text(g.get("status") or "open", 24),
            }
            for g in goals
            if isinstance(g, dict) and g.get("visible_to_learner", True)
        ][:5],
        "teacher_guidance": teacher_guidance,
        "surface": {
            "screen": screen,
            "visible_areas": COACH_SCREEN_AREAS[screen],
        },
        "current": {
            "objective_id": objective_id,
            "objective_title": (
                safe_text(localized_objective_title(objective_id, locale), 160)
                if objective_id else ""
            ),
            "task_status": (
                "resume_available" if component_id and resume_token else "no_open_task"
            ),
            "pace": safe_text(pace, 30),
            "informationToBot": safe_text(information_to_bot(component_id), 900),
            "recent_events": recent_view,
        },
        "locale": locale,
    }
