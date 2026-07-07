"""Teacher Insights Agent (F6) + teacher write lane (§5.8).

The Insights agent is **read-only** on the learner brain — it only reads to
explain, and enforces group scoping *before* any read (F8). Teacher *writes*
(directives) go through a separate authenticated portal lane that appends
`teacher_directives` — never an LLM path. Directives steer agent decisions
(§5.7 precedence) but never touch mastery numbers.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.org import teacher_can_access_group, teacher_can_access_learner
from app.brain.repository import apply_brain_updates, get_brain
from app.services import insights


class AccessDenied(PermissionError):
    """Raised when a teacher requests data outside their groups (F8)."""


async def student_view(teacher_id: str, learner_id: str, language: str = "he") -> dict[str, Any]:
    if not teacher_can_access_learner(teacher_id, learner_id):
        raise AccessDenied(f"teacher {teacher_id!r} may not access learner")
    return await insights.student_insights(learner_id, language)


async def group_view(teacher_id: str, group_id: str, language: str = "he") -> dict[str, Any]:
    if not teacher_can_access_group(teacher_id, group_id):
        raise AccessDenied(f"teacher {teacher_id!r} may not access group {group_id!r}")
    return await insights.group_insights(group_id, language)


async def add_directive(
    teacher_id: str,
    learner_id: str,
    text: str,
    scope: Optional[str] = None,
    priority: str = "normal",
    visible_to_learner: bool = False,
) -> dict[str, Any]:
    """Append a teacher directive to the learner brain (non-LLM write lane).

    Steers agent DECISIONS at top precedence (§5.7) — never mastery/progress.
    """
    if not teacher_can_access_learner(teacher_id, learner_id):
        raise AccessDenied(f"teacher {teacher_id!r} may not write to learner")

    directive = {
        "id": f"td_{datetime.now(timezone.utc).timestamp():.0f}",
        "text": text, "scope": scope, "priority": priority, "author": "teacher",
        "teacher_id": teacher_id, "visible_to_learner": visible_to_learner,
        "created_at": datetime.now(timezone.utc).isoformat(), "expires_at": None,
    }
    brain = await get_brain(learner_id)
    directives = list(brain.get("teacher_directives") or [])
    directives.append(directive)
    await apply_brain_updates(learner_id, {"teacher_directives": directives[-20:]})
    return directive
