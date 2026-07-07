"""Memory consolidator (§5.7) — the SINGLE writer that promotes chat signals.

Capture may only *stage*; this is the only place soft, chat-sourced signals
(interests) are merged into the durable `profile`. Keeping one writer means no
races between agents "discovering" profile facts mid-conversation. Chat-sourced
interests are soft (deduped, capped); event-facts always win — and **chat never
sets mastery** (that stays in the event pipeline).
"""

from __future__ import annotations

from typing import Any

from app.agents.onboarding import _extract_interests
from app.brain.repository import apply_brain_updates, get_brain

_MAX_INTERESTS = 8


async def capture_and_consolidate(learner_id: str, user_text: str, language: str) -> list[str]:
    """Extract interests from a chat turn and merge NEW ones into the profile.

    Returns the interests newly added (empty if none). Idempotent: re-stating an
    existing interest is a no-op.
    """
    candidates = await _extract_interests(user_text or "", language)
    if not candidates:
        return []

    brain = await get_brain(learner_id)
    existing = list((brain.get("profile") or {}).get("interests") or [])
    existing_lower = {i.lower() for i in existing}

    added = [c for c in candidates if c.lower() not in existing_lower]
    if not added:
        return []

    merged = (existing + added)[-_MAX_INTERESTS:]
    await apply_brain_updates(learner_id, {"profile.interests": merged})
    return added
