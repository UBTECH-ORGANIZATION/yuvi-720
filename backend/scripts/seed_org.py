"""Seed / import the org roster (schools · groups · teacher links · enrollments).

Replaces the hardcoded constants that used to live in `app/brain/org.py`. The
scoping API is unchanged; only storage moved.

Idempotent — every write is an upsert by `_id`, so re-running is safe and never
touches learning data.

Run:
    cd backend && ./.venv/bin/python scripts/seed_org.py --demo
    cd backend && ./.venv/bin/python scripts/seed_org.py --from-json roster.json
    cd backend && ./.venv/bin/python scripts/seed_org.py --make-admin gal

`--from-json` expects the same shape this script writes:

    {
      "schools":     [{"id": "...", "name": "...", "moe_code": "...", "city": "..."}],
      "groups":      [{"id": "...", "school_id": "...", "name": "...",
                       "subject": "...", "grade": "...", "year": "..."}],
      "teacher_links": [{"teacher_id": "...", "group_id": "...", "link_role": "teacher"}],
      "enrollments":   [{"learner_id": "...", "group_id": "..."}]
    }
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.env import ensure_env_loaded  # noqa: E402  (loads .env for scripts)

ensure_env_loaded()

from app.services import org_repository  # noqa: E402

# The demo org reproduces what `org.py` used to hardcode, plus one co-taught
# group so the "several teachers may see the same student" path is actually
# exercised rather than merely supported.
DEMO = {
    "schools": [
        {"id": "school-rabin", "name": "בית ספר רבין, נתניה", "city": "נתניה"},
    ],
    "groups": [
        {"id": "group-gal", "school_id": "school-rabin", "name": "יובי 720 · Gal",
         "subject": "math", "grade": "ז"},
        {"id": "group-moti", "school_id": "school-rabin", "name": "יובי 720 · Moti",
         "subject": "math", "grade": "ז"},
        {"id": "group-720-a", "school_id": "school-rabin", "name": "יובי 720 · כיתה א׳",
         "subject": "math", "grade": "ז"},
    ],
    "teacher_links": [
        {"teacher_id": "gal", "group_id": "group-gal", "link_role": "homeroom"},
        {"teacher_id": "moti", "group_id": "group-moti", "link_role": "homeroom"},
        # Co-taught: both teachers reach every learner enrolled in group-720-a.
        {"teacher_id": "gal", "group_id": "group-720-a", "link_role": "teacher"},
        {"teacher_id": "moti", "group_id": "group-720-a", "link_role": "teacher"},
    ],
    "enrollments": [
        {"learner_id": "gal", "group_id": "group-gal"},
        {"learner_id": "moti", "group_id": "group-moti"},
    ],
}


async def apply(payload: dict) -> None:
    await org_repository.ensure_indexes()

    for school in payload.get("schools") or []:
        await org_repository.upsert_school(
            school["id"], name=school.get("name") or school["id"],
            moe_code=school.get("moe_code"), city=school.get("city"),
        )
        print(f"✅ school {school['id']}")

    for group in payload.get("groups") or []:
        await org_repository.upsert_group(
            group["id"], school_id=group["school_id"],
            name=group.get("name") or group["id"], subject=group.get("subject"),
            grade=group.get("grade"), year=group.get("year"),
        )
        print(f"✅ group {group['id']}")

    groups_by_id = {group["id"]: group for group in payload.get("groups") or []}

    for link in payload.get("teacher_links") or []:
        group = groups_by_id.get(link["group_id"]) or {}
        await org_repository.link_teacher(
            link["teacher_id"], link["group_id"],
            school_id=group.get("school_id"),
            link_role=link.get("link_role") or "teacher",
        )
        print(f"🔗 {link['teacher_id']} → {link['group_id']}")

    for enrollment in payload.get("enrollments") or []:
        group = groups_by_id.get(enrollment["group_id"]) or {}
        await org_repository.enroll_learner(
            enrollment["learner_id"], enrollment["group_id"],
            school_id=group.get("school_id"),
        )
        print(f"👤 {enrollment['learner_id']} → {enrollment['group_id']}")


async def make_admin(user_id: str, scope: str, school_ids: list[str]) -> None:
    await org_repository.grant_admin(
        user_id, scope=scope, school_ids=school_ids, granted_by="seed_org",
    )
    print(
        f"🛡️  {user_id} granted admin (scope: {scope}).\n"
        f"    Also add \"admin\" to their users.roles and RE-LOGIN — roles are "
        f"baked into the 12h session token, so the route gate only sees it on "
        f"the next login. Data scope is read live from org_admins."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed or import the org roster")
    parser.add_argument("--demo", action="store_true",
                        help="Seed the built-in demo org (schools/groups/links/enrollments)")
    parser.add_argument("--from-json", dest="from_json",
                        help="Import a roster JSON file (see module docstring)")
    parser.add_argument("--make-admin", dest="make_admin",
                        help="Grant an admin org record to a user id")
    parser.add_argument("--admin-scope", default="system", choices=["system", "school"])
    parser.add_argument("--admin-schools", default="",
                        help="Comma-separated school ids for a school-scoped admin")
    args = parser.parse_args()

    if not (args.demo or args.from_json or args.make_admin):
        parser.error("nothing to do — pass --demo, --from-json or --make-admin")

    async def run() -> None:
        if args.demo:
            await apply(DEMO)
        if args.from_json:
            payload = json.loads(Path(args.from_json).read_text(encoding="utf-8"))
            await apply(payload)
        if args.make_admin:
            schools = [s.strip() for s in args.admin_schools.split(",") if s.strip()]
            await make_admin(args.make_admin, args.admin_scope, schools)

    asyncio.run(run())


if __name__ == "__main__":
    main()
