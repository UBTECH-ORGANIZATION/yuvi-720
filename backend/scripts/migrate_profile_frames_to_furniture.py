"""Replace retired profile-frame unlocks with their earned room furniture.

    python scripts/migrate_profile_frames_to_furniture.py --dry-run
    python scripts/migrate_profile_frames_to_furniture.py --apply

The migration is idempotent: room props are added with ``$addToSet`` and only
the former profile-frame ids are removed from ``avatar_unlocks``.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: F401 - loads .env before database configuration is read

from app.brain.repository import _get_collection_named


FRAME_REPLACEMENTS = {
    "profile_level_frame_11": "level_furniture_11",
    "profile_level_frame_22": "level_furniture_22",
    **{
        f"prestige_level_frame_{level}": f"prestige_level_furniture_{level}"
        for level in range(30, 51)
    },
}


def build_update(state: dict[str, Any]) -> dict[str, Any] | None:
    avatar_unlocks = {str(item) for item in state.get("avatar_unlocks") or []}
    retired = sorted(avatar_unlocks & FRAME_REPLACEMENTS.keys())
    if not retired:
        return None
    replacements = sorted(FRAME_REPLACEMENTS[item_id] for item_id in retired)
    return {
        "$pull": {"avatar_unlocks": {"$in": retired}},
        "$addToSet": {"room_unlocks": {"$each": replacements}},
    }


async def migrate(collection: Any, *, apply: bool) -> tuple[int, int]:
    learners = 0
    replacements = 0
    async for state in collection.find({"avatar_unlocks": {"$in": list(FRAME_REPLACEMENTS)}}):
        update = build_update(state)
        if update is None:
            continue
        learners += 1
        replacements += len(update["$addToSet"]["room_unlocks"]["$each"])
        if apply:
            await collection.update_one({"_id": state["_id"]}, update)
    return learners, replacements


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the changes; dry-run is the default")
    args = parser.parse_args(argv)
    collection = _get_collection_named("learner_state")
    if collection is None:
        raise SystemExit("learner_state database handle is required")
    learners, replacements = await migrate(collection, apply=args.apply)
    verb = "migrated" if args.apply else "would migrate"
    print(f"{verb} {learners} learner(s); replace {replacements} retired profile-frame unlock(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))