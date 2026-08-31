"""Point at a region of the lesson screen while answering.

The model selects a REGION from a static vocabulary — never coordinates. The
handler resolves geometry server-side from the nightly capture
(``content_intelligence.screen_anchors``), so nothing the model says can move
the overlay somewhere untrue. Missing or stale geometry still accepts the
intent with ``region: None``: the frontend renders its whole-frame glow, which
communicates "look at the lesson" without asserting a position we don't have.
"""

from __future__ import annotations

import os
from typing import Any

from app.agents.coach_modes import CoachMode
from app.agents.coach_tools.registry import CoachTool, CoachToolContext, register


def pointing_enabled() -> bool:
    return (os.environ.get("COACH_POINTING_ENABLED") or "1").strip().lower() in {
        "1", "true", "yes", "on",
    }


async def _point_at_screen(
    context: CoachToolContext, args: dict[str, Any]
) -> dict[str, Any]:
    if not pointing_enabled():
        return {"status": "not_applicable", "reason": "pointing_disabled"}
    if context.pointer_requests:
        # One pointer per turn — a second call would fight the first for the
        # learner's attention.
        return {"status": "accepted",
                "data": {"region": context.pointer_requests[0].get("region")}}
    current = (context.bundle or {}).get("current") or {}
    component_id = str(current.get("component_id") or "")
    item_id = str(current.get("item_id") or "")
    if not component_id or not item_id:
        return {"status": "not_applicable", "reason": "no_screen"}

    from app.services import content_intelligence

    region = str(args["region"])
    anchors = content_intelligence.screen_anchors(component_id, item_id)
    question_key = "|".join(
        (component_id, item_id, str(current.get("question_id") or "")))
    rect = (anchors or {}).get("regions", {}).get(region)
    if rect:
        context.pointer_requests.append({
            "region": region,
            "rect": rect,
            "no_scroll": bool(anchors["no_internal_scroll"]),
            "capture_viewport": anchors["capture_viewport"],
            "question_key": question_key,
        })
        return {"status": "accepted", "data": {"region": region}}
    context.pointer_requests.append({
        "region": None,
        "rect": None,
        "no_scroll": False,
        "capture_viewport": {},
        "question_key": question_key,
    })
    return {"status": "accepted", "data": {"region": "whole_screen"}}


register(CoachTool(
    name="point_at_screen",
    description=(
        "הדגשה ויזואלית של אזור במסך הלמידה, מסונכרנת עם התשובה שלך. השתמש/י "
        "כשהלומד/ת שואל/ת על משהו שנראה על המסך, או כשרמז מתייחס לחלק מסוים "
        "(השאלה, האפשרויות, תמונה, סרטון, תרשים/יישומון, טבלה, הוראות). "
        "ההודעה שלך צריכה להתייחס למה שמודגש, בלי לתאר את פעולת ההדגשה עצמה."
    ),
    parameters={
        "type": "object",
        "properties": {
            "region": {
                "type": "string",
                # Static on purpose (schemas bake at import): the vocabulary is
                # the region taxonomy, and the handler decides availability.
                "enum": ["question", "options", "image", "video", "diagram",
                         "table", "instruction"],
            },
        },
        "required": ["region"],
    },
    handler=_point_at_screen,
    allowed_modes=frozenset({CoachMode.LESSON}),
))
