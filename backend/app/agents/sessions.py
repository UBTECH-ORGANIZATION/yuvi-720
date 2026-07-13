"""Coach working memory plus durable, paginated conversation history.

``agent_sessions`` remains the bounded prompt window required by §4.5. The
learner-visible transcript is append-only in ``agent_messages`` and indexed by
``agent_conversations`` so opening the panel never loads every past message.
All keys use the pseudonymous learner id; no browser storage or identity data is
involved. A JSON fallback keeps the local demo usable without Mongo/Cosmos.
"""

from __future__ import annotations

import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Any, Optional
from uuid import uuid4

from app.agents.safety import strip_pii
from app.brain.repository import _get_collection_named
from learner_state import normalize_learner_id  # type: ignore

MAX_TURNS = 20                      # verbatim window cap (R2 — brain stays compact)
MAX_ROLLING_SUMMARY_ITEMS = 6
MAX_ENTITY_LEDGER_ITEMS = 12
_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "agent_sessions.json"
_HISTORY_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "agent_chat_history.json"
_SESSION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
_ACTIVITY_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$")
_indexes_ready = False


def normalize_session_id(value: object) -> str:
    """Return a safe opaque thread id; legacy callers continue on ``default``."""
    candidate = str(value or "default").strip()
    return candidate if _SESSION_ID.fullmatch(candidate) else "default"


def normalize_activity_id(value: object) -> Optional[str]:
    """Return one bounded provider identifier, never arbitrary URL/text data."""
    candidate = str(value or "").strip()
    return candidate if _ACTIVITY_ID.fullmatch(candidate) else None


def _key(learner_id: str, role: str, session_id: str = "default") -> str:
    return f"{normalize_learner_id(learner_id)}:{normalize_session_id(session_id)}:{role}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _encode_cursor(timestamp: str, document_id: str) -> str:
    payload = json.dumps([timestamp, document_id], separators=(",", ":")).encode("utf-8")
    return urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> Optional[tuple[str, str]]:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(urlsafe_b64decode(padded).decode("utf-8"))
        if isinstance(value, list) and len(value) == 2 and all(isinstance(item, str) for item in value):
            return value[0], value[1]
    except (ValueError, TypeError, json.JSONDecodeError):
        pass
    return None


def _read_fallback() -> dict[str, Any]:
    try:
        return json.loads(_FALLBACK.read_text(encoding="utf-8")) if _FALLBACK.exists() else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ agent_sessions fallback write failed: {exc}")


def _read_history_fallback() -> dict[str, dict[str, Any]]:
    try:
        if _HISTORY_FALLBACK.exists():
            data = json.loads(_HISTORY_FALLBACK.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {
                    "conversations": data.get("conversations", {}),
                    "messages": data.get("messages", {}),
                }
    except (OSError, json.JSONDecodeError):
        pass
    return {"conversations": {}, "messages": {}}


def _write_history_fallback(data: dict[str, dict[str, Any]]) -> None:
    try:
        _HISTORY_FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _HISTORY_FALLBACK.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"⚠️ agent history fallback write failed: {exc}")


def _conversation_memory(turns: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive compact working memory from visible, non-retracted turns."""
    visible = [
        turn for turn in turns
        if isinstance(turn, dict)
        and not turn.get("deleted")
        and not turn.get("retracted")
        and turn.get("content")
    ]
    older = visible[:-8] if len(visible) > 8 else []
    assistant_points = [
        " ".join(str(turn.get("content") or "").split())[:160]
        for turn in older
        if turn.get("role") == "assistant"
    ][-MAX_ROLLING_SUMMARY_ITEMS:]
    facts: list[str] = []
    signal = re.compile(
        r"(?:אני\s+(?:אוהב|אוהבת|מעדיף|מעדיפה|מתקשה)|עוזר לי|המטרה שלי|"
        r"أنا\s+(?:أحب|أفضل|أجد صعوبة)|يساعدني|هدفي|"
        r"I\s+(?:like|love|prefer|struggle|learn best)|helps me|my goal)",
        re.IGNORECASE,
    )
    for turn in older:
        if turn.get("role") != "user":
            continue
        text, _ = strip_pii(" ".join(str(turn.get("content") or "").split())[:180])
        if text and signal.search(text) and text not in facts:
            facts.append(text)
    return {
        "rolling_summary": assistant_points,
        "entity_ledger": facts[-MAX_ENTITY_LEDGER_ITEMS:],
        "updated_at": visible[-1].get("at") if visible else None,
    }


async def _ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    _indexes_ready = True
    conversations = _get_collection_named("agent_conversations")
    messages = _get_collection_named("agent_messages")
    if conversations is None or messages is None:
        return
    try:
        await conversations.create_index(
            [("learner_id", 1), ("role", 1), ("updated_at", -1)],
            name="learner_role_updated",
        )
        await conversations.create_index(
            [
                ("learner_id", 1), ("role", 1), ("activity_unit_id", 1),
                ("activity_component_id", 1), ("activity_status", 1),
            ],
            name="learner_activity_open",
        )
        await messages.create_index(
            [("learner_id", 1), ("conversation_id", 1), ("at", -1)],
            name="learner_conversation_at",
        )
    except Exception as exc:  # Cosmos may manage indexes outside the Mongo API.
        print(f"⚠️ agent history index setup skipped: {exc}")


def _conversation_payload(document: dict[str, Any]) -> dict[str, Any]:
    title_source = document.get("title_source") or "pending"
    return {
        "id": document.get("session_id") or "default",
        "title": (document.get("title") or "") if title_source in {"model", "fallback"} else "",
        "preview": document.get("preview") or "",
        "message_count": int(document.get("message_count") or 0),
        "created_at": document.get("created_at") or document.get("updated_at") or _now(),
        "updated_at": document.get("updated_at") or document.get("created_at") or _now(),
        "activity_unit_id": document.get("activity_unit_id"),
        "activity_component_id": document.get("activity_component_id"),
        "activity_status": document.get("activity_status"),
    }


def _message_payload(document: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "id": str(document.get("_id") or ""),
        "role": document.get("message_role") or "assistant",
        "text": document.get("content") or "",
        "text_after": document.get("text_after") or "",
        "at": document.get("at") or _now(),
    }
    if isinstance(document.get("visual"), dict):
        payload["visual"] = document["visual"]
    return payload


async def _migrate_legacy_default(learner_id: str, role: str) -> None:
    """Expose the existing capped ``default`` transcript in the new history UI."""
    safe_id = normalize_learner_id(learner_id)
    session_id = "default"
    key = _key(safe_id, role, session_id)
    conversations = _get_collection_named("agent_conversations")
    messages = _get_collection_named("agent_messages")
    legacy = _get_collection_named("agent_sessions")
    if conversations is not None and messages is not None and legacy is not None:
        try:
            if await conversations.find_one({"_id": key}, {"_id": 1}):
                return
            legacy_document = await legacy.find_one({"_id": key})
            turns = (legacy_document or {}).get("turns", [])
            if not turns:
                return
            for index, turn in enumerate(turns):
                await messages.update_one(
                    {"_id": f"{key}:legacy:{index:04d}"},
                    {"$setOnInsert": {
                        "learner_id": safe_id,
                        "conversation_id": session_id,
                        "agent_role": role,
                        "message_role": turn.get("role") if turn.get("role") in {"user", "assistant"} else "assistant",
                        "content": turn.get("content") or "",
                        "text_after": "",
                        "at": turn.get("at") or legacy_document.get("updated_at") or _now(),
                    }},
                    upsert=True,
                )
            updated_at = legacy_document.get("updated_at") or turns[-1].get("at") or _now()
            await conversations.update_one(
                {"_id": key},
                {"$setOnInsert": {
                    "learner_id": safe_id,
                    "session_id": session_id,
                    "role": role,
                    "title": "",
                    "title_source": "pending",
                    "preview": turns[-1].get("content") or "",
                    "message_count": len(turns),
                    "created_at": turns[0].get("at") or updated_at,
                    "updated_at": updated_at,
                }},
                upsert=True,
            )
            return
        except Exception as exc:
            print(f"⚠️ legacy agent history migration failed, using fallback: {exc}")

    history = _read_history_fallback()
    if key in history["conversations"]:
        return
    legacy_document = _read_fallback().get(key, {})
    turns = legacy_document.get("turns", [])
    if not turns:
        return
    for index, turn in enumerate(turns):
        message_id = f"{key}:legacy:{index:04d}"
        history["messages"][message_id] = {
            "_id": message_id,
            "learner_id": safe_id,
            "conversation_id": session_id,
            "agent_role": role,
            "message_role": turn.get("role") if turn.get("role") in {"user", "assistant"} else "assistant",
            "content": turn.get("content") or "",
            "text_after": "",
            "at": turn.get("at") or legacy_document.get("updated_at") or _now(),
        }
    updated_at = legacy_document.get("updated_at") or turns[-1].get("at") or _now()
    history["conversations"][key] = {
        "_id": key,
        "learner_id": safe_id,
        "session_id": session_id,
        "role": role,
        "title": "",
        "title_source": "pending",
        "preview": turns[-1].get("content") or "",
        "message_count": len(turns),
        "created_at": turns[0].get("at") or updated_at,
        "updated_at": updated_at,
    }
    _write_history_fallback(history)


async def get_recent(
    learner_id: str,
    role: str,
    limit: int = 8,
    session_id: str = "default",
) -> list[dict[str, str]]:
    """Return the last `limit` turns as [{role, content}] (oldest→newest)."""
    key = _key(learner_id, role, session_id)
    collection = _get_collection_named("agent_sessions")
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": key})
            turns = (doc or {}).get("turns", [])
            return turns[-limit:]
        except Exception as exc:
            print(f"⚠️ agent_sessions read failed, using fallback: {exc}")
    return (_read_fallback().get(key, {}).get("turns", []))[-limit:]


async def get_conversation_memory(
    learner_id: str,
    role: str = "coach",
    session_id: str = "default",
) -> dict[str, Any]:
    """Return the compact continuity digest stored outside the verbatim window."""
    key = _key(learner_id, role, session_id)
    collection = _get_collection_named("agent_sessions")
    if collection is not None:
        try:
            document = await collection.find_one({"_id": key}, {"conversation_memory": 1})
            value = (document or {}).get("conversation_memory")
            return value if isinstance(value, dict) else {}
        except Exception as exc:
            print(f"⚠️ conversation memory read failed, using fallback: {exc}")
    value = (_read_fallback().get(key) or {}).get("conversation_memory")
    return value if isinstance(value, dict) else {}


async def create_conversation(
    learner_id: str,
    role: str = "coach",
    unit_id: object = None,
    component_id: object = None,
) -> dict[str, Any]:
    """Resolve the open activity thread, or create a durable empty thread.

    Activity-scoped conversations remain open across reloads until a trusted
    xAPI completion closes them. Unscoped callers retain the legacy behavior of
    reusing only a globally empty thread.
    """
    await _ensure_indexes()
    safe_id = normalize_learner_id(learner_id)
    safe_unit = normalize_activity_id(unit_id)
    safe_component = normalize_activity_id(component_id)
    activity_scoped = bool(safe_unit and safe_component)
    collection = _get_collection_named("agent_conversations")
    use_fallback = collection is None
    if collection is not None:
        try:
            query: dict[str, Any] = {
                "learner_id": safe_id,
                "role": role,
                "is_deleted": {"$ne": True},
            }
            if activity_scoped:
                query.update({
                    "activity_unit_id": safe_unit,
                    "activity_component_id": safe_component,
                    "activity_status": "open",
                })
            else:
                query.update({
                    "message_count": {"$lte": 0},
                    "activity_component_id": {"$exists": False},
                })
            existing = await collection.find_one(
                query,
                sort=[("updated_at", -1), ("_id", -1)],
            )
            if existing:
                return _conversation_payload(existing)
        except Exception as exc:
            print(f"⚠️ empty conversation lookup failed, using fallback: {exc}")
            use_fallback = True

    history = _read_history_fallback()
    empty_fallbacks = (
        [
            document for document in history["conversations"].values()
            if document.get("learner_id") == safe_id
            and document.get("role") == role
            and document.get("is_deleted") is not True
            and (
                document.get("activity_unit_id") == safe_unit
                and document.get("activity_component_id") == safe_component
                and document.get("activity_status") == "open"
                if activity_scoped
                else int(document.get("message_count") or 0) == 0
                and not document.get("activity_component_id")
            )
        ]
        if use_fallback else []
    )
    if empty_fallbacks:
        empty_fallbacks.sort(
            key=lambda item: (item.get("updated_at", ""), item.get("_id", "")),
            reverse=True,
        )
        return _conversation_payload(empty_fallbacks[0])

    session_id = f"chat-{uuid4().hex}"
    now = _now()
    document = {
        "_id": _key(safe_id, role, session_id),
        "learner_id": safe_id,
        "session_id": session_id,
        "role": role,
        "title": "",
        "title_source": "pending",
        "preview": "",
        "message_count": 0,
        "is_deleted": False,
        "created_at": now,
        "updated_at": now,
    }
    if activity_scoped:
        document.update({
            "activity_unit_id": safe_unit,
            "activity_component_id": safe_component,
            "activity_status": "open",
        })
    if collection is not None:
        try:
            await collection.insert_one(document)
            return _conversation_payload(document)
        except Exception as exc:
            print(f"⚠️ conversation create failed, using fallback: {exc}")
    history["conversations"][document["_id"]] = document
    _write_history_fallback(history)
    return _conversation_payload(document)


async def close_activity_conversations(
    learner_id: str,
    unit_id: object,
    component_id: object,
    role: str = "coach",
) -> int:
    """Close every open transcript for one genuinely completed activity."""
    safe_id = normalize_learner_id(learner_id)
    safe_unit = normalize_activity_id(unit_id)
    safe_component = normalize_activity_id(component_id)
    if not safe_unit or not safe_component:
        return 0
    closed_at = _now()
    query = {
        "learner_id": safe_id,
        "role": role,
        "activity_unit_id": safe_unit,
        "activity_component_id": safe_component,
        "activity_status": "open",
        "is_deleted": {"$ne": True},
    }
    collection = _get_collection_named("agent_conversations")
    if collection is not None:
        try:
            result = await collection.update_many(
                query,
                {"$set": {"activity_status": "completed", "activity_closed_at": closed_at}},
            )
            return int(result.modified_count)
        except Exception as exc:
            print(f"⚠️ activity conversation closure failed, using fallback: {exc}")
    history = _read_history_fallback()
    closed = 0
    for document in history["conversations"].values():
        if (
            document.get("learner_id") == safe_id
            and document.get("role") == role
            and document.get("activity_unit_id") == safe_unit
            and document.get("activity_component_id") == safe_component
            and document.get("activity_status") == "open"
            and document.get("is_deleted") is not True
        ):
            document.update({
                "activity_status": "completed",
                "activity_closed_at": closed_at,
            })
            closed += 1
    if closed:
        _write_history_fallback(history)
    return closed


async def list_conversations(
    learner_id: str,
    role: str = "coach",
    limit: int = 12,
    cursor: Optional[str] = None,
) -> dict[str, Any]:
    """Return newest threads first using an opaque stable cursor."""
    await _ensure_indexes()
    safe_id = normalize_learner_id(learner_id)
    await _migrate_legacy_default(safe_id, role)
    decoded = _decode_cursor(cursor)
    collection = _get_collection_named("agent_conversations")
    documents: list[dict[str, Any]]
    use_fallback = collection is None
    if collection is not None:
        try:
            query: dict[str, Any] = {
                "learner_id": safe_id,
                "role": role,
                "is_deleted": {"$ne": True},
            }
            if decoded:
                timestamp, document_id = decoded
                query["$or"] = [
                    {"updated_at": {"$lt": timestamp}},
                    {"updated_at": timestamp, "_id": {"$lt": document_id}},
                ]
            documents = await collection.find(query).sort(
                [("updated_at", -1), ("_id", -1)]
            ).limit(limit + 1).to_list(length=limit + 1)
        except Exception as exc:
            print(f"⚠️ conversation list failed, using fallback: {exc}")
            documents = []
            use_fallback = True
    else:
        documents = []
    if use_fallback:
        history = _read_history_fallback()
        documents = [
            document for document in history["conversations"].values()
            if document.get("learner_id") == safe_id
            and document.get("role") == role
            and document.get("is_deleted") is not True
        ]
        documents.sort(key=lambda item: (item.get("updated_at", ""), item.get("_id", "")), reverse=True)
        if decoded:
            documents = [
                item for item in documents
                if (item.get("updated_at", ""), item.get("_id", "")) < decoded
            ]
        documents = documents[: limit + 1]
    has_more = len(documents) > limit
    selected = documents[:limit]
    next_cursor = (
        _encode_cursor(selected[-1].get("updated_at", ""), selected[-1].get("_id", ""))
        if has_more and selected else None
    )
    return {
        "conversations": [_conversation_payload(document) for document in selected],
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


async def conversation_needs_title(
    learner_id: str,
    session_id: str,
    role: str = "coach",
) -> bool:
    """Return whether a thread still needs its first model-authored title."""
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    key = _key(safe_id, role, safe_session)
    collection = _get_collection_named("agent_conversations")
    if collection is not None:
        try:
            document = await collection.find_one(
                {"_id": key, "is_deleted": {"$ne": True}},
                {"title": 1, "title_source": 1},
            )
            if not document:
                return True
            return (document.get("title_source") or "pending") not in {"model", "fallback"}
        except Exception as exc:
            print(f"⚠️ conversation title read failed, using fallback: {exc}")
    document = _read_history_fallback()["conversations"].get(key)
    if not document or document.get("is_deleted") is True:
        return document is None
    return (document.get("title_source") or "pending") not in {"model", "fallback"}


async def get_first_user_message(
    learner_id: str,
    session_id: str,
    role: str = "coach",
) -> Optional[str]:
    """Return the oldest archived learner message for title generation."""
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    collection = _get_collection_named("agent_messages")
    if collection is not None:
        try:
            documents = await collection.find({
                "learner_id": safe_id,
                "conversation_id": safe_session,
                "agent_role": role,
                "message_role": "user",
            }).sort([("at", 1), ("_id", 1)]).limit(1).to_list(length=1)
            if documents:
                return str(documents[0].get("content") or "").strip() or None
            return None
        except Exception as exc:
            print(f"⚠️ first conversation message read failed, using fallback: {exc}")
    history = _read_history_fallback()
    documents = [
        document for document in history["messages"].values()
        if document.get("learner_id") == safe_id
        and document.get("conversation_id") == safe_session
        and document.get("agent_role") == role
        and document.get("message_role") == "user"
    ]
    documents.sort(key=lambda item: (item.get("at", ""), item.get("_id", "")))
    if not documents:
        return None
    return str(documents[0].get("content") or "").strip() or None


async def soft_delete_conversation(
    learner_id: str,
    session_id: str,
    role: str = "coach",
) -> bool:
    """Hide a learner-owned thread without deleting its transcript or memory."""
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    key = _key(safe_id, role, safe_session)
    deleted_at = _now()
    collection = _get_collection_named("agent_conversations")
    if collection is not None:
        try:
            result = await collection.update_one(
                {
                    "_id": key,
                    "learner_id": safe_id,
                    "role": role,
                    "is_deleted": {"$ne": True},
                },
                {"$set": {"is_deleted": True, "deleted_at": deleted_at}},
            )
            return bool(result.matched_count)
        except Exception as exc:
            print(f"⚠️ conversation soft-delete failed, using fallback: {exc}")
    history = _read_history_fallback()
    document = history["conversations"].get(key)
    if not document or document.get("learner_id") != safe_id or document.get("role") != role:
        return False
    document.update({"is_deleted": True, "deleted_at": deleted_at})
    _write_history_fallback(history)
    return True


async def list_messages(
    learner_id: str,
    session_id: str,
    role: str = "coach",
    limit: int = 20,
    cursor: Optional[str] = None,
) -> dict[str, Any]:
    """Return one older page in chronological order for scroll-up prepending."""
    await _ensure_indexes()
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    await _migrate_legacy_default(safe_id, role)
    decoded = _decode_cursor(cursor)
    collection = _get_collection_named("agent_messages")
    documents: list[dict[str, Any]]
    use_fallback = collection is None
    if collection is not None:
        try:
            query: dict[str, Any] = {
                "learner_id": safe_id,
                "conversation_id": safe_session,
                "agent_role": role,
            }
            if decoded:
                timestamp, document_id = decoded
                query["$or"] = [
                    {"at": {"$lt": timestamp}},
                    {"at": timestamp, "_id": {"$lt": document_id}},
                ]
            documents = await collection.find(query).sort(
                [("at", -1), ("_id", -1)]
            ).limit(limit + 1).to_list(length=limit + 1)
        except Exception as exc:
            print(f"⚠️ message history failed, using fallback: {exc}")
            documents = []
            use_fallback = True
    else:
        documents = []
    if use_fallback:
        history = _read_history_fallback()
        documents = [
            document for document in history["messages"].values()
            if document.get("learner_id") == safe_id
            and document.get("conversation_id") == safe_session
            and document.get("agent_role") == role
        ]
        documents.sort(key=lambda item: (item.get("at", ""), item.get("_id", "")), reverse=True)
        if decoded:
            documents = [
                item for item in documents
                if (item.get("at", ""), item.get("_id", "")) < decoded
            ]
        documents = documents[: limit + 1]
    has_more = len(documents) > limit
    selected_desc = documents[:limit]
    next_cursor = (
        _encode_cursor(selected_desc[-1].get("at", ""), selected_desc[-1].get("_id", ""))
        if has_more and selected_desc else None
    )
    return {
        "messages": [_message_payload(document) for document in reversed(selected_desc)],
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


async def append_turn(
    learner_id: str,
    role: str,
    user: str,
    assistant: str,
    session_id: str = "default",
    exchange_id: Optional[str] = None,
    include_user_in_history: bool = True,
    conversation_title: Optional[str] = None,
    title_source: Optional[str] = None,
) -> None:
    """Append an exchange to bounded prompt memory and durable transcript."""
    await _ensure_indexes()
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    key = _key(safe_id, role, safe_session)
    now_value = datetime.now(timezone.utc)
    now = now_value.isoformat()
    assistant_at = (now_value + timedelta(microseconds=1)).isoformat()
    safe_exchange = normalize_session_id(exchange_id or uuid4().hex)
    new_turns = [
        {"role": "user", "content": user, "at": now},
        {"role": "assistant", "content": assistant, "at": assistant_at},
    ]
    collection = _get_collection_named("agent_sessions")
    working_memory_stored = False
    if collection is not None:
        try:
            doc = await collection.find_one({"_id": key})
            turns = ((doc or {}).get("turns", []) + new_turns)[-MAX_TURNS:]
            await collection.update_one(
                {"_id": key},
                {"$set": {"turns": turns, "conversation_memory": _conversation_memory(turns), "learner_id": safe_id,
                          "session_id": safe_session, "role": role, "updated_at": assistant_at}},
                upsert=True,
            )
            working_memory_stored = True
        except Exception as exc:
            print(f"⚠️ agent_sessions write failed, using fallback: {exc}")
    if not working_memory_stored:
        data = _read_fallback()
        entry = data.get(key, {"turns": []})
        entry["turns"] = (entry.get("turns", []) + new_turns)[-MAX_TURNS:]
        entry["conversation_memory"] = _conversation_memory(entry["turns"])
        entry.update({"learner_id": safe_id, "session_id": safe_session, "role": role, "updated_at": assistant_at})
        data[key] = entry
        _write_fallback(data)

    message_documents = []
    if include_user_in_history:
        message_documents.append({
            "_id": f"{safe_exchange}:0",
            "learner_id": safe_id,
            "conversation_id": safe_session,
            "agent_role": role,
            "message_role": "user",
            "content": user,
            "text_after": "",
            "at": now,
        })
    message_documents.append({
        "_id": f"{safe_exchange}:1",
        "learner_id": safe_id,
        "conversation_id": safe_session,
        "agent_role": role,
        "message_role": "assistant",
        "content": assistant,
        "text_after": "",
        "at": assistant_at,
    })
    title = " ".join((conversation_title or "").split())[:72]
    resolved_title_source = title_source if title and title_source in {"model", "fallback"} else "pending"
    conversation_document = {
        "_id": key,
        "learner_id": safe_id,
        "session_id": safe_session,
        "role": role,
        "title": title,
        "title_source": resolved_title_source,
        "preview": assistant or user,
        "message_count": len(message_documents),
        "created_at": now,
        "updated_at": assistant_at,
    }
    messages = _get_collection_named("agent_messages")
    conversations = _get_collection_named("agent_conversations")
    if messages is not None and conversations is not None:
        try:
            inserted = 0
            for document in message_documents:
                result = await messages.update_one(
                    {"_id": document["_id"]}, {"$setOnInsert": document}, upsert=True
                )
                if result.upserted_id is not None:
                    inserted += 1
            existing = await conversations.find_one(
                {"_id": key}, {"title": 1, "title_source": 1}
            )
            existing_source = (existing or {}).get("title_source") or "pending"
            replace_title = bool(title) and existing_source not in {"model", "fallback"}
            await conversations.update_one(
                {"_id": key},
                {
                    "$set": {
                        "learner_id": safe_id,
                        "session_id": safe_session,
                        "role": role,
                        "title": title if replace_title else (existing or {}).get("title") or "",
                        "title_source": resolved_title_source if replace_title else existing_source,
                        "preview": assistant or user,
                        "updated_at": assistant_at,
                    },
                    "$setOnInsert": {"created_at": now},
                    "$inc": {"message_count": inserted},
                },
                upsert=True,
            )
            return
        except Exception as exc:
            print(f"⚠️ durable agent history write failed, using fallback: {exc}")

    history = _read_history_fallback()
    inserted = 0
    for document in message_documents:
        if document["_id"] not in history["messages"]:
            history["messages"][document["_id"]] = document
            inserted += 1
    existing = history["conversations"].get(key, {})
    existing_source = existing.get("title_source") or "pending"
    if title and existing_source not in {"model", "fallback"}:
        conversation_document["title"] = title
        conversation_document["title_source"] = resolved_title_source
    else:
        conversation_document["title"] = existing.get("title") or ""
        conversation_document["title_source"] = existing_source
    conversation_document["created_at"] = existing.get("created_at") or now
    conversation_document["message_count"] = int(existing.get("message_count") or 0) + inserted
    for field in (
        "activity_unit_id", "activity_component_id", "activity_status", "activity_closed_at",
    ):
        if existing.get(field) is not None:
            conversation_document[field] = existing[field]
    history["conversations"][key] = conversation_document
    _write_history_fallback(history)


async def attach_visual(
    learner_id: str,
    session_id: str,
    assistant_message_id: str,
    visual: dict[str, Any],
    text: str,
    text_after: str,
    role: str = "coach",
) -> bool:
    """Attach the rendered visual and displayed text split to its assistant message."""
    safe_id = normalize_learner_id(learner_id)
    safe_session = normalize_session_id(session_id)
    collection = _get_collection_named("agent_messages")
    if collection is not None:
        try:
            result = await collection.update_one(
                {
                    "_id": assistant_message_id,
                    "learner_id": safe_id,
                    "conversation_id": safe_session,
                    "agent_role": role,
                },
                {"$set": {
                    "visual": visual,
                    "content": text,
                    "text_after": text_after,
                    "visual_attached_at": _now(),
                }},
            )
            if result.matched_count:
                return True
        except Exception as exc:
            print(f"⚠️ visual history attachment failed, using fallback: {exc}")
    history = _read_history_fallback()
    message = history["messages"].get(assistant_message_id)
    if (
        message
        and message.get("learner_id") == safe_id
        and message.get("conversation_id") == safe_session
    ):
        message.update({"visual": visual, "content": text, "text_after": text_after})
        _write_history_fallback(history)
        return True
    return False
