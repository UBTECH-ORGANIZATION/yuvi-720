"""Kata-backed curriculum spine — the live replacement for ``brain/curriculum.py``.

The planner, pedagogical agent, dashboard and coach all need a synchronous view
of the objective spine (objective → prerequisites → components) and localized
titles. Kata is an async HTTP catalog, so this module keeps a small in-memory
**snapshot** refreshed on a TTL, and exposes sync accessors with the SAME names
the old hardcoded ``curriculum`` module did (``objectives_for`` / ``get_objective``
/ ``components_for`` / ``get_component`` / ``localized_objective_title``).

Async callers prime the snapshot with ``await ensure_loaded()`` before reading;
the app also refreshes it at startup. The catalog is small, so a full fetch is
cheap. One namespace end-to-end: objective ids are Kata's dotted ``MOE.…`` keys.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app.services import kata_client

# Time source is injected so tests / offline runs stay deterministic; falls back
# to wall clock. (No Date.now-style hidden state in the accessors themselves.)
_TTL_SECONDS = 300.0

_SNAPSHOT: dict[str, Any] = {
    "loaded_at": 0.0,
    "objectives": {},        # objective_id -> objective spine entry
    "by_subject": {},        # subject -> [objective_id, …] in planner order
    "components": {},         # component_id -> normalized component
    "components_by_obj": {},  # objective_id -> [component_id, …]
    "units": {},              # unit_id -> normalized unit
}


def _now() -> float:
    return time.time()


def _order_objectives(objectives: dict[str, dict[str, Any]], subject: str) -> list[str]:
    """Topologically order a subject's objectives by prerequisite depth.

    Kata gives per-component ``order`` within a unit but no cross-objective order,
    so we derive a stable one: prerequisite depth first (a skill never precedes
    its prerequisite), then objective key for determinism. This is what the
    planner's linear ``frontier`` walk relies on.
    """
    ids = [oid for oid, o in objectives.items() if o["subject"] == subject]
    depth: dict[str, int] = {}

    def _depth(oid: str, seen: frozenset[str]) -> int:
        if oid in depth:
            return depth[oid]
        obj = objectives.get(oid)
        if not obj or oid in seen:
            return 0
        prereqs = [p for p in obj.get("prerequisites", []) if p in objectives]
        d = 0 if not prereqs else 1 + max(_depth(p, seen | {oid}) for p in prereqs)
        depth[oid] = d
        return d

    for oid in ids:
        _depth(oid, frozenset())
    return sorted(ids, key=lambda oid: (depth.get(oid, 0), oid))


def _build_snapshot(units: list[dict[str, Any]]) -> dict[str, Any]:
    objectives: dict[str, dict[str, Any]] = {}
    components: dict[str, dict[str, Any]] = {}
    components_by_obj: dict[str, list[str]] = {}
    units_by_id: dict[str, dict[str, Any]] = {}

    for unit in units:
        units_by_id[unit["id"]] = unit
        objective_id = unit["objective_id"]
        entry = objectives.get(objective_id)
        if entry is None:
            entry = {
                "id": objective_id,
                "subject": unit["subject"],
                "topic": unit["sub_topic"],       # dotted sub-topic key (label resolved in UI)
                "sub_topic": unit["sub_topic"],
                "prerequisites": [],
                "title": unit["title"],
                "titles": dict(unit.get("titles") or {}),
                "unit_ids": [],
            }
            objectives[objective_id] = entry
        # Merge across units that share an objective.
        entry["unit_ids"].append(unit["id"])
        for prereq in unit.get("prerequisites", []):
            if prereq not in entry["prerequisites"]:
                entry["prerequisites"].append(prereq)
        for component in unit["components"]:
            # Stamp objective onto the component so downstream reads are uniform.
            component = {**component, "objective_id": objective_id, "subject": unit["subject"]}
            components[component["id"]] = component
            components_by_obj.setdefault(objective_id, []).append(component["id"])

    by_subject: dict[str, list[str]] = {}
    subjects = {o["subject"] for o in objectives.values()}
    for subject in subjects:
        by_subject[subject] = _order_objectives(objectives, subject)
    # Assign a stable integer order per objective (planner reads o["order"]).
    for subject, ordered in by_subject.items():
        for index, oid in enumerate(ordered):
            objectives[oid]["order"] = index + 1

    return {
        "loaded_at": _now(),
        "objectives": objectives,
        "by_subject": by_subject,
        "components": components,
        "components_by_obj": components_by_obj,
        "units": units_by_id,
    }


async def ensure_loaded(force: bool = False) -> None:
    """Refresh the snapshot if stale/empty. Safe to call on every async entry."""
    fresh = (_now() - _SNAPSHOT["loaded_at"]) < _TTL_SECONDS and _SNAPSHOT["objectives"]
    if fresh and not force:
        return
    try:
        units = await kata_client.list_units()
    except kata_client.KataError:
        # Keep serving the last good snapshot on a transient Kata outage; only a
        # cold cache surfaces empty (callers already tolerate an empty spine).
        if _SNAPSHOT["objectives"]:
            return
        raise
    _SNAPSHOT.update(_build_snapshot(units))


async def refresh() -> None:
    await ensure_loaded(force=True)


# ── Sync accessors (read the primed snapshot) ─────────────────────────────────
def subjects() -> list[str]:
    return sorted(_SNAPSHOT["by_subject"].keys())


def objectives_for(subject: str) -> list[dict[str, Any]]:
    """Ordered objective spine for a subject (prerequisite depth, then key)."""
    ordered_ids = _SNAPSHOT["by_subject"].get(subject) or []
    return [_SNAPSHOT["objectives"][oid] for oid in ordered_ids]


def get_objective(objective_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["objectives"].get(objective_id)


def get_component(component_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["components"].get(component_id)


def components_for(objective_id: str) -> list[dict[str, Any]]:
    ids = _SNAPSHOT["components_by_obj"].get(objective_id) or []
    return [_SNAPSHOT["components"][cid] for cid in ids]


def get_unit(unit_id: str) -> Optional[dict[str, Any]]:
    return _SNAPSHOT["units"].get(unit_id)


def unit_type(unit_id: str) -> str:
    """Infer the 720 unit structure (720 §3.2): 'closed' | 'modular'.

    No explicit metadata field exists, so we infer from structure — a single
    component is a closed unit (the content navigates its own items; the platform
    does not sequence sub-components), multiple ordered components are modular
    (the platform navigates between them). 'hybrid' can't be distinguished from
    metadata today, so multi-component units are treated as modular.
    """
    unit = _SNAPSHOT["units"].get(unit_id) or {}
    return "closed" if len(unit.get("components") or []) <= 1 else "modular"


def localized_objective_title(objective_id: str, locale: str = "he") -> str:
    """Localized unit title for an objective; falls back to Hebrew then the key."""
    obj = _SNAPSHOT["objectives"].get(objective_id) or {}
    titles = obj.get("titles") or {}
    return titles.get(locale) or obj.get("title") or objective_id


def information_for_item(component_id: Optional[str], item_id: Optional[str]) -> Optional[str]:
    """The ``informationToBot`` for the exact sub-content item/question, if known,
    else the component-level aggregate. Powers mistake-aware hints (plan §8)."""
    component = get_component(component_id) if component_id else None
    if not component:
        return None
    by_item = component.get("information_by_item") or {}
    if item_id and item_id in by_item:
        return by_item[item_id]
    return component.get("information_to_bot")


def questions_for_item(
    component_id: Optional[str], item_id: Optional[str]
) -> list[dict]:
    """Server-only question snapshots (text/options/correct answer) for the exact
    sub-content item the learner is on — the coach's current-question context."""
    component = get_component(component_id) if component_id else None
    if not component or not item_id:
        return []
    return (component.get("questions_by_item") or {}).get(item_id) or []


# ── Player-screen → catalog-item reconciliation ──────────────────────────────
# Kata's PLAYER numbers the screens it reports over xAPI with a leading-cover
# offset: the first interactive screen is object `…-002`, not `…-001`. Kata's
# CATALOG numbers `subContent` items from `…-001`. So the raw runtime screen id
# is one (or more) items AHEAD of the catalog id for the SAME question — storing
# it verbatim made the coach ground every hint on the NEXT item (observed: a
# "50.00g / precision" hint while the learner was on a "12.1g outlier" question).
# We reconcile the two id spaces here, self-anchored from data (no magic offset):
#   1. If the answered question id is unique to one catalog item, it pins the
#      exact item (e.g. only `-001` carries a `q2`).
#   2. Else align by ordinal — the run of visited player screens maps in order
#      onto the catalog `subContent`; the earliest visited player screen is the
#      earliest catalog item, giving a constant offset K.
# Assumes the interleaved screens are a leading cover (constant offset), which
# holds for the linear 720 practice components. Returns the runtime id unchanged
# when the catalog is unknown or it cannot reconcile (best-effort, never raises).
import re as _re

_ITEM_SUFFIX_RE = _re.compile(r"-(\d+)$")


def _item_suffix(item_id: Optional[str]) -> Optional[int]:
    match = _ITEM_SUFFIX_RE.search(item_id or "")
    return int(match.group(1)) if match else None


def resolve_catalog_item_id(
    component_id: Optional[str],
    runtime_item_id: Optional[str],
    question_id: Optional[str] = None,
    seen_item_ids: Optional[list[str]] = None,
) -> Optional[str]:
    """Map a Kata player screen id to the catalog ``subContent`` id (see above)."""
    component = get_component(component_id) if component_id else None
    if not component or not runtime_item_id:
        return runtime_item_id
    qbi = component.get("questions_by_item") or {}
    if not qbi:
        return runtime_item_id
    catalog_ids = list(qbi.keys())
    catalog_suffix = {cid: _item_suffix(cid) for cid in catalog_ids}

    # 1. EXACT anchor: a question id owned by exactly one catalog item.
    if question_id:
        q = question_id.lower()
        owners = [
            cid for cid in catalog_ids
            if any((row.get("questionId") or "").lower() == q for row in (qbi.get(cid) or []))
        ]
        if len(owners) == 1:
            return owners[0]

    # 2. Ordinal anchor: earliest visited player screen == earliest catalog item.
    runtime_suffix = _item_suffix(runtime_item_id)
    valid_catalog = {c: s for c, s in catalog_suffix.items() if s is not None}
    if runtime_suffix is not None and valid_catalog:
        seen = [s for s in (_item_suffix(x) for x in (seen_item_ids or [])) if s is not None]
        seen.append(runtime_suffix)
        offset = min(seen) - min(valid_catalog.values())
        target = runtime_suffix - offset
        for cid, s in valid_catalog.items():
            if s == target:
                return cid

    # 3. Give up gracefully — keep the runtime id (identity may already be right
    #    for a 0-offset component; a wrong-but-present id is no worse than before).
    return runtime_item_id
