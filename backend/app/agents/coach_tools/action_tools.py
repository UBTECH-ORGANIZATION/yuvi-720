"""Validated learner navigation offers for Yuvi Coach."""

from __future__ import annotations

from typing import Any

from app.agents.coach_tools.registry import CoachTool, CoachToolContext, register
from app.services import coach_actions
from app.agents.coach_modes import CoachMode


async def _offer_student_action(context: CoachToolContext, args: dict[str, Any]) -> dict[str, Any]:
    result = coach_actions.offer(args["action_id"], context.mode)
    offer = result.get("data")
    if isinstance(offer, dict) and result.get("status") == "available":
        if not any(item.get("action_id") == offer.get("action_id") for item in context.action_offers):
            context.action_offers.append(offer)
    return result


register(CoachTool(
    name="offer_student_action",
    description="Offer one validated navigation action already available to the learner.",
    parameters={
        "type": "object",
        "properties": {
            "action_id": {
                "type": "string",
                "enum": coach_actions.action_ids(CoachMode.GENERAL),
            },
        },
        "required": ["action_id"],
    },
    handler=_offer_student_action,
    allowed_modes=frozenset({CoachMode.LESSON, CoachMode.GENERAL}),
))