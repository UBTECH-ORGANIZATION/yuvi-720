"""Support tickets and the teacher <-> admin support chat.

Reports are operational records, not learner data: a learner reporter is stored
by pseudonymous ``learner_id`` only — never a display name. Teachers are staff,
so their name is kept so the admin console knows who to answer. The chat is
teacher-only by design; a learner never opens a support thread. A JSON fallback
keeps the local demo usable without Mongo/Cosmos.
"""

from __future__ import annotations

import json
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from app.brain.repository import _get_collection_named

TICKETS_COLLECTION = "support_tickets"
CONVERSATIONS_COLLECTION = "support_conversations"
MESSAGES_COLLECTION = "support_messages"

TICKET_STATUSES = ("new", "in_review", "in_progress", "resolved", "closed")
DEFAULT_TICKET_STATUS = TICKET_STATUSES[0]
TICKET_CATEGORIES = ("bug", "content", "access", "performance", "other")
DEFAULT_TICKET_CATEGORY = "other"
TICKET_SEVERITIES = ("low", "normal", "high", "blocking")
DEFAULT_TICKET_SEVERITY = "normal"

CONVERSATION_STATUSES = ("open", "pending", "closed")
DEFAULT_CONVERSATION_STATUS = CONVERSATION_STATUSES[0]

MAX_TICKETS_PER_REPORTER = 50
MAX_MESSAGE_LENGTH = 4000
MAX_CONVERSATION_PAGE = 50

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "support_tickets.json"
_CHAT_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "support_chat.json"
_indexes_ready = False
_chat_indexes_ready = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _collection() -> Optional[Any]:
    return _get_collection_named(TICKETS_COLLECTION)


def _read_fallback() -> dict[str, dict[str, Any]]:
    try:
        if _FALLBACK.exists():
            data = json.loads(_FALLBACK.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _write_fallback(data: dict[str, dict[str, Any]]) -> None:
    try:
        _FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ support ticket fallback write failed: {exc}")


async def _ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return
    _indexes_ready = True
    collection = _collection()
    if collection is None:
        return
    try:
        await collection.create_index([("created_at", -1)], name="created_at_desc")
        await collection.create_index([("ticket_id", 1)], name="ticket_id_unique", unique=True)
        await collection.create_index(
            [("reporter_id", 1), ("created_at", -1)], name="reporter_created"
        )
        await collection.create_index([("status", 1), ("created_at", -1)], name="status_created")
    except Exception as exc:  # Cosmos may manage indexes outside the Mongo API.
        print(f"⚠️ support ticket index setup skipped: {exc}")


def normalize_category(value: object) -> str:
    candidate = str(value or "").strip().lower()
    return candidate if candidate in TICKET_CATEGORIES else DEFAULT_TICKET_CATEGORY


def normalize_severity(value: object) -> str:
    candidate = str(value or "").strip().lower()
    return candidate if candidate in TICKET_SEVERITIES else DEFAULT_TICKET_SEVERITY


def _clean_context(context: object) -> dict[str, Any]:
    """Keep only the bounded technical fields the console needs to reproduce a fault."""
    if not isinstance(context, dict):
        return {}
    allowed = ("route", "user_agent", "viewport", "language", "theme", "app_version", "occurred_at")
    cleaned: dict[str, Any] = {}
    for key in allowed:
        value = context.get(key)
        if value in (None, ""):
            continue
        cleaned[key] = str(value)[:300]
    return cleaned


def build_ticket_document(
    *,
    source: str,
    reporter_type: str,
    reporter_id: Optional[str],
    reporter_name: str,
    contact_email: str,
    category: str,
    severity: str,
    title: str,
    description: str,
    context: object,
) -> dict[str, Any]:
    now = _now()
    return {
        "ticket_id": f"tkt-{uuid4().hex[:12]}",
        "source": source,
        "reporter_type": reporter_type,
        "reporter_id": reporter_id,
        # Learner names are never stored; the caller passes "" for learners.
        "reporter_name": reporter_name[:120],
        "contact_email": contact_email[:200],
        "category": normalize_category(category),
        "severity": normalize_severity(severity),
        "title": title[:160],
        "description": description[:4000],
        "context": _clean_context(context),
        "attachments": [],
        "status": DEFAULT_TICKET_STATUS,
        "admin_notes": "",
        "updated_by": "",
        "created_at": now,
        "updated_at": now,
        "linked_conversation_id": None,
    }


def ticket_payload(document: dict[str, Any]) -> dict[str, Any]:
    """Shape a ticket for its own reporter — admin-only fields stay out."""
    return {
        "id": str(document.get("ticket_id") or ""),
        "category": document.get("category") or DEFAULT_TICKET_CATEGORY,
        "severity": document.get("severity") or DEFAULT_TICKET_SEVERITY,
        "title": document.get("title") or "",
        "description": document.get("description") or "",
        "status": document.get("status") or DEFAULT_TICKET_STATUS,
        "created_at": document.get("created_at") or _now(),
        "updated_at": document.get("updated_at") or document.get("created_at") or _now(),
    }


async def create_ticket(document: dict[str, Any]) -> Optional[str]:
    """Persist a ticket and return its id, or None when storage is unavailable."""
    await _ensure_indexes()
    collection = _collection()
    if collection is None:
        data = _read_fallback()
        data[document["ticket_id"]] = document
        _write_fallback(data)
        return document["ticket_id"]
    try:
        await collection.insert_one(document)
    except Exception as exc:
        print(f"⚠️ support ticket persistence failed: {type(exc).__name__}")
        return None
    return document["ticket_id"]


async def list_tickets_for_reporter(reporter_id: str, limit: int = 20) -> list[dict[str, Any]]:
    """Return the reporter's own tickets, newest first."""
    await _ensure_indexes()
    capped = max(1, min(int(limit), MAX_TICKETS_PER_REPORTER))
    collection = _collection()
    if collection is None:
        documents = [
            item for item in _read_fallback().values()
            if item.get("reporter_id") == reporter_id
        ]
        documents.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return [ticket_payload(item) for item in documents[:capped]]
    try:
        documents = await collection.find({"reporter_id": reporter_id}).sort(
            [("created_at", -1)]
        ).limit(capped).to_list(length=capped)
    except Exception as exc:
        print(f"⚠️ support ticket list failed: {type(exc).__name__}")
        return []
    return [ticket_payload(document) for document in documents]


# --- teacher <-> admin support chat -----------------------------------------


def _encode_cursor(timestamp: str, document_id: str) -> str:
    payload = json.dumps([timestamp, document_id], separators=(",", ":")).encode("utf-8")
    return urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def _decode_cursor(cursor: Optional[str]) -> Optional[tuple[str, str]]:
    if not cursor:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        value = json.loads(urlsafe_b64decode(padded).decode("utf-8"))
        if isinstance(value, list) and len(value) == 2 and all(isinstance(i, str) for i in value):
            return value[0], value[1]
    except (ValueError, TypeError, json.JSONDecodeError):
        pass
    return None


def _read_chat_fallback() -> dict[str, dict[str, Any]]:
    try:
        if _CHAT_FALLBACK.exists():
            data = json.loads(_CHAT_FALLBACK.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return {
                    "conversations": data.get("conversations", {}),
                    "messages": data.get("messages", {}),
                }
    except (OSError, json.JSONDecodeError):
        pass
    return {"conversations": {}, "messages": {}}


def _write_chat_fallback(data: dict[str, dict[str, Any]]) -> None:
    try:
        _CHAT_FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        _CHAT_FALLBACK.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as exc:
        print(f"⚠️ support chat fallback write failed: {exc}")


async def _ensure_chat_indexes() -> None:
    global _chat_indexes_ready
    if _chat_indexes_ready:
        return
    _chat_indexes_ready = True
    conversations = _get_collection_named(CONVERSATIONS_COLLECTION)
    messages = _get_collection_named(MESSAGES_COLLECTION)
    if conversations is None or messages is None:
        return
    try:
        await conversations.create_index(
            [("teacher_id", 1), ("last_message_at", -1)], name="teacher_recent"
        )
        await conversations.create_index([("last_message_at", -1)], name="recent")
        await messages.create_index(
            [("conversation_id", 1), ("at", 1)], name="conversation_at"
        )
    except Exception as exc:  # Cosmos may manage indexes outside the Mongo API.
        print(f"⚠️ support chat index setup skipped: {exc}")


def conversation_payload(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(document.get("conversation_id") or ""),
        "teacher_id": document.get("teacher_id") or "",
        "teacher_name": document.get("teacher_name") or "",
        "subject": document.get("subject") or "",
        "status": document.get("status") or DEFAULT_CONVERSATION_STATUS,
        "last_message_at": document.get("last_message_at") or document.get("created_at") or _now(),
        "last_message_preview": document.get("last_message_preview") or "",
        "message_count": int(document.get("message_count") or 0),
        "unread_admin": int(document.get("unread_admin") or 0),
        "unread_teacher": int(document.get("unread_teacher") or 0),
        "linked_ticket_id": document.get("linked_ticket_id"),
        "created_at": document.get("created_at") or _now(),
    }


def message_payload(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(document.get("message_id") or ""),
        "author_role": document.get("author_role") or "admin",
        "author_name": document.get("author_name") or "",
        "body": document.get("body") or "",
        "at": document.get("at") or _now(),
    }


async def create_conversation(
    teacher_id: str,
    *,
    teacher_name: str = "",
    subject: str = "",
    linked_ticket_id: Optional[str] = None,
) -> dict[str, Any]:
    await _ensure_chat_indexes()
    now = _now()
    document = {
        "conversation_id": f"sup-{uuid4().hex[:12]}",
        "teacher_id": teacher_id,
        "teacher_name": teacher_name[:120],
        "subject": subject[:160],
        "status": DEFAULT_CONVERSATION_STATUS,
        "last_message_at": now,
        "last_message_preview": "",
        "message_count": 0,
        "unread_admin": 0,
        "unread_teacher": 0,
        "linked_ticket_id": linked_ticket_id,
        "created_at": now,
        "updated_at": now,
        "is_deleted": False,
    }
    collection = _get_collection_named(CONVERSATIONS_COLLECTION)
    if collection is None:
        data = _read_chat_fallback()
        data["conversations"][document["conversation_id"]] = document
        _write_chat_fallback(data)
    else:
        try:
            await collection.insert_one(dict(document))
        except Exception as exc:
            print(f"⚠️ support conversation create failed: {type(exc).__name__}")
    return conversation_payload(document)


async def get_conversation(
    conversation_id: str, *, teacher_id: Optional[str] = None
) -> Optional[dict[str, Any]]:
    """Load one thread. Passing ``teacher_id`` scopes the read to its owner."""
    query: dict[str, Any] = {"conversation_id": conversation_id, "is_deleted": {"$ne": True}}
    if teacher_id is not None:
        query["teacher_id"] = teacher_id
    collection = _get_collection_named(CONVERSATIONS_COLLECTION)
    if collection is None:
        document = _read_chat_fallback()["conversations"].get(conversation_id)
        if document is None or document.get("is_deleted"):
            return None
        if teacher_id is not None and document.get("teacher_id") != teacher_id:
            return None
        return document
    try:
        return await collection.find_one(query)
    except Exception as exc:
        print(f"⚠️ support conversation read failed: {type(exc).__name__}")
        return None


async def list_conversations(
    *,
    teacher_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 20,
    cursor: Optional[str] = None,
) -> dict[str, Any]:
    """Newest threads first. ``teacher_id`` scopes the list; admins omit it."""
    await _ensure_chat_indexes()
    capped = max(1, min(int(limit), MAX_CONVERSATION_PAGE))
    decoded = _decode_cursor(cursor)
    collection = _get_collection_named(CONVERSATIONS_COLLECTION)
    if collection is None:
        documents = [
            item for item in _read_chat_fallback()["conversations"].values()
            if not item.get("is_deleted")
            and (teacher_id is None or item.get("teacher_id") == teacher_id)
            and (status is None or item.get("status") == status)
        ]
        documents.sort(
            key=lambda item: (item.get("last_message_at", ""), item.get("conversation_id", "")),
            reverse=True,
        )
        if decoded:
            documents = [
                item for item in documents
                if (item.get("last_message_at", ""), item.get("conversation_id", "")) < decoded
            ]
        documents = documents[: capped + 1]
    else:
        query: dict[str, Any] = {"is_deleted": {"$ne": True}}
        if teacher_id is not None:
            query["teacher_id"] = teacher_id
        if status is not None:
            query["status"] = status
        if decoded:
            timestamp, document_id = decoded
            query["$or"] = [
                {"last_message_at": {"$lt": timestamp}},
                {"last_message_at": timestamp, "conversation_id": {"$lt": document_id}},
            ]
        try:
            documents = await collection.find(query).sort(
                [("last_message_at", -1), ("conversation_id", -1)]
            ).limit(capped + 1).to_list(length=capped + 1)
        except Exception as exc:
            print(f"⚠️ support conversation list failed: {type(exc).__name__}")
            documents = []
    has_more = len(documents) > capped
    selected = documents[:capped]
    next_cursor = (
        _encode_cursor(
            selected[-1].get("last_message_at", ""), selected[-1].get("conversation_id", "")
        )
        if has_more and selected else None
    )
    return {
        "conversations": [conversation_payload(document) for document in selected],
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


async def append_message(
    conversation_id: str,
    *,
    author_role: str,
    author_id: str,
    author_name: str,
    body: str,
) -> Optional[dict[str, Any]]:
    """Append a message and refresh the thread index. Returns the message payload."""
    await _ensure_chat_indexes()
    now = _now()
    text = body.strip()[:MAX_MESSAGE_LENGTH]
    if not text:
        return None
    document = {
        "message_id": f"msg-{uuid4().hex[:12]}",
        "conversation_id": conversation_id,
        "author_role": author_role,
        "author_id": author_id,
        "author_name": author_name[:120],
        "body": text,
        "at": now,
    }
    # A teacher message raises the admin's unread count and vice versa.
    unread_field = "unread_admin" if author_role == "teacher" else "unread_teacher"
    read_field = "unread_teacher" if author_role == "teacher" else "unread_admin"
    index_updates = {
        "last_message_at": now,
        "last_message_preview": text[:160],
        "updated_at": now,
        read_field: 0,
        "status": "pending" if author_role == "teacher" else "open",
    }

    messages = _get_collection_named(MESSAGES_COLLECTION)
    conversations = _get_collection_named(CONVERSATIONS_COLLECTION)
    if messages is None or conversations is None:
        data = _read_chat_fallback()
        conversation = data["conversations"].get(conversation_id)
        if conversation is None:
            return None
        data["messages"][document["message_id"]] = document
        conversation.update(index_updates)
        conversation["message_count"] = int(conversation.get("message_count") or 0) + 1
        conversation[unread_field] = int(conversation.get(unread_field) or 0) + 1
        _write_chat_fallback(data)
        return message_payload(document)
    try:
        await messages.insert_one(dict(document))
        await conversations.update_one(
            {"conversation_id": conversation_id},
            {"$set": index_updates, "$inc": {"message_count": 1, unread_field: 1}},
        )
    except Exception as exc:
        print(f"⚠️ support message append failed: {type(exc).__name__}")
        return None
    return message_payload(document)


async def list_messages(
    conversation_id: str,
    *,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> dict[str, Any]:
    """Oldest first within a page; the cursor walks backwards through history."""
    await _ensure_chat_indexes()
    capped = max(1, min(int(limit), MAX_CONVERSATION_PAGE))
    decoded = _decode_cursor(cursor)
    collection = _get_collection_named(MESSAGES_COLLECTION)
    if collection is None:
        documents = [
            item for item in _read_chat_fallback()["messages"].values()
            if item.get("conversation_id") == conversation_id
        ]
        documents.sort(key=lambda item: (item.get("at", ""), item.get("message_id", "")), reverse=True)
        if decoded:
            documents = [
                item for item in documents
                if (item.get("at", ""), item.get("message_id", "")) < decoded
            ]
        documents = documents[: capped + 1]
    else:
        query: dict[str, Any] = {"conversation_id": conversation_id}
        if decoded:
            timestamp, document_id = decoded
            query["$or"] = [
                {"at": {"$lt": timestamp}},
                {"at": timestamp, "message_id": {"$lt": document_id}},
            ]
        try:
            documents = await collection.find(query).sort(
                [("at", -1), ("message_id", -1)]
            ).limit(capped + 1).to_list(length=capped + 1)
        except Exception as exc:
            print(f"⚠️ support message list failed: {type(exc).__name__}")
            documents = []
    has_more = len(documents) > capped
    selected = documents[:capped]
    next_cursor = (
        _encode_cursor(selected[-1].get("at", ""), selected[-1].get("message_id", ""))
        if has_more and selected else None
    )
    return {
        "messages": [message_payload(document) for document in reversed(selected)],
        "next_cursor": next_cursor,
        "has_more": has_more,
    }


async def mark_read(conversation_id: str, *, reader_role: str) -> None:
    field = "unread_teacher" if reader_role == "teacher" else "unread_admin"
    collection = _get_collection_named(CONVERSATIONS_COLLECTION)
    if collection is None:
        data = _read_chat_fallback()
        conversation = data["conversations"].get(conversation_id)
        if conversation is None:
            return
        conversation[field] = 0
        _write_chat_fallback(data)
        return
    try:
        await collection.update_one({"conversation_id": conversation_id}, {"$set": {field: 0}})
    except Exception as exc:
        print(f"⚠️ support read receipt failed: {type(exc).__name__}")


async def set_conversation_status(conversation_id: str, status: str) -> Optional[dict[str, Any]]:
    if status not in CONVERSATION_STATUSES:
        return None
    collection = _get_collection_named(CONVERSATIONS_COLLECTION)
    if collection is None:
        data = _read_chat_fallback()
        conversation = data["conversations"].get(conversation_id)
        if conversation is None:
            return None
        conversation["status"] = status
        conversation["updated_at"] = _now()
        _write_chat_fallback(data)
        return conversation_payload(conversation)
    try:
        result = await collection.update_one(
            {"conversation_id": conversation_id},
            {"$set": {"status": status, "updated_at": _now()}},
        )
        if result.matched_count == 0:
            return None
    except Exception as exc:
        print(f"⚠️ support status update failed: {type(exc).__name__}")
        return None
    document = await get_conversation(conversation_id)
    return conversation_payload(document) if document else None
