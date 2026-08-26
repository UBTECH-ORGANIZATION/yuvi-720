"""One-shot store for an in-flight sign-in (state · nonce · PKCE verifier).

Server-side rather than a signed cookie, for two reasons. The PKCE verifier is
a secret that must never reach the browser, and consumption has to be *atomic*:
`find_one_and_delete` is what makes a replayed `state` fail instead of
succeeding twice. Mongo also means a login survives the callback landing on a
different App Service instance than the redirect.

The Mongo-less fallback is in-memory, deliberately not the JSON file the other
repositories use — these documents hold live credentials for ten minutes, and
writing them to disk to spare a dev machine a restart is a bad trade.
"""

from __future__ import annotations

import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.brain.repository import _get_collection_named

COLLECTION = "oidc_transactions"

# Long enough for a real person to type a ministry password, short enough that
# a stolen `state` is worthless by the time it is used.
TRANSACTION_TTL = timedelta(minutes=10)

_memory: dict[str, dict[str, Any]] = {}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def _collection() -> Optional[Any]:
    return _get_collection_named(COLLECTION)


def _prune_memory() -> None:
    now = time.time()
    for state in [key for key, row in _memory.items() if row["expires_ts"] <= now]:
        _memory.pop(state, None)


async def ensure_indexes() -> None:
    """TTL index so abandoned sign-ins expire without a sweeper."""
    handle = _collection()
    if handle is None:
        return
    try:
        await handle.create_index("expires_at", expireAfterSeconds=0)
    except Exception as exc:  # pragma: no cover - best effort, as elsewhere
        print(f"⚠️ oidc_transactions index failed: {type(exc).__name__}")


async def create(
    *, nonce: str, code_verifier: Optional[str], return_to: str
) -> str:
    """Open a login transaction and return its `state`."""
    state = new_token()
    expires_at = datetime.now(timezone.utc) + TRANSACTION_TTL
    document = {
        "_id": state,
        "nonce": nonce,
        "code_verifier": code_verifier,
        "return_to": return_to,
        "created_at": datetime.now(timezone.utc),
        "expires_at": expires_at,
    }

    handle = _collection()
    if handle is not None:
        try:
            await handle.insert_one(document)
            return state
        except Exception as exc:
            print(f"⚠️ oidc transaction write failed, using memory: {type(exc).__name__}")

    _prune_memory()
    _memory[state] = {**document, "expires_ts": expires_at.timestamp()}
    return state


async def consume(state: str) -> Optional[dict[str, Any]]:
    """Take the transaction, atomically. A second call with the same state
    returns None — that is the replay defence, not a side effect."""
    if not state:
        return None

    handle = _collection()
    if handle is not None:
        try:
            document = await handle.find_one_and_delete({"_id": state})
        except Exception as exc:
            print(f"⚠️ oidc transaction read failed, using memory: {type(exc).__name__}")
            document = None
        if document is not None:
            expires_at = document.get("expires_at")
            if isinstance(expires_at, datetime):
                # Cosmos/Mongo TTL sweeps on its own schedule; a document may
                # still be readable minutes after it expired.
                deadline = expires_at if expires_at.tzinfo else expires_at.replace(
                    tzinfo=timezone.utc)
                if deadline < datetime.now(timezone.utc):
                    return None
            return document

    _prune_memory()
    row = _memory.pop(state, None)
    if row is None or row["expires_ts"] <= time.time():
        return None
    return row
