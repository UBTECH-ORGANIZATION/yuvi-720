"""Async persistence for the Learner Brain (`learners` collection).

MongoDB/Cosmos is the source of truth (architecture doc). A JSON fallback keeps
the demo alive locally before credentials/deps are ready — never the prod path
(§15 R11). Writes are **field-scoped `$set`** with an optimistic `version` bump
(never whole-document replace) so the trigger engine + several agents can update
the brain without clobbering each other (§15 R3).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import certifi
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:  # pragma: no cover - local fallback path
    certifi = None
    AsyncIOMotorClient = None

from app.core.env import ensure_env_loaded  # side-effect: .env for ANY entrypoint
from app.brain.schema import empty_brain, flatten_updates
from app.brain.memory import ensure_memory_state

# Reuse the demo learner id + id normalization already used by learner_state.
from learner_state import (  # type: ignore
    DEFAULT_LEARNER_ID,
    normalize_learner_id,
    get_learner_state,
)


BASE_DIR = Path(__file__).resolve().parents[2]
FALLBACK_BRAIN_FILE = BASE_DIR / ".runtime" / "learners_brain.json"

_mongo_client: Optional[Any] = None


def _database_name() -> str:
    return os.environ.get("MONGODB_DATABASE") or os.environ.get("MONGODB_DB") or "yuvi720"


def _get_collection() -> Optional[Any]:
    global _mongo_client
    connection_string = os.environ.get("MONGODB_CONNECTION_STRING")
    if not connection_string or AsyncIOMotorClient is None:
        return None
    if _mongo_client is None:
        kwargs: dict[str, Any] = {
            "serverSelectionTimeoutMS": 5000,
            "connectTimeoutMS": 5000,
            "socketTimeoutMS": 10000,
        }
        if certifi is not None:
            kwargs["tlsCAFile"] = certifi.where()
        _mongo_client = AsyncIOMotorClient(connection_string, **kwargs)
    return _mongo_client[_database_name()]["learners"]


def _get_collection_named(name: str) -> Optional[Any]:
    """Return any collection in the app database, reusing the shared client.

    Sibling services (e.g. `learning_events`) call this so the whole app shares
    one Mongo client.
    """
    if _get_collection() is None:   # lazily initializes _mongo_client
        return None
    return _mongo_client[_database_name()][name]


def _read_fallback() -> dict[str, Any]:
    try:
        if FALLBACK_BRAIN_FILE.exists():
            return json.loads(FALLBACK_BRAIN_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading brain fallback: {exc}")
    return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        FALLBACK_BRAIN_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_BRAIN_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ Failed writing brain fallback: {exc}")


def _apply_flat(doc: dict[str, Any], flat: dict[str, Any]) -> None:
    """Apply dotted `$set` updates onto an in-memory dict (fallback path)."""
    for path, value in flat.items():
        parts = path.split(".")
        node = doc
        for part in parts[:-1]:
            nxt = node.get(part)
            if not isinstance(nxt, dict):   # replace null/scalar intermediates
                nxt = {}
                node[part] = nxt
            node = nxt
        node[parts[-1]] = value


async def migrate_learner_state(learner_id: str) -> dict[str, Any]:
    """Fold legacy `learner_state` fields into a fresh brain document (§9, P0).

    `language → identity.locale`, `mapping_results → profile.mapping_scores`,
    `game_progress → mastery/current_state`. Cache blobs (`profile_cache`,
    `dashboard_cache`) are intentionally dropped — the brain never caches
    invented output; the dashboard is computed on read.
    """
    try:
        legacy = await get_learner_state(learner_id)
    except Exception as exc:  # pragma: no cover - defensive
        print(f"⚠️ learner_state migration read failed: {exc}")
        legacy = {}

    brain = empty_brain(learner_id, locale=legacy.get("language") or "he")
    mapping = legacy.get("mapping_results")
    if mapping:
        # Legacy blobs stored the full result object; the brain keeps only scores.
        brain["profile"]["mapping_scores"] = (
            mapping.get("scores", mapping) if isinstance(mapping, dict) else mapping
        )
        display_name = mapping.get("student_name") if isinstance(mapping, dict) else None
        if display_name:
            brain["identity"]["display_name"] = display_name   # UI-only (§4.1)
    game_progress = legacy.get("game_progress") or {}
    if isinstance(game_progress, dict) and game_progress:
        # Preserve any prior progress as opaque current_state until real xAPI
        # events (P1) repopulate `mastery`. We do NOT invent mastery numbers.
        brain["current_state"]["resume_token"] = game_progress
    return brain


async def get_brain(learner_id: Optional[str] = None) -> dict[str, Any]:
    """Return the brain document, creating (and migrating) it on first access."""
    safe_id = normalize_learner_id(learner_id)
    collection = _get_collection()
    if collection is not None:
        try:
            document = await collection.find_one({"_id": safe_id})
            if document:
                migrated, changed = ensure_memory_state(document)
                if changed:
                    await collection.update_one(
                        {"_id": safe_id},
                        {
                            "$set": {
                                "memory": migrated["memory"],
                                "updated_at": datetime.now(timezone.utc).isoformat(),
                            },
                            "$inc": {"version": 1},
                        },
                    )
                return migrated
            brain = await migrate_learner_state(safe_id)
            await collection.update_one(
                {"_id": safe_id}, {"$setOnInsert": brain}, upsert=True
            )
            return brain
        except Exception as exc:
            print(f"⚠️ Mongo brain read failed, using fallback: {exc}")

    data = _read_fallback()
    if safe_id in data:
        migrated, changed = ensure_memory_state(data[safe_id])
        if changed:
            migrated["version"] = int(migrated.get("version", 1)) + 1
            migrated["updated_at"] = datetime.now(timezone.utc).isoformat()
            data[safe_id] = migrated
            _write_fallback(data)
        return migrated
    brain = await migrate_learner_state(safe_id)
    data[safe_id] = brain
    _write_fallback(data)
    return brain


async def apply_brain_updates(
    learner_id: Optional[str], updates: dict[str, Any]
) -> dict[str, Any]:
    """Field-scoped `$set` write with a `version` bump (never whole-doc replace).

    `updates` may be dotted ({"profile.interests": [...]}) or nested; both are
    normalized to dotted `$set` keys. Scope enforcement lives in
    `context_engine.apply_writes` — call that, not this, from agent code.
    """
    safe_id = normalize_learner_id(learner_id)
    await get_brain(safe_id)  # ensure the document exists (+ migration)

    flat = flatten_updates(updates)
    flat.pop("_id", None)
    flat.pop("version", None)
    flat["updated_at"] = datetime.now(timezone.utc).isoformat()

    collection = _get_collection()
    if collection is not None:
        try:
            await collection.update_one(
                {"_id": safe_id},
                {"$set": flat, "$inc": {"version": 1}},
                upsert=True,
            )
            return await get_brain(safe_id)
        except Exception as exc:
            print(f"⚠️ Mongo brain write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(safe_id) or empty_brain(safe_id)
    _apply_flat(current, flat)
    current["version"] = int(current.get("version", 1)) + 1
    data[safe_id] = current
    _write_fallback(data)
    return current
