"""Provider-backed learning-session launches for 720 Feature 1.

A session joins the approved catalog channel (what may be learned) with the xAPI
channel (what happened). It writes only the current component location to the
Brain; mastery remains exclusively event-derived.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from app.brain.repository import apply_brain_updates, get_brain
from app.services import content_provider
from app.services.events import mint_launch
from app.services.learning_progress import project_unit_roadmap
from learner_state import normalize_learner_id  # type: ignore


def _public_base_url(request_base_url: str) -> str:
    configured = os.environ.get("PUBLIC_APP_URL")
    return (configured or request_base_url).rstrip("/")


async def create_provider_session(
    learner_id: str,
    component_id: str,
    *,
    unit_id: Optional[str],
    language: str,
    request_base_url: str,
) -> dict[str, Any]:
    safe_learner_id = normalize_learner_id(learner_id)
    unit, component = await content_provider.resolve_component(component_id, unit_id)
    content_language = language if language in component["languages"] else (
        component["languages"][0] if component["languages"] else None
    )

    launch = mint_launch(
        safe_learner_id,
        objective_id=unit["objective_id"],
        component_id=component["id"],
        unit_id=unit["id"],
        subject=unit["subject"],
        is_assessment=component["is_assessment"],
        source="content_provider",
        reporting_base_url=_public_base_url(request_base_url),
    )

    brain = await get_brain(safe_learner_id)
    current = brain.get("current_state") or {}
    same_component = current.get("component_id") == component["id"]
    await apply_brain_updates(safe_learner_id, {
        "current_state.unit_id": unit["id"],
        "current_state.component_id": component["id"],
        "current_state.item_id": current.get("item_id") if same_component else None,
        "current_state.resume_token": current.get("resume_token") if same_component else None,
    })

    roadmap = await project_unit_roadmap(unit, safe_learner_id)
    return {
        "unit": {
            "id": unit["id"],
            "title": unit["title"],
            "sub_topic": unit["sub_topic"],
            "objective_id": unit["objective_id"],
            "subject": unit["subject"],
        },
        "component": component,
        "roadmap": roadmap,
        "content_language": content_language,
        "requested_language": language,
        "language_supported": language in component["languages"],
        "player_url": content_provider.build_player_url(
            unit["id"], component["id"], launch["slxapi"]
        ),
        "launch": launch["launch"],
        "session_id": launch["session_id"],
        "timing_url": (
            f"{_public_base_url(request_base_url)}/api/learning/sessions/"
            f"{launch['session_id']}/timing"
        ),
        "resume_token": current.get("resume_token") if same_component else None,
        "source": "content_provider",
    }
