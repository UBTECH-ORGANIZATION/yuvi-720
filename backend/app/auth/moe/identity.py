"""exidentifier → the opaque `learner_id` the rest of the app runs on.

The brain, every learning event and every agent prompt are keyed by
`learner_id`. The architecture requires that key to be non-identifying, so it
is an HMAC of the ministry's scrambled id under a server-side pepper: stable
across logins (the same child always returns to the same brain), and useless to
anyone who obtains it without the pepper.

The exidentifier itself is kept only on the `users` document, where the LRS
reporter reads it to address outbound statements.
"""

from __future__ import annotations

import hashlib
import hmac

from app.auth.moe import config

# Prefix so a ministry-provisioned account is recognisable in the database
# without holding the exidentifier next to it.
LEARNER_ID_PREFIX = "moe_"
_DIGEST_LENGTH = 32


def derive_learner_id(exidentifier: str) -> str:
    """Deterministic, opaque account id for a ministry identity."""
    normalized = (exidentifier or "").strip()
    if not normalized:
        raise ValueError("exidentifier is required to derive a learner id")
    digest = hmac.new(
        config.id_pepper().encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{LEARNER_ID_PREFIX}{digest[:_DIGEST_LENGTH]}"


def is_ministry_account(user_id: str) -> bool:
    return (user_id or "").startswith(LEARNER_ID_PREFIX)
