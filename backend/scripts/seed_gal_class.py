"""Seed Gal's real class — actual user accounts, not demo fixtures.

Creates learner accounts (dvir, noam, tamar, itay — password like seed_users),
then the org rows: group `gal-class` ("הכיתה של גל") at school-rabin with GAL as
its teacher and gal, moti, dvir, noam, tamar, itay enrolled. When gal signs into
the teacher portal this class is in the group switcher next to the demo one.

Idempotent — upserts everywhere; safe to re-run.

Run:  cd backend && ./.venv/bin/python scripts/seed_gal_class.py
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import apply_brain_updates, get_brain  # noqa: E402
from app.services import org_repository  # noqa: E402

DEFAULT_PASSWORD = "Aa12345"

# New learner-only accounts. gal and moti already exist via seed_users.py.
NEW_LEARNERS = [
    {"_id": "dvir", "username": "dvir", "display_name": "דביר"},
    {"_id": "noam", "username": "noam", "display_name": "נועם"},
    {"_id": "tamar", "username": "tamar", "display_name": "תמר"},
    {"_id": "itay", "username": "itay", "display_name": "איתי"},
]

GROUP_ID = "gal-class"
SCHOOL_ID = "school-rabin"
STUDENTS = ["gal", "moti", "dvir", "noam", "tamar", "itay"]


async def seed(password: str) -> None:
    for account in NEW_LEARNERS:
        await upsert_user({
            **account,
            "roles": ["learner"],
            "password": hash_password(password),
            "preferences": {**DEFAULT_PREFERENCES, "theme": "system", "language": "he"},
        })
        await get_brain(account["_id"])
        await apply_brain_updates(account["_id"], {
            "identity.display_name": account["display_name"],
            "identity.locale": "he",
        })
        print(f"✅ learner {account['_id']} ({account['display_name']})")

    await org_repository.ensure_indexes()
    await org_repository.upsert_school(
        SCHOOL_ID, name="בית ספר רבין, נתניה", moe_code=None, city="נתניה")
    await org_repository.upsert_group(
        GROUP_ID, school_id=SCHOOL_ID, name="הכיתה של גל",
        subject="math", grade="ז", year=None)
    print(f"✅ group {GROUP_ID} (הכיתה של גל)")

    await org_repository.link_teacher(
        "gal", GROUP_ID, school_id=SCHOOL_ID, link_role="homeroom")
    print(f"🔗 gal → {GROUP_ID}")

    for learner_id in STUDENTS:
        await org_repository.enroll_learner(learner_id, GROUP_ID, school_id=SCHOOL_ID)
        print(f"👤 {learner_id} → {GROUP_ID}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed Gal's real class")
    parser.add_argument(
        "--password",
        default=os.environ.get("SEED_USER_PASSWORD", DEFAULT_PASSWORD),
        help="Password for the new learner accounts (env: SEED_USER_PASSWORD)",
    )
    args = parser.parse_args()
    asyncio.run(seed(args.password))


if __name__ == "__main__":
    main()
