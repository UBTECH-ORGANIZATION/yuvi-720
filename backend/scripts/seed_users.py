"""Seed the real local accounts (gal, moti).

Creates/updates the `users` documents and makes sure each has a brain document
in `learners`, so onboarding, dashboards and the teacher view all resolve.

Idempotent — safe to re-run; it upserts by `_id` and never touches learning data.

Run:  cd backend && ./.venv/bin/python scripts/seed_users.py
      cd backend && ./.venv/bin/python scripts/seed_users.py --password 'S3cret!'
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import apply_brain_updates, get_brain  # noqa: E402

DEFAULT_PASSWORD = "Aa12345"

ACCOUNTS = [
    {"_id": "gal", "username": "gal", "display_name": "Gal"},
    {"_id": "moti", "username": "moti", "display_name": "Moti"},
]

ROLES = ["learner", "teacher"]


async def seed(password: str) -> None:
    for account in ACCOUNTS:
        document = {
            **account,
            "roles": list(ROLES),
            "password": hash_password(password),
            "preferences": {**DEFAULT_PREFERENCES, "theme": "system", "language": "he"},
        }
        await upsert_user(document)

        # Ensure a brain exists (get_brain creates it from `empty_brain`).
        await get_brain(account["_id"])
        await apply_brain_updates(account["_id"], {
            "identity.display_name": account["display_name"],
            "identity.locale": "he",
        })
        print(f"✅ seeded user {account['_id']} (roles: {', '.join(ROLES)})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed local user accounts")
    parser.add_argument(
        "--password",
        default=os.environ.get("SEED_USER_PASSWORD", DEFAULT_PASSWORD),
        help="Password for every seeded account (env: SEED_USER_PASSWORD)",
    )
    args = parser.parse_args()

    if args.password == DEFAULT_PASSWORD:
        print(
            "⚠️  Using the default development password. Set --password or "
            "SEED_USER_PASSWORD before seeding anything reachable from the internet."
        )

    asyncio.run(seed(args.password))


if __name__ == "__main__":
    main()
