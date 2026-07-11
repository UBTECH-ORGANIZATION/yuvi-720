"""Read-only MongoDB access for sanitized AI usage events."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from .config import Settings


_SAFE_EVENT_FIELDS = {
    "_id": 0,
    "event_id": 1,
    "started_at": 1,
    "actor_id": 1,
    "actor_type": 1,
    "endpoint": 1,
    "feature": 1,
    "operation": 1,
    "provider": 1,
    "deployment": 1,
    "model_tier": 1,
    "streaming": 1,
    "meter": 1,
    "status": 1,
    "usage_status": 1,
    "input_tokens": 1,
    "output_tokens": 1,
    "total_tokens": 1,
    "quantity": 1,
    "cost_usd": 1,
    "latency_ms": 1,
}


class UsageEventRepository:
    """Query only allowlisted operational fields from `ai_usage_events`."""

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
        return self._client[self._settings.mongodb_database]["ai_usage_events"]

    async def ping(self) -> None:
        collection = self._collection()
        await collection.database.command("ping")

    async def fetch_events(
        self,
        *,
        start: datetime,
        end: datetime,
        actor_id: Optional[str] = None,
        endpoint: Optional[str] = None,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"started_at": {"$gte": start, "$lt": end}}
        if actor_id:
            query["actor_id"] = actor_id
        if endpoint:
            query["endpoint"] = endpoint
        cursor = (
            self._collection()
            .find(query, _SAFE_EVENT_FIELDS)
            .sort("started_at", -1)
            .limit(limit)
        )
        return [document async for document in cursor]

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
