"""Remove a wellbeing flag and everything raised with it.

    python scripts/purge_wellbeing_flag.py wb_1786530157_8d28b8

For checks that raise a real flag against a real environment. Deliberately a
script and not an endpoint: deleting the record of a child's disclosure is not a
capability the product should own just so a test can tidy up after itself.

Removes, for one flag id: the row, the brain array entry, the teacher alerts it
raised, and the bell notifications those alerts created.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


async def main(flag_id: str) -> None:
    from app.brain.repository import _get_collection_named, apply_brain_updates, get_brain

    removed: dict[str, int] = {}

    flags = _get_collection_named("wellbeing_flags")
    learner_id = ""
    if flags is not None:
        row = await flags.find_one({"_id": flag_id})
        learner_id = str((row or {}).get("learner_id") or "")
        removed["wellbeing_flags"] = (await flags.delete_many({"_id": flag_id})).deleted_count

    alerts = _get_collection_named("teacher_alerts")
    if alerts is not None:
        result = await alerts.delete_many({"_id": {"$regex": f":{flag_id}$"}})
        removed["teacher_alerts"] = result.deleted_count

    notifications = _get_collection_named("notifications")
    if notifications is not None:
        result = await notifications.delete_many({"_id": {"$regex": flag_id}})
        removed["notifications"] = result.deleted_count

    if learner_id:
        brain = await get_brain(learner_id)
        kept = [flag for flag in (brain.get("wellbeing_flags") or [])
                if not (isinstance(flag, dict) and str(flag.get("id")) == flag_id)]
        await apply_brain_updates(learner_id, {"wellbeing_flags": kept})
        removed["brain_entries"] = len(brain.get("wellbeing_flags") or []) - len(kept)

    print(removed)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: purge_wellbeing_flag.py <flag_id>")
    asyncio.run(main(sys.argv[1]))
