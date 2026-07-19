"""Password hashing for local accounts.

Stdlib PBKDF2-SHA256 — the repo carries no bcrypt/passlib/argon2 and
`app.services.events` already leans on `hashlib`/`hmac`/`secrets`, so this adds
no dependency. Parameters live in the stored record so they can be raised later
without a migration.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any, Optional

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 600_000  # OWASP guidance for PBKDF2-SHA256
SALT_BYTES = 16


def hash_password(plain: str, *, iterations: int = ITERATIONS) -> dict[str, Any]:
    salt = secrets.token_bytes(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, iterations)
    return {
        "algo": ALGORITHM,
        "iterations": iterations,
        "salt": salt.hex(),
        "hash": digest.hex(),
    }


def verify_password(plain: str, record: Optional[dict[str, Any]]) -> bool:
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


# A throwaway record used to burn the same CPU on unknown usernames, so login
# timing cannot be used to enumerate accounts.
_DUMMY_RECORD = hash_password("yuvi720-dummy-password")


def burn_timing() -> None:
    verify_password("yuvi720-dummy-password-x", _DUMMY_RECORD)
