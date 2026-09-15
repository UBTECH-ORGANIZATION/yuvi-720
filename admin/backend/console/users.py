"""Accounts (``users`` collection) and password hashing, as Spark stores them.

Ported from Spark's ``app/auth/repository.py`` (only the lookups and the
creation path the console needs) and ``app/auth/passwords.py`` (copied
verbatim: Spark verifies the hashes this service writes, so the algorithm,
iteration count and record shape must stay byte-for-byte compatible).

``_id`` == ``user_id`` == ``learner_id``, so the document shape written here is
exactly what Spark's login reads.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

USERS = "users"

# ── passwords (identical to Spark's app/auth/passwords.py) ───────────────────

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 600_000  # OWASP guidance for PBKDF2-SHA256
SALT_BYTES = 16


def hash_password(plain: str, *, iterations: int = ITERATIONS) -> Dict[str, Any]:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations)
    return {
        "algo": ALGORITHM,
        "iterations": iterations,
        "salt": salt.hex(),
        "hash": digest.hex(),
    }


def verify_password(plain: str, record: Optional[Dict[str, Any]]) -> bool:
    """Constant-time verify. Returns False (never raises) on a malformed record."""
    if not isinstance(record, dict):
        return False
    try:
        if record.get("algo") != ALGORITHM:
            return False
        salt = bytes.fromhex(record["salt"])
        expected = bytes.fromhex(record["hash"])
        iterations = int(record["iterations"])
    except (KeyError, TypeError, ValueError):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(digest, expected)


# ── document shape (mirrors Spark's DEFAULT_PREFERENCES) ─────────────────────

DEFAULT_PREFERENCES: Dict[str, Any] = {
    "theme": "system",
    "theme_updated_at": 0,
    "language": "he",
    "reduced_motion": False,
    "tours_completed": [],
    "teacher_group_id": None,
    "teacher_subgroup_id": None,
    "teacher_subject": None,
    "teacher_period": "week",
    "teacher_roster_view": "table",
    "teacher_roster_columns": [],
    "teacher_book_seen": {},
}

ROLES = ("learner", "teacher", "admin")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_username(value: str) -> str:
    return (value or "").strip().lower()


def public_user(document: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Strip credentials. EVERY read that reaches a client must go through this."""
    if not document:
        return None
    preferences = {**DEFAULT_PREFERENCES, **(document.get("preferences") or {})}
    return {
        "user_id": document.get("_id") or document.get("user_id"),
        "username": document.get("username"),
        "display_name": document.get("display_name"),
        "roles": list(document.get("roles") or []),
        "preferences": preferences,
    }


class UserRepository:
    """The console's view of ``users``: lookups, listing, and provisioning."""

    def __init__(self, db: Any) -> None:
        self._db = db

    def _collection(self) -> Any:
        return self._db.collection(USERS)

    async def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        return await self._collection().find_one({"_id": user_id})

    async def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        handle = normalize_username(username)
        if not handle:
            return None
        return await self._collection().find_one({"username": handle})

    async def list_users(
        self, *, role: Optional[str] = None, query: Optional[str] = None, limit: int = 500
    ) -> List[Dict[str, Any]]:
        """All accounts, optionally narrowed by role or a name/username substring.

        Admin-only by construction; every row still goes out through
        ``public_user`` so credentials never leave this module.
        """
        selector: Dict[str, Any] = {}
        if role:
            selector["roles"] = role
        documents = await self._collection().find(selector).to_list(length=limit)

        needle = (query or "").strip().lower()
        if needle:
            documents = [
                document for document in documents
                if needle in (document.get("username") or "").lower()
                or needle in (document.get("display_name") or "").lower()
                or needle in str(document.get("_id") or "").lower()
            ]
        documents.sort(key=lambda document: (document.get("display_name") or "").lower())
        return documents[:limit]

    async def upsert_user(self, document: Dict[str, Any]) -> Dict[str, Any]:
        user_id = document["_id"]
        payload = {**document, "updated_at": _now()}
        payload.setdefault("created_at", payload["updated_at"])
        payload.setdefault("preferences", dict(DEFAULT_PREFERENCES))
        await self._collection().update_one({"_id": user_id}, {"$set": payload}, upsert=True)
        return payload
