"""Content catalog tool seam (§5.6) — the `list_available_content` MCP-style tool.

The Pedagogical agent does NOT hold the catalog; it calls this tool, which returns
the approved components the platform can serve for an objective, filtered by locale
+ mastery level. This is the same seam that later lets an external provider expose
its catalog over MCP without changing the agent.
"""

from __future__ import annotations

from typing import Any, Optional

from app.brain.curriculum import CONTENT_COMPONENTS, components_for, get_component

# Learner-facing mastery-level order (labels never shown to the learner).
_LEVEL_ORDER = {"basic": 0, "intermediate": 1, "advanced": 2}

# Components that are another component's `recommendedAfterFail` are ALTERNATIVE
# representations — surfaced only via after-fail routing, never in normal listing.
_ALTERNATIVE_IDS = {
    c["recommendedAfterFail"] for c in CONTENT_COMPONENTS if c.get("recommendedAfterFail")
}


def list_available_content(
    objective_id: str,
    mastery: Optional[dict[str, Any]] = None,
    locale: str = "he",
    difficulty: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Return approved PRIMARY components for an objective the platform can serve.

    Filters by `locale` (component must offer that language), excludes alternative
    representations, and orders by mastery level then difficulty, so the
    earliest-appropriate primary component surfaces first.
    """
    from app.brain.mastery import entry_for
    entry = entry_for(mastery, objective_id)
    achieved_level = entry.get("level")
    available = [
        c for c in components_for(objective_id)
        if locale in (c.get("languages") or []) and c["id"] not in _ALTERNATIVE_IDS
    ]
    available.sort(key=lambda c: (_LEVEL_ORDER.get(c.get("masteryLevel", "basic"), 0),
                                  c.get("relativeDifficulty", 0.5)))
    return available


def recommended_after_fail(component_id: str, locale: str = "he") -> Optional[dict[str, Any]]:
    """The alternative representation to route to after a fail/misconception."""
    component = get_component(component_id)
    if not component:
        return None
    alt_id = component.get("recommendedAfterFail")
    if not alt_id:
        return None
    alt = get_component(alt_id)
    if alt and locale in (alt.get("languages") or []):
        return alt
    return None


def information_to_bot(component_id: Optional[str]) -> Optional[str]:
    """The item's `informationToBot` — lets the Coach give item-specific help."""
    if not component_id:
        return None
    component = get_component(component_id)
    return (component or {}).get("informationToBot")
