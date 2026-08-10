"""Remove a browser check's org fixture so the check can be run again.

The admin console check ends by *archiving* its group — that is the assertion
("a group is archived rather than deleted"), and the console deliberately offers
no hard delete for a group with enrollments. Correct product behaviour, but it
means the fixture outlives the run and the next run finds a group that already
exists with members, and fails on a count it never created.

So the reset lives out of band, exactly like `reset_tour.py`: no test-only
endpoint, no weakening of the guardrail the check exists to prove.

    python scripts/clear_check_fixture.py adm-check-group
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.brain.repository import _get_collection_named  # noqa: E402

COLLECTIONS = ("org_groups", "org_teacher_links", "org_enrollments", "org_audit")


async def main() -> int:
    if len(sys.argv) < 2:
        print("usage: clear_check_fixture.py <group_id>")
        return 2
    group_id = sys.argv[1]
    if not group_id.endswith("-check-group"):
        # A blunt guard, but this script deletes org rows: it may only ever be
        # pointed at a fixture, never at a real group.
        print(f"refusing to clear {group_id!r}: not a check fixture")
        return 2

    total = 0
    for name in COLLECTIONS:
        collection = _get_collection_named(name)
        if collection is None:
            continue
        result = await collection.delete_many(
            {"$or": [{"_id": {"$regex": group_id}}, {"group_id": group_id}]})
        total += result.deleted_count
    print(f"cleared {total} row(s) for {group_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
