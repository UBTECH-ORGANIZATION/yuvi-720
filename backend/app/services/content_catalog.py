"""Content catalog tool seam (§5.6) — the `list_available_content` tool.

The Pedagogical agent does NOT hold the catalog; it calls this tool, which returns
the approved components the platform can serve for an objective, filtered by locale
+ mastery level. Backed by the live Kata snapshot (``kata_catalog``); callers in
async contexts prime it with ``await kata_catalog.ensure_loaded()`` first.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services import kata_catalog

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

_MASTERY_RANK = {"basic": 0, "intermediate": 1, "advanced": 2}
# Thresholds (tunable — mirror the constants style in mastery.py).
_STRUGGLE_SCORE = 0.4
_CONFIDENT_SCORE = 0.75
_CONFIDENT_CONF = 0.5
_CONFIDENT_STREAK = 3
_ASSESS_READY_STREAK = 2
_ASSESS_READY_SCORE = 0.7
_ASSESS_READY_CONF = 0.4


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


def _band(entry: dict[str, Any], signals: Optional[dict[str, Any]]) -> str:
    """Map mastery + behaviour to a difficulty band: struggling/on_track/confident."""
    score = entry.get("score_ewma")
    conf = float(entry.get("confidence") or 0)
    streak = int(entry.get("consecutive_successes") or 0)
    failures = int(entry.get("failures") or 0)
    level = entry.get("level") or "basic"
    sig = signals or {}
    struggling_signal = bool(sig.get("wheel_spinning") or sig.get("rapid_guessing")
                             or sig.get("answer_cycling") or sig.get("answer-cycling"))
    if (struggling_signal
            or (score is not None and score < _STRUGGLE_SCORE)
            or (failures >= 2 and streak == 0)):
        return "struggling"
    if ((score is not None and score >= _CONFIDENT_SCORE and conf >= _CONFIDENT_CONF)
            or level in ("intermediate", "advanced")
            or streak >= _CONFIDENT_STREAK):
        return "confident"
    return "on_track"


def _assessment_ready(entry: dict[str, Any]) -> bool:
    """Enough practice success to face the objective's assessment (720 §3.3)."""
    score = entry.get("score_ewma")
    conf = float(entry.get("confidence") or 0)
    streak = int(entry.get("consecutive_successes") or 0)
    level = entry.get("level") or "basic"
    return (streak >= _ASSESS_READY_STREAK
            or (score is not None and score >= _ASSESS_READY_SCORE and conf >= _ASSESS_READY_CONF)
            or level in ("intermediate", "advanced"))


def _difficulty(component: dict[str, Any]) -> float:
    value = component.get("relative_difficulty")
    return float(value) if isinstance(value, (int, float)) else 3.0


def _pick_equivalent(pool: list[dict[str, Any]], band: str) -> dict[str, Any]:
    """Choose among same-`order` pedagogically-equivalent components by learner fit
    (720 §3.1 — 'ערך שקול ללומד'). Struggling→easiest, confident→hardest."""
    key = lambda c: (_MASTERY_RANK.get(c.get("mastery_level") or "basic", 0), _difficulty(c))
    if band == "struggling":
        return min(pool, key=key)
    if band == "confident":
        return max(pool, key=key)
    ordered = sorted(pool, key=key)
    return ordered[len(ordered) // 2]  # on_track → the middle rung


def select_component(
    objective_id: str,
    *,
    mastery_entry: Optional[dict[str, Any]] = None,
    completed_ids: frozenset[str] | set[str] = frozenset(),
    signals: Optional[dict[str, Any]] = None,
    locale: str = "he",
) -> Optional[dict[str, Any]]:
    """Pick the next component + difficulty within the objective's unit.

    Returns the chosen (normalized) component with ``_reason`` and ``_band``
    stamped, or None when everything is complete. Single-component objectives
    (720 'closed' units) trivially return their one component — the platform
    never sequences a closed unit's internal items. After-fail routing stays in
    ``recommended_after_fail`` (720 ``recommendedAfterFail``), a separate path.
    """
    entry = mastery_entry or {}
    done = set(completed_ids)
    candidates = [c for c in list_available_content(objective_id, None, locale) if c["id"] not in done]
    if not candidates:
        return None
    band = _band(entry, signals)
    ready = _assessment_ready(entry)

    # 1. Assessment readiness gate — withhold the assessment until enough practice.
    learning = [c for c in candidates if not c.get("is_assessment")]
    if not ready and learning:
        candidates = learning

    # 2. Skip-ahead for a confident learner — don't re-walk pure instruction intros.
    if band == "confident":
        non_intro = [c for c in candidates if c.get("purpose") != "instruction"]
        if non_intro:
            candidates = non_intro

    # 3. Current stage = lowest remaining `order`; pick among same-`order` equivalents.
    orders = [c.get("order") for c in candidates if c.get("order") is not None]
    stage = min(orders) if orders else None
    equivalents = [c for c in candidates if c.get("order") == stage] if stage is not None else candidates
    if len(equivalents) <= 1:
        chosen = (equivalents or candidates)[0]
    else:
        required = [c for c in equivalents if c.get("is_required")]
        chosen = _pick_equivalent(required or equivalents, band)

    reason = (
        f"band={band}; stage order={chosen.get('order')}; "
        f"difficulty={chosen.get('relative_difficulty')}; "
        + ("assessment eligible" if ready else "practice before assessment")
        + ("; assessment" if chosen.get("is_assessment") else "")
    )
    return {**chosen, "_reason": reason, "_band": band}
