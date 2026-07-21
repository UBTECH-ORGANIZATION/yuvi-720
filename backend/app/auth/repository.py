"""Async persistence for local accounts (`users` collection).

Deliberately a **separate collection from `learners`**: the brain document is
returned wholesale to the browser by `GET /api/brain/{id}`, is written
concurrently by agents, and is rebuilt wholesale by seeding/migration tooling.
Credentials belong in none of those blast radii.

`_id` == `user_id` == `learner_id`, so user `gal` owns brain `gal` and every
existing learner_id-keyed collection keeps working with no join.

Mongo is the source of truth; the JSON fallback keeps dev machines without
`MONGODB_CONNECTION_STRING` usable — never the prod path.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.brain.repository import _get_collection_named  # shared Mongo client

BASE_DIR = Path(__file__).resolve().parents[2]
FALLBACK_USERS_FILE = BASE_DIR / ".runtime" / "users.json"

DEFAULT_PREFERENCES: dict[str, Any] = {
    "theme": "system",
    "language": "he",
    "reduced_motion": False,
}
ALLOWED_PREFERENCES = set(DEFAULT_PREFERENCES)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _collection() -> Optional[Any]:
    return _get_collection_named("users")


def _read_fallback() -> dict[str, Any]:
    try:
        if FALLBACK_USERS_FILE.exists():
            return json.loads(FALLBACK_USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading users fallback: {exc}")
    return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        FALLBACK_USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_USERS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ Failed writing users fallback: {exc}")


def normalize_username(value: str) -> str:
    return (value or "").strip().lower()


def public_user(document: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Strip credentials. EVERY read that reaches a client must go through this."""
    if not document:
        return None
    preferences = {**DEFAULT_PREFERENCES, **(document.get("preferences") or {})}
    return {
        "user_id": document.get("_id") or document.get("user_id"),
        "username": document.get("username"),
        "display_name": document.get("display_name"),
        "roles": list(document.get("roles") or []),
        "preferences": preferences,
    }


async def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is not None:
        try:
            return await collection.find_one({"_id": user_id})
        except Exception as exc:
            print(f"⚠️ Mongo users read failed, using fallback: {exc}")
    return _read_fallback().get(user_id)


async def get_user_by_username(username: str) -> Optional[dict[str, Any]]:
    handle = normalize_username(username)
    if not handle:
        return None
    collection = _collection()
    if collection is not None:
        try:
            return await collection.find_one({"username": handle})
        except Exception as exc:
            print(f"⚠️ Mongo users read failed, using fallback: {exc}")
    for document in _read_fallback().values():
        if document.get("username") == handle:
            return document
    return None


async def upsert_user(document: dict[str, Any]) -> dict[str, Any]:
    user_id = document["_id"]
    payload = {**document, "updated_at": _now()}
    payload.setdefault("created_at", payload["updated_at"])
    payload.setdefault("preferences", dict(DEFAULT_PREFERENCES))

    collection = _collection()
    if collection is not None:
        try:
            await collection.update_one({"_id": user_id}, {"$set": payload}, upsert=True)
            return payload
        except Exception as exc:
            print(f"⚠️ Mongo users write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(user_id) or {}
    current.update(payload)
    data[user_id] = current
    _write_fallback(data)
    return current


async def _set_fields(user_id: str, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    collection = _collection()
    if collection is not None:
        try:
            await collection.update_one({"_id": user_id}, {"$set": fields})
            return await get_user_by_id(user_id)
        except Exception as exc:
            print(f"⚠️ Mongo users write failed, using fallback: {exc}")

    data = _read_fallback()
    current = data.get(user_id)
    if current is None:
        return None
    for key, value in fields.items():
        if "." in key:  # dotted path, one level is all we need
            head, tail = key.split(".", 1)
            current.setdefault(head, {})[tail] = value
        else:
            current[key] = value
    data[user_id] = current
    _write_fallback(data)
    return current


async def update_preferences(user_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Whitelist-validated preference write. Returns the full preference set."""
    fields = {
        f"preferences.{key}": value
        for key, value in updates.items()
        if key in ALLOWED_PREFERENCES
    }
    fields["updated_at"] = _now()
    document = await _set_fields(user_id, fields)
    return {**DEFAULT_PREFERENCES, **((document or {}).get("preferences") or {})}


async def touch_last_login(user_id: str) -> None:
    await _set_fields(user_id, {"last_login_at": _now()})


async def set_current_moe_session(user_id: str, session_id: Optional[str]) -> None:
    """Track the learner's active MoE LRS sessionId (minted at login, cleared
    at logout) so server-side event forwarding can stamp the right session."""
    await _set_fields(user_id, {"current_moe_session_id": session_id})


async def set_agency_started_at(user_id: str, value: Optional[str]) -> None:
    """Onboarding span marker: set on first mapping load, cleared on completion
    (drives the agency `completed` duration = results-approved − mapping-start)."""
    await _set_fields(user_id, {"agency_started_at": value})
