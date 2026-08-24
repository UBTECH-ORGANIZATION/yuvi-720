"""Server-bounded visual explanation requests for the learner Coach."""

from __future__ import annotations

from typing import Any

from app.agents.coach_modes import CoachMode
from app.agents.coach_tools.registry import CoachTool, CoachToolContext, register


_BOTH_MODES = frozenset({CoachMode.LESSON, CoachMode.GENERAL})


async def _request_visual_explanation(
    context: CoachToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    """Record one visual intent; rendering happens after the guarded reply."""
    if not context.visual_requests:
        context.visual_requests.append({"mode": args["mode"]})
    return {"status": "accepted", "data": {"mode": context.visual_requests[0]["mode"]}}


register(CoachTool(
    name="request_visual_explanation",
    description=(
        "Request one server-controlled visual explanation when it would make "
        "the upcoming learner-safe reply clearer. Use only for a concrete "
        "relationship, process, or spatial idea that benefits from seeing it."
    ),
    parameters={
        "type": "object",
        "properties": {
            "mode": {"type": "string", "enum": ["image", "video"]},
        },
        "required": ["mode"],
    },
    handler=_request_visual_explanation,
    allowed_modes=_BOTH_MODES,
))