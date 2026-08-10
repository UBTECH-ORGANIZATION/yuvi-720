"""MongoDB access for campaign landing-page leads (`campaign_leads`).

Leads are business contact details submitted on the public 720 landing page.
They are readable only by authenticated administrators, never in public mode.
"""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings


LEAD_STATUSES = ("new", "contacted", "qualified", "meeting", "won", "lost")

_LEAD_FIELDS = {
    "_id": 0,
    "lead_id": 1,
    "created_at": 1,
    "updated_at": 1,
    "status": 1,
    "notes": 1,
    "full_name": 1,
    "role": 1,
    "organization": 1,
    "city": 1,
    "phone": 1,
    "email": 1,
    "grades": 1,
    "message": 1,
    "source": 1,
    "updated_by": 1,
}

_SEARCHABLE_FIELDS = ("full_name", "organization", "city", "email", "phone", "role")


class LeadRepository:
    """Read leads and update only the pipeline fields (status/notes)."""

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
        return self._client[self._settings.mongodb_database]["campaign_leads"]

    async def fetch_leads(
        self,
        *,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        status: Optional[str] = None,
        source: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {}
        if start or end:
            window: dict[str, Any] = {}
            if start:
                window["$gte"] = start
            if end:
                window["$lt"] = end
            query["created_at"] = window
        if status:
            query["status"] = status
        if source:
            query["source"] = source
        if search:
            pattern = re.escape(search.strip())
            if pattern:
                query["$or"] = [
                    {field: {"$regex": pattern, "$options": "i"}}
                    for field in _SEARCHABLE_FIELDS
                ]
        cursor = (
            self._collection()
            .find(query, _LEAD_FIELDS)
            .sort("created_at", -1)
            .limit(limit)
        )
        return [document async for document in cursor]

    async def fetch_lead(self, lead_id: str) -> Optional[dict[str, Any]]:
        return await self._collection().find_one({"lead_id": lead_id}, _LEAD_FIELDS)

    async def list_sources(self) -> list[str]:
        values = await self._collection().distinct("source")
        return sorted(str(value) for value in values if value)

    async def update_lead(
        self,
        lead_id: str,
        *,
        updates: dict[str, Any],
        updated_by: str,
        now: datetime,
    ) -> Optional[dict[str, Any]]:
        if not updates:
            return await self.fetch_lead(lead_id)
        payload = {**updates, "updated_at": now, "updated_by": updated_by}
        result = await self._collection().update_one({"lead_id": lead_id}, {"$set": payload})
        if result.matched_count == 0:
            return None
        return await self.fetch_lead(lead_id)

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
