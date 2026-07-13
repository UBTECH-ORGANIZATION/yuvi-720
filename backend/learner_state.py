"""Persistence helpers for learner UI state.

MongoDB is the source of truth when configured. A small JSON fallback keeps the
demo usable in local environments before dependencies or credentials are ready.
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


BASE_DIR = Path(__file__).resolve().parent.parent
FALLBACK_STATE_FILE = BASE_DIR / ".runtime" / "learner_state.json"
DEFAULT_LEARNER_ID = "demo-learner"

_mongo_client: Optional[Any] = None


def normalize_learner_id(value: Optional[str]) -> str:
    """Keep demo learner ids predictable and safe for document keys."""
    learner_id = (value or DEFAULT_LEARNER_ID).strip()
    safe = "".join(ch for ch in learner_id if ch.isalnum() or ch in {"-", "_"})
    return safe or DEFAULT_LEARNER_ID


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
        "mapping_results": None,
        "mapping_progress": None,
        "profile_summary_progress": None,
        "profile_cache": None,
        "dashboard_cache": None,
        "game_progress": {},
        "avatar": None,
        "avatar_unlocks": [],
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
    allowed = {
        "language", "mapping_results", "mapping_progress", "profile_summary_progress",
        "profile_cache", "dashboard_cache", "game_progress", "avatar", "avatar_unlocks",
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