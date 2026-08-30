"""Persistence helpers for learner UI state.

MongoDB is the source of truth when configured. A small JSON fallback keeps the
demo usable in local environments before dependencies or credentials are ready.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

try:
    import certifi
    from motor.motor_asyncio import AsyncIOMotorClient
except ImportError:  # pragma: no cover - local fallback path
    certifi = None
    AsyncIOMotorClient = None

from app.core import database as db_config


BASE_DIR = Path(__file__).resolve().parent.parent
FALLBACK_STATE_FILE = BASE_DIR / ".runtime" / "learner_state.json"
DEFAULT_LEARNER_ID = "demo-learner"

_mongo_client: Optional[Any] = None


def normalize_learner_id(value: Optional[str]) -> str:
    """Sanitize a learner id for use as a document key.

    Deliberately raises instead of substituting a default: an unauthenticated or
    mis-wired route must fail loudly rather than silently read and write some
    other account. (This function used to fall back to ``demo-learner``, which
    is how every route in the app ended up sharing one anonymous identity.)
    """
    safe = "".join(ch for ch in (value or "").strip() if ch.isalnum() or ch in {"-", "_"})
    if not safe:
        raise ValueError("learner_id is required")
    return safe


def _database_name() -> str:
    return db_config.database_name()


def _get_collection() -> Optional[Any]:
    global _mongo_client
    db_config.verify_configuration()  # never open a store this process may not use
    connection_string = db_config.connection_string()
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
    return _mongo_client[_database_name()]["learner_state"]


def _read_fallback() -> dict[str, Any]:
    try:
        if FALLBACK_STATE_FILE.exists():
            return json.loads(FALLBACK_STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading learner state fallback: {exc}")
    return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        FALLBACK_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_STATE_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ Failed writing learner state fallback: {exc}")


def _empty_state(learner_id: str) -> dict[str, Any]:
    return {
        "learner_id": learner_id,
        "language": "he",
        "gender": None,
        "mapping_results": None,
        "mapping_progress": None,
        "profile_summary_progress": None,
        "profile_cache": None,
        "dashboard_cache": None,
        "game_progress": {},
        "avatar": None,
        "avatar_unlocks": [],
        "room_unlocks": [],
        "badges": [],
        "room": None,
        "activeness_map": None,
        "mentoring_draft": None,
    }


def _public_state(document: Optional[dict[str, Any]], learner_id: str) -> dict[str, Any]:
    state = _empty_state(learner_id)
    if document:
        for key in state:
            if key in document:
                state[key] = document[key]
    return state


async def get_learner_state(learner_id: Optional[str] = None) -> dict[str, Any]:
    safe_id = normalize_learner_id(learner_id)
    collection = _get_collection()
    if collection is not None:
        try:
            document = await collection.find_one({"_id": safe_id})
            return _public_state(document, safe_id)
        except Exception as exc:
            print(f"⚠️ Mongo learner state read failed, using fallback: {exc}")

    data = _read_fallback()
    return _public_state(data.get(safe_id), safe_id)


async def update_learner_state(learner_id: Optional[str], updates: dict[str, Any]) -> dict[str, Any]:
    safe_id = normalize_learner_id(learner_id)
    # `avatar_unlocks` is deliberately NOT here: cosmetics are earned, so only
    # the server may grant them (see grant_avatar_unlock / services.rewards).
    # `room_unlocks` is out for the same reason — and because `room` itself is
    # writable, the room items are additionally screened on the way in.
    # `theme` is NOT here either: it lives on the user document
    # (`preferences.theme`) so one account keeps one theme across devices.
    # `badges` is NOT here: they are a projection of the brain computed by
    # services.badges.project_badges and served from /api/badges, so there is
    # nothing for a client to write — a stored copy could only go stale.
    allowed = {
        "language", "gender", "mapping_results", "mapping_progress", "profile_summary_progress",
        "profile_cache", "dashboard_cache", "game_progress", "avatar", "room",
        "activeness_map", "mentoring_draft",
    }
    now = datetime.now(timezone.utc).isoformat()
    set_data = {key: value for key, value in updates.items() if key in allowed}
    set_data["learner_id"] = safe_id
    set_data["updated_at"] = now

    collection = _get_collection()
    if collection is not None:
        try:
            await collection.update_one({"_id": safe_id}, {"$set": set_data}, upsert=True)
            return await get_learner_state(safe_id)
        except Exception as exc:
            print(f"⚠️ Mongo learner state write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(safe_id) or _empty_state(safe_id)
    current.update(set_data)
    data[safe_id] = current
    _write_fallback(data)
    return _public_state(current, safe_id)


async def grant_avatar_unlock(learner_id: Optional[str], asset_id: str) -> list[str]:
    """Server-only write path for earned Yuvi cosmetics."""
    return await _grant_unlock(learner_id, "avatar_unlocks", asset_id)


async def grant_room_unlock(learner_id: Optional[str], item_id: str) -> list[str]:
    """Server-only write path for earned room furniture."""
    return await _grant_unlock(learner_id, "room_unlocks", item_id)


async def _grant_unlock(learner_id: Optional[str], field: str, asset_id: str) -> list[str]:
    """Add one earned id to a server-owned list.

    These fields are kept out of `update_learner_state`'s allow-list so a client
    cannot grant itself a locked item; the rewards/unlocks services are the only
    callers.
    """
    safe_id = normalize_learner_id(learner_id)
    now = datetime.now(timezone.utc).isoformat()

    collection = _get_collection()
    if collection is not None:
        try:
            await collection.update_one(
                {"_id": safe_id},
                {
                    "$addToSet": {field: asset_id},
                    "$set": {"learner_id": safe_id, "updated_at": now},
                },
                upsert=True,
            )
            state = await get_learner_state(safe_id)
            return list(state.get(field) or [])
        except Exception as exc:
            print(f"⚠️ Mongo {field} write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(safe_id) or _empty_state(safe_id)
    unlocks = list(current.get(field) or [])
    if asset_id not in unlocks:
        unlocks.append(asset_id)
    current[field] = unlocks
    current["learner_id"] = safe_id
    current["updated_at"] = now
    data[safe_id] = current
    _write_fallback(data)
    return unlocks