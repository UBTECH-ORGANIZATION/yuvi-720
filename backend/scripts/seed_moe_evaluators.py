"""MoE evaluator accounts for the 720 English tender — seed, report, tear down.

The ministry asked for a teacher login *and* a student login per reviewer. Each
reviewer therefore gets a pair, and all three students sit in one group that all
three teachers are linked to, so a reviewer signing in as a teacher immediately
has a roster to look at instead of an empty class.

Learner brains are deliberately left EMPTY: the initial mapping questionnaire
(F2) is itself under evaluation, so a pre-seeded profile would hide the very
flow they came to see.

Every document is tagged ``moe_fixture`` and ``--teardown`` deletes strictly by
that tag, so this is safe to run against the live database.

Usage:
    cd backend && ./.venv/bin/python scripts/seed_moe_evaluators.py --seed
    cd backend && ./.venv/bin/python scripts/seed_moe_evaluators.py --report
    cd backend && ./.venv/bin/python scripts/seed_moe_evaluators.py --teardown
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
import string
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402

ensure_env_loaded()

from app.auth.passwords import hash_password  # noqa: E402
from app.auth.repository import DEFAULT_PREFERENCES, upsert_user  # noqa: E402
from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain  # noqa: E402
from app.services import org_repository  # noqa: E402

TAG = "moe-720-english"
SCHOOL = "moe-eval-school"
GROUP = "moe-eval-group-en"

TAGGED_COLLECTIONS = (
    "users", "learners", "learner_state", "learning_events", "learner_activity",
    "org_schools", "org_groups", "org_teacher_links", "org_enrollments",
)

# One reviewer → one teacher account + one student account.
# Labels avoid slash-in-word forms (תלמיד/ה) — MoE usability guidance §2.11 bans them
# because screen readers stumble over them.
REVIEWERS = [
    {"slug": "moe-1", "email": "Matrix4moe2026@gmail.com", "label": "בדיקה 1"},
    {"slug": "moe-2", "email": "7204moe2026@gmail.com", "label": "בדיקה 2"},
    {"slug": "moe-3", "email": "startinntech@gmail.com", "label": "בדיקה 3"},
]


def teacher_id(slug: str) -> str:
    return f"{slug}-teacher"


def student_id(slug: str) -> str:
    return f"{slug}-student"


def generate_password() -> str:
    """Ambiguity-free alphabet — these get retyped from an email by hand."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(14))


async def seed(password: str) -> None:
    await org_repository.ensure_indexes()

    await org_repository.upsert_school(SCHOOL, name="בית ספר להתנסות · תוכנית 720", city="—")
    await org_repository.upsert_group(
        GROUP, school_id=SCHOOL, name="כיתה ז׳ · אנגלית · התנסות", subject="english", grade="ז"
    )

    for reviewer in REVIEWERS:
        tid, sid = teacher_id(reviewer["slug"]), student_id(reviewer["slug"])

        await upsert_user({
            "_id": tid, "username": tid,
            "display_name": f"מורה · {reviewer['label']}",
            "roles": ["teacher"], "password": hash_password(password),
            "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
            "moe_email": reviewer["email"],
        })
        await org_repository.link_teacher(tid, GROUP, school_id=SCHOOL)

        await upsert_user({
            "_id": sid, "username": sid,
            "display_name": f"תלמיד · {reviewer['label']}",
            "roles": ["learner"], "password": hash_password(password),
            "preferences": {**DEFAULT_PREFERENCES, "language": "he"},
            "moe_email": reviewer["email"],
        })
        await get_brain(sid)
        # The teacher roster reads the name off the brain, not the user document.
        await apply_brain_updates(sid, {
            "identity.display_name": f"תלמיד · {reviewer['label']}",
            "identity.locale": "he",
        })
        await org_repository.enroll_learner(sid, GROUP, school_id=SCHOOL)

        print(f"✅ {reviewer['email']:26s} → {tid} · {sid}")

    await _tag_everything()


async def _tag_everything() -> None:
    ids = [f(r["slug"]) for r in REVIEWERS for f in (teacher_id, student_id)]
    targets = {
        "users": {"_id": {"$in": ids}},
        "learners": {"_id": {"$in": ids}},
        "org_schools": {"_id": SCHOOL},
        "org_groups": {"_id": GROUP},
        "org_teacher_links": {"group_id": GROUP},
        "org_enrollments": {"group_id": GROUP},
    }
    for collection, query in targets.items():
        handle = _get_collection_named(collection)
        if handle is not None:
            await handle.update_many(query, {"$set": {"moe_fixture": TAG}})


async def report() -> None:
    handle = _get_collection_named("users")
    if handle is None:
        print("no database")
        return
    async for user in handle.find({"moe_fixture": TAG}, {"password": 0}):
        print(f"  {user['_id']:16s} roles={user.get('roles')} email={user.get('moe_email')}")


async def teardown() -> None:
    for collection in TAGGED_COLLECTIONS:
        handle = _get_collection_named(collection)
        if handle is None:
            continue
        result = await handle.delete_many({"moe_fixture": TAG})
        if result.deleted_count:
            print(f"🧹 {collection}: removed {result.deleted_count}")


def main() -> None:
    parser = argparse.ArgumentParser(description="MoE evaluator accounts")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--teardown", action="store_true")
    parser.add_argument("--password", default=None, help="defaults to a fresh random one")
    args = parser.parse_args()

    if args.teardown:
        asyncio.run(teardown())
    elif args.report:
        asyncio.run(report())
    elif args.seed:
        password = args.password or generate_password()
        asyncio.run(seed(password))
        print(f"\n🔑 password for all six accounts: {password}")
    else:
        parser.error("choose --seed, --report or --teardown")


if __name__ == "__main__":
    main()
