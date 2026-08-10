"""Support tickets: fault/issue reports filed from inside the app and from the
public report page.

Reports are operational records, not learner data: a learner reporter is stored
by pseudonymous ``learner_id`` only — never a display name. Teachers are staff,
so their name is kept so the admin console knows who to answer. A JSON fallback
keeps the local demo usable without Mongo/Cosmos.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from app.brain.repository import _get_collection_named

TICKETS_COLLECTION = "support_tickets"

TICKET_STATUSES = ("new", "in_review", "in_progress", "resolved", "closed")
DEFAULT_TICKET_STATUS = TICKET_STATUSES[0]
TICKET_CATEGORIES = ("bug", "content", "access", "performance", "other")
DEFAULT_TICKET_CATEGORY = "other"
TICKET_SEVERITIES = ("low", "normal", "high", "blocking")
DEFAULT_TICKET_SEVERITY = "normal"

MAX_TICKETS_PER_REPORTER = 50

_FALLBACK = Path(__file__).resolve().parents[2] / ".runtime" / "support_tickets.json"
_indexes_ready = False


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
