"""Organisation / games console — the native control plane of this service.

The console reads and writes the same MongoDB database as the Spark product
backend (``users``, ``org_*``, ``learner_game_*``), so both applications see
one truth without a proxy or a shared token. Rules and the audit trail live
in :mod:`.org_service` and :mod:`.games_budget`; storage in
:mod:`.org_repository`, :mod:`.users` and :mod:`.games_budget`; the HTTP
contract (identical to Spark's former ``/api/admin`` routes) in :mod:`.routes`.
"""

from __future__ import annotations

from typing import Any, Optional

import certifi
from motor.motor_asyncio import AsyncIOMotorClient

from ..config import Settings


class ConsoleDatabase:
    """One lazily opened motor client for every console collection.

    Built the same way as the usage/leads/support repositories: from
    ``Settings``, opened on first use, closed in the app lifespan. Tests
    replace ``app.state.console_database`` with an in-memory stand-in that
    exposes the same ``collection(name)`` method.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[AsyncIOMotorClient] = None

    def collection(self, name: str) -> Any:
        if not self._settings.mongodb_connection_string:
            raise RuntimeError("MongoDB is not configured")
        if self._client is None:
            self._client = AsyncIOMotorClient(
                self._settings.mongodb_connection_string,
                tlsCAFile=certifi.where(),
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
                socketTimeoutMS=10000,
                maxPoolSize=20,
                waitQueueTimeoutMS=10000,
            )
        return self._client[self._settings.mongodb_database][name]

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None


__all__ = ["ConsoleDatabase"]
