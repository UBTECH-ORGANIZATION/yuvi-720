"""Persistence for campaign landing-page leads (`campaign_leads` collection).

Leads are business contact details of school/authority staff — not learner data.
They are stored so the admin console can filter, export and track them through a
pipeline; the email notification stays the primary alert channel.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named  # shared Mongo client


LEADS_COLLECTION = "campaign_leads"

LEAD_STATUSES = ("new", "contacted", "qualified", "meeting", "won", "lost")
DEFAULT_LEAD_STATUS = LEAD_STATUSES[0]


def _collection() -> Optional[Any]:
    return _get_collection_named(LEADS_COLLECTION)


def build_lead_document(lead: dict[str, str]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    return {
        "lead_id": uuid.uuid4().hex,
        "created_at": now,
        "updated_at": now,
        "status": DEFAULT_LEAD_STATUS,
        "notes": "",
        "full_name": lead.get("full_name", ""),
        "role": lead.get("role", ""),
        "organization": lead.get("organization", ""),
        "city": lead.get("city", ""),
        "phone": lead.get("phone", ""),
        "email": lead.get("email", ""),
        "grades": lead.get("grades", ""),
        "message": lead.get("message", ""),
        "source": lead.get("source", ""),
    }


async def store_lead(lead: dict[str, str]) -> Optional[str]:
    """Persist a lead and return its id, or None when storage is unavailable."""
    collection = _collection()
    if collection is None:
        print("⚠️ Campaign lead not persisted: MongoDB is not configured")
        return None
    document = build_lead_document(lead)
    try:
        await collection.insert_one(document)
    except Exception as exc:
        print(f"⚠️ Campaign lead persistence failed: {type(exc).__name__}")
        return None
    return document["lead_id"]
