"""Yuvilab-authored content provider — the second source behind the 720 catalog.

Kata (CET) publishes the ministry's math + science catalog. It publishes **no
English**, so for "אנגלית לכולם" we are the content provider: units, components,
items and questions are authored here, under `backend/content/english/`, and
generated components land in the Mongo collection `content_units`.

The whole point of this module is that the platform cannot tell the difference.
It exposes the same async surface as :mod:`app.services.kata_client`
(``list_units`` / ``get_unit`` / ``resolve_component`` / ``list_objectives`` /
``create_launch_context`` + ``ContentProviderError``) and runs every authored row
through Kata's own ``normalize_*`` functions, so shape drift is structurally
impossible and the planner, learning path, dashboard, insights and LRS reporting
all work on English without knowing it exists.

Two extra accessors exist for our own player, which Kata has no equivalent of:
``get_raw_unit`` / ``get_raw_component`` return the AUTHORED document (audio
scripts, passages, glossaries, feedback copy). The normalized shape is what the
*platform* routes on; the raw shape is what the *content* renders from.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from app.services.kata_client import (
    ContentProviderError,
    KataError,
    normalize_component,
    normalize_objective,
    normalize_unit,
)

SOURCE = "yuvilab"
COLLECTION = "content_units"

CONTENT_DIR = Path(__file__).resolve().parents[2] / "content"

# Authored content changes when a file changes or the generator writes a row, not
# on a clock, so the cache is invalidated explicitly (and by file mtime) rather
# than on a TTL like the remote Kata snapshot.
_cache: dict[str, Any] = {"units": {}, "objectives": {}, "stamp": None}


class NativeContentError(KataError):
    """Same contract as ``KataError`` so call sites catch one error type."""


__all__ = [
    "ContentProviderError",
    "NativeContentError",
    "SOURCE",
    "COLLECTION",
    "create_launch_context",
    "get_raw_component",
    "get_raw_unit",
    "get_unit",
    "invalidate",
    "list_objectives",
    "list_units",
    "player_url",
    "resolve_component",
]


# ── disk ─────────────────────────────────────────────────────────────────────
def _content_roots() -> list[Path]:
    override = os.environ.get("NATIVE_CONTENT_DIR")
    root = Path(override) if override else CONTENT_DIR
    return [path for path in sorted(root.glob("*")) if path.is_dir()]


def _disk_stamp() -> tuple:
    """A cheap fingerprint of every authored file, so an edit reloads at once."""
    stamp: list[tuple[str, float]] = []
    for root in _content_roots():
        for path in sorted(root.rglob("*.json")):
            try:
                stamp.append((str(path), path.stat().st_mtime))
            except OSError:
                continue
    return tuple(stamp)


def _read_json(path: Path) -> Optional[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ authored content unreadable ({path.name}): {type(exc).__name__}")
        return None
    return payload if isinstance(payload, dict) else None


def _registry_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Expand our compact objectives file into full Kata registry rows.

    The file declares the shared hierarchy once and then lists the goals; Kata
    repeats the hierarchy on every row. Expanding here keeps the authored file
    readable without teaching ``normalize_objective`` a second shape.
    """
    shared = {
        key: payload[key]
        for key in ("curriculum", "subjectArea", "topic", "subtopic")
        if isinstance(payload.get(key), dict)
    }
    rows: list[dict[str, Any]] = []
    for goal in payload.get("objectives") or []:
        if isinstance(goal, dict) and goal.get("id"):
            rows.append({**shared, **goal})
    return rows


def _load_disk() -> tuple[dict[str, Any], dict[str, Any]]:
    units: dict[str, Any] = {}
    objectives: dict[str, Any] = {}
    for root in _content_roots():
        registry = root / "objectives.json"
        if registry.exists():
            payload = _read_json(registry)
            if payload:
                for row in _registry_rows(payload):
                    objectives[str(row["id"])] = row
        for path in sorted((root / "units").glob("*.json")):
            unit = _read_json(path)
            if unit and unit.get("id"):
                units[str(unit["id"])] = unit
    return units, objectives


# ── Mongo (generated content) ────────────────────────────────────────────────
def _collection():
    from app.brain.repository import _get_collection_named
    return _get_collection_named(COLLECTION)


async def _load_generated() -> dict[str, Any]:
    """Units the authoring generator wrote. Merged OVER disk by unit id."""
    collection = _collection()
    if collection is None:
        return {}
    units: dict[str, Any] = {}
    try:
        cursor = collection.find({"source": SOURCE}, {"_id": 0})
        async for row in cursor:
            unit = row.get("unit") if isinstance(row.get("unit"), dict) else row
            if isinstance(unit, dict) and unit.get("id"):
                units[str(unit["id"])] = unit
    except Exception as exc:  # a Mongo outage must not hide the authored catalog
        print(f"⚠️ generated content unavailable: {type(exc).__name__}")
    return units


async def _snapshot() -> dict[str, Any]:
    stamp = _disk_stamp()
    if _cache["stamp"] != stamp:
        units, objectives = _load_disk()
        _cache.update({"units": units, "objectives": objectives, "stamp": stamp})
    generated = await _load_generated()
    if not generated:
        return {"units": _cache["units"], "objectives": _cache["objectives"]}
    return {
        "units": {**_cache["units"], **generated},
        "objectives": _cache["objectives"],
    }


def invalidate() -> None:
    """Drop the disk cache — called after the generator writes."""
    _cache["stamp"] = None


# ── provider surface (mirrors kata_client) ───────────────────────────────────
async def list_objectives(language: Optional[str] = None) -> list[dict[str, Any]]:
    """Our slice of the ministry goal registry, normalized like Kata's."""
    snapshot = await _snapshot()
    return [normalize_objective(row) for row in snapshot["objectives"].values()]


def _normalized(unit: dict[str, Any], language: Optional[str] = None) -> dict[str, Any]:
    """Normalize, then answer in the asked-for language.

    Kata returns a unit already rendered in the requested locale, so ``title``
    is what the platform shows. We hold every locale at once, which means the
    top-level title has to be picked here or a Hebrew learner reads the English
    working title of the unit.
    """
    normalized = {**normalize_unit(unit), "source": SOURCE}
    title = (normalized.get("titles") or {}).get(str(language or ""))
    if title:
        normalized["title"] = title
    return normalized


async def list_units(language: Optional[str] = None, **filters: Any) -> list[dict[str, Any]]:
    snapshot = await _snapshot()
    units = [_normalized(unit, language) for unit in snapshot["units"].values()]
    objective = filters.get("learningObjective") or filters.get("learning_objective")
    if objective:
        units = [unit for unit in units if unit.get("objective_id") == objective]
    return units


async def get_unit(unit_id: str, language: Optional[str] = None) -> dict[str, Any]:
    snapshot = await _snapshot()
    unit = snapshot["units"].get(str(unit_id))
    if not unit:
        raise NativeContentError("content_not_found", 404)
    return _normalized(unit, language)


async def resolve_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    snapshot = await _snapshot()
    candidates = (
        [snapshot["units"][str(unit_id)]]
        if unit_id and str(unit_id) in snapshot["units"]
        else list(snapshot["units"].values())
    )
    for raw in candidates:
        for component in raw.get("components") or []:
            if str(component.get("id")) == str(component_id):
                return _normalized(raw), normalize_component(component)
    raise NativeContentError("content_not_found", 404)


# ── raw accessors (the player's view, never the platform's) ──────────────────
async def get_raw_unit(unit_id: str) -> Optional[dict[str, Any]]:
    snapshot = await _snapshot()
    return snapshot["units"].get(str(unit_id))


async def get_raw_component(
    component_id: str,
    unit_id: Optional[str] = None,
) -> Optional[tuple[dict[str, Any], dict[str, Any]]]:
    """``(raw_unit, raw_component)`` as authored — audio scripts, feedback, keys."""
    snapshot = await _snapshot()
    candidates = (
        [snapshot["units"][str(unit_id)]]
        if unit_id and str(unit_id) in snapshot["units"]
        else list(snapshot["units"].values())
    )
    for raw in candidates:
        for component in raw.get("components") or []:
            if str(component.get("id")) == str(component_id):
                return raw, component
    return None


# ── launch ───────────────────────────────────────────────────────────────────
def player_url(component_id: str, slxapi: dict[str, Any], *, base_url: str = "") -> str:
    """Our lomda player URL, carrying the launch exactly as an iframe would.

    ``slxapi`` is the same stringified-JSON initialization parameter Kata's
    player receives, so the page is launchable from a 720 platform with no
    Yuvilab session — the token in the URL is the only credential it needs.
    """
    payload = quote(json.dumps(slxapi, separators=(",", ":"), ensure_ascii=False))
    return f"{base_url.rstrip('/')}/content/player/{quote(component_id)}?slxapi={payload}"


async def create_launch_context(
    *,
    component_id: str,
    student_id: str,
    platform_url: str,
    lrs_endpoint: str,
    lrs_auth: str,
    student_name: Optional[str] = None,
    slxapi: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Kata-shaped launch context, served by our own player instead of Kata's.

    No HTTP call and no relay hop: the player is on our origin and reports xAPI
    straight to our ingest, which is why the English demo has no dependency on a
    public tunnel.
    """
    resolved = await get_raw_component(component_id)
    if not resolved:
        raise NativeContentError("content_not_found", 404)
    context = slxapi or {
        "endpoint": lrs_endpoint,
        "auth": lrs_auth,
        "actor": {"account": {"name": student_id, "homePage": platform_url}},
    }
    return {
        "launch_url": player_url(component_id, context, base_url=""),
        "registration_id": None,
    }
