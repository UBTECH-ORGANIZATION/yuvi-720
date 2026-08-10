"""MongoDB access for support tickets (`support_tickets`).

Tickets are fault reports filed by learners, teachers and anonymous visitors.
They are readable only by authenticated administrators, never in public mode.
Timestamps are ISO-8601 UTC strings written by the main backend, so date windows
are compared as strings — the format is fixed-width and sorts chronologically.
"""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings


TICKET_STATUSES = ("new", "in_review", "in_progress", "resolved", "closed")

_TICKET_FIELDS = {
    "_id": 0,
    "ticket_id": 1,
    "created_at": 1,
    "updated_at": 1,
    "status": 1,
    "admin_notes": 1,
    "updated_by": 1,
    "source": 1,
    "reporter_type": 1,
    "reporter_id": 1,
    "reporter_name": 1,
    "contact_email": 1,
    "category": 1,
    "severity": 1,
    "title": 1,
    "description": 1,
    "context": 1,
    "attachments": 1,
}

_SEARCHABLE_FIELDS = ("title", "description", "reporter_name", "contact_email", "reporter_id")


class SupportRepository:
    """Read tickets and update only the triage fields (status/notes)."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[AsyncIOMotorClient] = None

    def _collection(self):
        if not self._settings.mongodb_connection_string:
            raise RuntimeError("MongoDB is not configured")
        if self._client is None:
            self._client = AsyncIOMotorClient(
                self._settings.mongodb_connection_string,
                tlsCAFile=certifi.where(),
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=10000,
            )
        return self._client[self._settings.mongodb_database]["support_tickets"]

    async def fetch_tickets(
        self,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        status: Optional[str] = None,
        category: Optional[str] = None,
        severity: Optional[str] = None,
        reporter_type: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {}
        if start or end:
            window: dict[str, Any] = {}
            if start:
                window["$gte"] = start.isoformat()
            if end:
                window["$lt"] = end.isoformat()
            query["created_at"] = window
        if status:
            query["status"] = status
        if category:
            query["category"] = category
        if severity:
            query["severity"] = severity
        if reporter_type:
            query["reporter_type"] = reporter_type
        if search:
            pattern = re.escape(search.strip())
            if pattern:
                query["$or"] = [
                    {field: {"$regex": pattern, "$options": "i"}}
                    for field in _SEARCHABLE_FIELDS
                ]
        cursor = (
            self._collection()
            .find(query, _TICKET_FIELDS)
            .sort("created_at", -1)
            .limit(limit)
        )
        return [document async for document in cursor]

    async def fetch_ticket(self, ticket_id: str) -> Optional[dict[str, Any]]:
        return await self._collection().find_one({"ticket_id": ticket_id}, _TICKET_FIELDS)

    async def update_ticket(
        self,
        ticket_id: str,
        *,
        updates: dict[str, Any],
        updated_by: str,
        now: datetime,
    ) -> Optional[dict[str, Any]]:
        if not updates:
            return await self.fetch_ticket(ticket_id)
        payload = {**updates, "updated_at": now.isoformat(), "updated_by": updated_by}
        result = await self._collection().update_one(
            {"ticket_id": ticket_id}, {"$set": payload}
        )
        if result.matched_count == 0:
            return None
        return await self.fetch_ticket(ticket_id)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
