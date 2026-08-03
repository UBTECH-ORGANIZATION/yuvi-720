"""Persistence for teacher/student messaging threads and calendar events.

Mirrors the storage strategy in ``learner_state``: MongoDB is the source of
truth when configured, with a JSON file fallback so the demo stays operable
before credentials are in place.
"""

from __future__ import annotations

import json
import os
import uuid
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
FALLBACK_FILE = BASE_DIR / ".runtime" / "classroom.json"

EVENT_TYPES = {"meeting", "talk", "task", "deadline", "parents"}
MAX_MESSAGE_LENGTH = 2000
MAX_TITLE_LENGTH = 120

_mongo_client: Optional[Any] = None


def normalize_actor_id(value: Optional[str], fallback: str) -> str:
    """Keep participant ids safe to use as document keys."""
    actor_id = (value or fallback).strip()
    safe = "".join(ch for ch in actor_id if ch.isalnum() or ch in {"-", "_"})
    return safe or fallback


def thread_id_for(teacher_id: str, learner_id: str) -> str:
    return f"{teacher_id}__{learner_id}"


def _database_name() -> str:
    return os.environ.get("MONGODB_DATABASE") or os.environ.get("MONGODB_DB") or "yuvi720"


def _get_database() -> Optional[Any]:
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
    return _mongo_client[_database_name()]


def _read_fallback() -> dict[str, Any]:
    try:
        if FALLBACK_FILE.exists():
            data = json.loads(FALLBACK_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("threads", {})
                data.setdefault("events", {})
                return data
    except (OSError, json.JSONDecodeError) as exc:
        print(f"⚠️ Failed reading classroom fallback: {exc}")
    return {"threads": {}, "events": {}}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        FALLBACK_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ Failed writing classroom fallback: {exc}")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================ MESSAGES ============================


def _empty_thread(teacher_id: str, learner_id: str) -> dict[str, Any]:
    return {
        "thread_id": thread_id_for(teacher_id, learner_id),
        "teacher_id": teacher_id,
        "learner_id": learner_id,
        "messages": [],
        "unread_teacher": 0,
        "unread_learner": 0,
        "updated_at": _now(),
    }


def _public_thread(document: Optional[dict[str, Any]], teacher_id: str, learner_id: str) -> dict[str, Any]:
    thread = _empty_thread(teacher_id, learner_id)
    if document:
        for key in thread:
            if key in document:
                thread[key] = document[key]
    return thread


async def get_thread(teacher_id: str, learner_id: str) -> dict[str, Any]:
    key = thread_id_for(teacher_id, learner_id)
    database = _get_database()
    if database is not None:
        try:
            document = await database["classroom_messages"].find_one({"_id": key})
            return _public_thread(document, teacher_id, learner_id)
        except Exception as exc:
            print(f"⚠️ Mongo thread read failed, using fallback: {exc}")

    data = _read_fallback()
    return _public_thread(data["threads"].get(key), teacher_id, learner_id)


async def list_threads(teacher_id: str) -> list[dict[str, Any]]:
    database = _get_database()
    if database is not None:
        try:
            cursor = database["classroom_messages"].find({"teacher_id": teacher_id})
            documents = await cursor.to_list(length=200)
            return [_public_thread(doc, teacher_id, doc.get("learner_id", "")) for doc in documents]
        except Exception as exc:
            print(f"⚠️ Mongo thread list failed, using fallback: {exc}")

    data = _read_fallback()
    return [
        _public_thread(doc, teacher_id, doc.get("learner_id", ""))
        for doc in data["threads"].values()
        if doc.get("teacher_id") == teacher_id
    ]


async def append_message(teacher_id: str, learner_id: str, sender: str, text: str) -> dict[str, Any]:
    """Add one message. ``sender`` is 'teacher' or 'learner'."""
    thread = await get_thread(teacher_id, learner_id)
    thread["messages"].append(
        {
            "id": uuid.uuid4().hex,
            "from": sender,
            "text": text[:MAX_MESSAGE_LENGTH],
            "sent_at": _now(),
        }
    )
    # The message is unread for whoever did not send it.
    if sender == "teacher":
        thread["unread_learner"] = int(thread.get("unread_learner", 0)) + 1
    else:
        thread["unread_teacher"] = int(thread.get("unread_teacher", 0)) + 1
    thread["updated_at"] = _now()
    return await _save_thread(thread)


async def mark_thread_read(teacher_id: str, learner_id: str, reader: str) -> dict[str, Any]:
    thread = await get_thread(teacher_id, learner_id)
    if reader == "teacher":
        thread["unread_teacher"] = 0
    else:
        thread["unread_learner"] = 0
    return await _save_thread(thread)


async def _save_thread(thread: dict[str, Any]) -> dict[str, Any]:
    key = thread["thread_id"]
    database = _get_database()
    if database is not None:
        try:
            await database["classroom_messages"].update_one({"_id": key}, {"$set": thread}, upsert=True)
            return thread
        except Exception as exc:
            print(f"⚠️ Mongo thread write failed, using fallback: {exc}")

    data = _read_fallback()
    data["threads"][key] = thread
    _write_fallback(data)
    return thread


# ============================ CALENDAR ============================


def _public_event(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "event_id": document.get("event_id", ""),
        "owner_id": document.get("owner_id", ""),
        "date": document.get("date", ""),
        "time": document.get("time", ""),
        "type": document.get("type", "meeting"),
        "title": document.get("title", ""),
        "notes": document.get("notes", ""),
    }


async def list_events(owner_id: str) -> list[dict[str, Any]]:
    database = _get_database()
    if database is not None:
        try:
            cursor = database["calendar_events"].find({"owner_id": owner_id})
            documents = await cursor.to_list(length=500)
            return sorted(
                (_public_event(doc) for doc in documents),
                key=lambda event: (event["date"], event["time"]),
            )
        except Exception as exc:
            print(f"⚠️ Mongo event list failed, using fallback: {exc}")

    data = _read_fallback()
    return sorted(
        (_public_event(doc) for doc in data["events"].values() if doc.get("owner_id") == owner_id),
        key=lambda event: (event["date"], event["time"]),
    )


async def create_event(owner_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    event = {
        "event_id": uuid.uuid4().hex,
        "owner_id": owner_id,
        "date": str(payload.get("date", ""))[:10],
        "time": str(payload.get("time", ""))[:20],
        "type": payload.get("type") if payload.get("type") in EVENT_TYPES else "meeting",
        "title": str(payload.get("title", ""))[:MAX_TITLE_LENGTH],
        "notes": str(payload.get("notes", ""))[:MAX_MESSAGE_LENGTH],
        "updated_at": _now(),
    }
    return await _save_event(event)


async def update_event(owner_id: str, event_id: str, payload: dict[str, Any]) -> Optional[dict[str, Any]]:
    existing = await _find_event(owner_id, event_id)
    if existing is None:
        return None
    for field, limit in (("date", 10), ("time", 20), ("title", MAX_TITLE_LENGTH), ("notes", MAX_MESSAGE_LENGTH)):
        if field in payload:
            existing[field] = str(payload[field])[:limit]
    if payload.get("type") in EVENT_TYPES:
        existing["type"] = payload["type"]
    existing["updated_at"] = _now()
    return await _save_event(existing)


async def delete_event(owner_id: str, event_id: str) -> bool:
    database = _get_database()
    if database is not None:
        try:
            result = await database["calendar_events"].delete_one({"_id": event_id, "owner_id": owner_id})
            return result.deleted_count > 0
        except Exception as exc:
            print(f"⚠️ Mongo event delete failed, using fallback: {exc}")

    data = _read_fallback()
    document = data["events"].get(event_id)
    if not document or document.get("owner_id") != owner_id:
        return False
    del data["events"][event_id]
    _write_fallback(data)
    return True


async def _find_event(owner_id: str, event_id: str) -> Optional[dict[str, Any]]:
    database = _get_database()
    if database is not None:
        try:
            return await database["calendar_events"].find_one({"_id": event_id, "owner_id": owner_id})
        except Exception as exc:
            print(f"⚠️ Mongo event read failed, using fallback: {exc}")

    data = _read_fallback()
    document = data["events"].get(event_id)
    return document if document and document.get("owner_id") == owner_id else None


async def _save_event(event: dict[str, Any]) -> dict[str, Any]:
    database = _get_database()
    if database is not None:
        try:
            await database["calendar_events"].update_one(
                {"_id": event["event_id"]}, {"$set": event}, upsert=True
            )
            return _public_event(event)
        except Exception as exc:
            print(f"⚠️ Mongo event write failed, using fallback: {exc}")

    data = _read_fallback()
    data["events"][event["event_id"]] = event
    _write_fallback(data)
    return _public_event(event)
