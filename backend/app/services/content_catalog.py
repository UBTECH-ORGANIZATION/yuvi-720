"""Content catalog tool seam (§5.6) — the `list_available_content` tool.

The Pedagogical agent does NOT hold the catalog; it calls this tool, which returns
the approved components the platform can serve for an objective, filtered by locale
+ mastery level. Backed by the live Kata snapshot (``kata_catalog``); callers in
async contexts prime it with ``await kata_catalog.ensure_loaded()`` first.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services import kata_catalog, learning_path

# Learner-facing mastery-level order (labels never shown to the learner).
_LEVEL_ORDER = {"basic": 0, "intermediate": 1, "advanced": 2}


def list_available_content(
    objective_id: str,
    mastery: Optional[dict[str, Any]] = None,
    locale: str = "he",
    difficulty: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Return the objective's components the platform can serve, in sequence.

    Filters by ``locale`` (component must offer that language, or declare none)
    and orders by the unit's authoritative component ``order`` (then mastery
    level / difficulty), so the earliest step surfaces first. Unlike the retired
    demo catalog, Kata's ``recommendedAfterFail`` points at a real prior
    component (a retry target), so we do NOT hide it from the normal sequence —
    after-fail routing is handled separately in ``recommended_after_fail``.
    """
    available = [
        c for c in kata_catalog.components_for(objective_id)
        if not c.get("languages") or locale in c["languages"]
    ]
    available.sort(key=lambda c: (
        c.get("order") if c.get("order") is not None else 1_000_000,
        _LEVEL_ORDER.get(c.get("mastery_level") or "basic", 0),
        c.get("relative_difficulty") if c.get("relative_difficulty") is not None else 0.5,
    ))
    return available


def recommended_after_fail(component_id: Optional[str], locale: str = "he") -> Optional[dict[str, Any]]:
    """The alternative representation to route to after a fail/misconception."""
    if not component_id:
        return None
    component = kata_catalog.get_component(component_id)
    if not component:
        return None
    for alt_id in component.get("recommended_after_fail") or []:
        alt = kata_catalog.get_component(alt_id)
        if alt and (not alt.get("languages") or locale in alt["languages"]):
            return alt
    return None


def alternate_representation(
    component_id: Optional[str],
    objective_id: Optional[str] = None,
    locale: str = "he",
) -> Optional[dict[str, Any]]:
    """A same-objective component in a DIFFERENT representation than the current
    one — the 720 misconception response ("serve content in a different
    representation, e.g. a video instead of text").

    Prefers the provider's ``recommendedAfterFail`` when it actually differs in
    ``media_format``; else the first same-objective component whose media format
    differs. Returns a compact ``{component_id, unit_id, title, media_format}``
    payload for the trigger, or None when no alternative exists.
    """
    current = kata_catalog.get_component(component_id) if component_id else None
    current_format = (current or {}).get("media_format")

    def _payload(component: dict[str, Any]) -> dict[str, Any]:
        return {
            "component_id": component.get("id"),
            "unit_id": component.get("unit_id"),
            "title": component.get("title"),
            "media_format": component.get("media_format"),
        }

    preferred = recommended_after_fail(component_id, locale)
    if preferred and preferred.get("media_format") != current_format:
        return _payload(preferred)

    if objective_id:
        for candidate in list_available_content(objective_id, locale=locale):
            if candidate.get("id") == component_id or not candidate.get("media_format"):
                continue
            if current_format and candidate.get("media_format") == current_format:
                continue
            return _payload(candidate)
    return _payload(preferred) if preferred else None


def information_to_bot(component_id: Optional[str], item_id: Optional[str] = None) -> Optional[str]:
    """The item's ``informationToBot`` — lets the Coach give item-specific help.

    Resolves the exact sub-content item/question when ``item_id`` is known, else
    the component-level aggregate.
    """
    if not component_id:
        return None
    return kata_catalog.information_for_item(component_id, item_id)


# ── Adaptive within-unit component picker (Layer B, 720 §3.2) ─────────────────
# The 720 spec fixes objective order (linear) and hands WITHIN-unit navigation to
# the platform, "בהתאם להגדרות הספק ולנתוני הלומד (ביצועים, העדפות, היסטוריה)".
# This picker realizes that: given the learner's live mastery + Kata component
# metadata it chooses the next component and its difficulty band — mastery-level
# path, same-`order` equivalent selection, difficulty match, and the assessment
# readiness gate. Deterministic + explainable (returns a `_reason`).

_MASTERY_RANK = learning_path._MASTERY_RANK
# Thresholds live with the engine now; these names are kept as aliases so
# existing callers and tests keep reading.
_STRUGGLE_SCORE = learning_path._STRUGGLE_SCORE
_CONFIDENT_SCORE = learning_path._CONFIDENT_SCORE
_CONFIDENT_CONF = learning_path._CONFIDENT_CONF
_CONFIDENT_STREAK = learning_path._CONFIDENT_STREAK
_ASSESS_READY_STREAK = learning_path._ASSESS_READY_STREAK
_ASSESS_READY_SCORE = learning_path._ASSESS_READY_SCORE
_ASSESS_READY_CONF = learning_path._ASSESS_READY_CONF


def learner_signals(brain: dict[str, Any]) -> dict[str, Any]:
    """Compact struggle/pace signals for the picker, read from the brain."""
    signals: dict[str, Any] = {"pace": (brain.get("current_state") or {}).get("pace")}
    for entry in brain.get("behavior_signals") or []:
        kind = entry.get("type") if isinstance(entry, dict) else entry
        if kind:
            signals[str(kind)] = True
    return signals


def completed_component_ids(events: list[dict[str, Any]]) -> set[str]:
    """Component ids the learner has a (non-failed) ``completed`` event for."""
    done: set[str] = set()
    for event in events or []:
        if event.get("verb") != "completed":
            continue
        if (event.get("result") or {}).get("success") is False:
            continue
        cid = event.get("launch")
        if cid:
            done.add(str(cid))
    return done


# These were the picker's own rules. They now live in `learning_path` — the one
# engine every surface reads — and are re-exported here so existing callers and
# tests keep working against the same behaviour.
_band = learning_path.band_for
_assessment_ready = learning_path.assessment_ready
_difficulty = learning_path.difficulty_of
_pick_equivalent = learning_path.pick_equivalent


def objective_plan(
    objective_id: str,
    *,
    mastery_entry: Optional[dict[str, Any]] = None,
    completed_ids: frozenset[str] | set[str] = frozenset(),
    signals: Optional[dict[str, Any]] = None,
    locale: str = "he",
) -> Optional[dict[str, Any]]:
    """The learner's plan through this objective's unit, for callers that hold a
    mastery entry rather than a brain (the dashboard hero, the agent seam).

    Same engine as the roadmap, so the two cannot disagree — which is what the
    hero and the roadmap used to do, each running its own picker.
    """
    components = list_available_content(objective_id, None, locale)
    if not components:
        return None
    unit = {
        "id": components[0].get("unit_id"),
        "objective_id": objective_id,
        "subject": components[0].get("subject"),
        "components": components,
    }
    brain = {
        "mastery": {objective_id: dict(mastery_entry or {})},
        "behavior_signals": [
            {"type": key} for key, value in (signals or {}).items() if value is True
        ],
        "current_state": {},
    }
    # `completed_ids` is what `completed_component_ids(events)` distilled, so
    # replay it as the evidence the engine expects.
    events = [
        {"verb": "completed", "launch": cid, "object_id": cid, "unit_id": unit["id"],
         "_id": f"replay-{cid}", "result": {"success": True, "score_scaled": None}}
        for cid in sorted(set(completed_ids))
    ]
    return learning_path.project(unit, brain, events, locale=locale)


def select_component(
    objective_id: str,
    *,
    mastery_entry: Optional[dict[str, Any]] = None,
    completed_ids: frozenset[str] | set[str] = frozenset(),
    signals: Optional[dict[str, Any]] = None,
    locale: str = "he",
) -> Optional[dict[str, Any]]:
    """Pick the next component within the objective's unit — a thin view of the plan.

    Kept for the agent seam (``route/next`` explainability). Returns None when the
    unit is finished. A single-component ('closed') unit trivially returns its one
    component — the platform never sequences inside one.
    """
    plan = objective_plan(objective_id, mastery_entry=mastery_entry,
                          completed_ids=completed_ids, signals=signals, locale=locale)
    if not plan:
        return None
    components = list_available_content(objective_id, None, locale)
    next_id = plan.get("next_component_id")
    if not next_id:
        return None
    chosen = next((c for c in components if c.get("id") == next_id), None)
    if chosen is None:
        return None
    node = next((n for n in plan["components"]
                 if n.get("component_id") == next_id and n.get("progress_state") == "current"), {})
    band = plan.get("_band", "on_track")
    reason = (
        f"band={band}; stage order={chosen.get('order')}; "
        f"difficulty={chosen.get('relative_difficulty')}; "
        f"why={(node.get('progress_reason') or {}).get('code', 'provider_order')}"
        + ("; assessment" if chosen.get("is_assessment") else "")
    )
    return {**chosen, "_reason": reason, "_band": band}
