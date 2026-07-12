"""Memory consolidator (§5.7) — the SINGLE writer that promotes chat signals.

Capture may only *stage*; this is the only place soft, chat-sourced signals
(interests) are merged into the durable `profile`. Keeping one writer means no
races between agents "discovering" profile facts mid-conversation. Chat-sourced
interests are soft (deduped, capped); event-facts always win — and **chat never
sets mastery** (that stays in the event pipeline).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.agents.onboarding import _extract_interests
from app.brain.repository import apply_brain_updates, get_brain
from app.services.ai_usage import UsageContext

_MAX_INTERESTS = 8
_MAX_HOBBIES = 8
_MAX_CHARACTERISTICS = 8
_MAX_CLARIFICATIONS = 12


async def capture_and_consolidate(
    learner_id: str,
    user_text: str,
    language: str,
    *,
    session_id: str | None = None,
    exchange_id: str | None = None,
) -> list[str]:
    """Extract interests from a chat turn and merge NEW ones into the profile.

    Returns the interests newly added (empty if none). Idempotent: re-stating an
    existing interest is a no-op.
    """
    candidates = await _extract_interests(
        user_text or "",
        language,
        UsageContext(
            actor_id=learner_id,
            actor_type="learner",
            endpoint="/api/agent/coach/stream",
            feature="feature_3_learning_companion",
            operation="onboarding.interest_extraction",
            source="coach_memory_consolidation",
            session_id=session_id,
            exchange_id=exchange_id,
        ),
    )
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


def _merge_soft(existing: list[Any], candidates: list[str], cap: int) -> list[str]:
    """Dedup (case-insensitive) and cap a soft, chat-sourced string list."""
    current = [str(x) for x in (existing or [])]
    seen = {c.lower() for c in current}
    added = [c for c in candidates if c and c.lower() not in seen]
    if not added:
        return []
    return (current + added)[-cap:]


async def capture_reflection_choices(
    learner_id: str,
    phase_title: str,
    choices: list[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    """Deterministic capture of tap-to-answer reflection picks (§5.7 — no LLM).

    Each choice is `{label, signal}`: the localized text the learner tapped plus
    a stable signal code. We merge the labels into soft `characteristics` and keep
    a per-phase clarification note (with the codes) for provenance. The raw MoE
    scores are never touched.
    """
    labels = [(c.get("label") or "").strip() for c in choices if (c.get("label") or "").strip()]
    if not labels:
        return {}
    signals = [(c.get("signal") or "").strip() for c in choices if (c.get("signal") or "").strip()]

    brain = await get_brain(learner_id)
    profile = brain.get("profile") or {}
    updates: dict[str, Any] = {}

    merged = _merge_soft(profile.get("characteristics") or [], labels, _MAX_CHARACTERISTICS)
    if merged:
        updates["profile.characteristics"] = merged

    note = {
        "phase": phase_title,
        "text": "\n".join(labels)[:400],
        "language": language,
        "source": "mapping_reflection_mc",
        "signals": signals,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    clarifications = list(profile.get("mapping_clarifications") or [])
    for existing in clarifications:
        if existing.get("phase") == phase_title and existing.get("source") == "mapping_reflection_mc":
            existing.update(note)
            break
    else:
        clarifications.append(note)
    updates["profile.mapping_clarifications"] = clarifications[-_MAX_CLARIFICATIONS:]

    await apply_brain_updates(learner_id, updates)
    return updates
