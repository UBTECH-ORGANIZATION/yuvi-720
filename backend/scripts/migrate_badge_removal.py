"""Remove legacy achievement-badge state and backfill replacement XP rewards.

    python scripts/migrate_badge_removal.py --dry-run
    python scripts/migrate_badge_removal.py

The badge system used the learner-state ``avatar`` field for profile coins and,
before that field was split, for the Yuvi Studio design. Badge-gated Studio
items now belong to explicit XP levels. This migration preserves a Studio-shaped
legacy avatar, removes obsolete badge/profile-avatar state, and grants each
replacement item to learners who already claimed its XP level.

All grants use ``$addToSet`` and cleanup uses ``$unset``, so the migration is
safe to rerun and never removes an existing cosmetic or room entitlement.
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
from app.services.progression.rewards import LEVEL_REWARDS


REPLACEMENT_LEVELS = (4, 7, 12, 16, 19, 21, 28)


def _legacy_studio_design(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or value.get("kind"):
        return None
    if not any(key in value for key in ("variant", "colors", "equipped")):
        return None
    return value


def _replacement_unlocks(claimed_levels: Any) -> tuple[list[str], list[str]]:
    claimed = {
        int(level)
        for level in (claimed_levels or [])
        if isinstance(level, (int, str)) and str(level).isdigit()
    }
    avatar: set[str] = set()
    room: set[str] = set()
    for level in REPLACEMENT_LEVELS:
        if level not in claimed:
            continue
        reward = LEVEL_REWARDS[level]
        avatar.update(str(item) for item in reward.get("avatar") or [])
        room.update(str(item) for item in reward.get("room") or [])
    return sorted(avatar), sorted(room)


def build_update(
    learner_id: str,
    state: dict[str, Any],
    progression: dict[str, Any],
) -> dict[str, Any]:
    avatar_unlocks, room_unlocks = _replacement_unlocks(
        progression.get("claimed_level_rewards")
    )
    avatar_unlocks = sorted(set(avatar_unlocks) - set(state.get("avatar_unlocks") or []))
    room_unlocks = sorted(set(room_unlocks) - set(state.get("room_unlocks") or []))
    set_fields: dict[str, Any] = {"learner_id": learner_id}
    legacy_design = _legacy_studio_design(state.get("avatar"))
    if not state.get("yuvi_design") and legacy_design is not None:
        set_fields["yuvi_design"] = legacy_design

    update: dict[str, Any] = {
        "$set": set_fields,
        "$unset": {"avatar": "", "badges": ""},
    }
    add_to_set: dict[str, Any] = {}
    if avatar_unlocks:
        add_to_set["avatar_unlocks"] = {"$each": avatar_unlocks}
    if room_unlocks:
        add_to_set["room_unlocks"] = {"$each": room_unlocks}
    if add_to_set:
        update["$addToSet"] = add_to_set
    return update


async def _rows_by_id(collection: Any) -> dict[str, dict[str, Any]]:
    return {str(row["_id"]): row async for row in collection.find({})}


async def migrate(state_collection: Any, progression_collection: Any, *, dry_run: bool) -> dict[str, int]:
    states = await _rows_by_id(state_collection)
    progressions = await _rows_by_id(progression_collection)
    learner_ids = sorted(set(states) | set(progressions))
    stats = {"learners": len(learner_ids), "legacy_designs": 0, "reward_grants": 0}

    for learner_id in learner_ids:
        state = states.get(learner_id, {})
        progression = progressions.get(learner_id, {})
        update = build_update(learner_id, state, progression)
        if "yuvi_design" in update["$set"]:
            stats["legacy_designs"] += 1
        stats["reward_grants"] += sum(
            len(spec["$each"]) for spec in update.get("$addToSet", {}).values()
        )
        if not dry_run:
            await state_collection.update_one({"_id": learner_id}, update, upsert=True)
    return stats


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    state_collection = _get_collection_named("learner_state")
    progression_collection = _get_collection_named("learner_progression")
    if state_collection is None or progression_collection is None:
        raise SystemExit("learner_state and learner_progression database handles are required")

    stats = await migrate(state_collection, progression_collection, dry_run=args.dry_run)
    prefix = "dry run: would process" if args.dry_run else "processed"
    print(
        f"{prefix} {stats['learners']} learner(s); preserve "
        f"{stats['legacy_designs']} legacy Studio design(s); apply "
        f"{stats['reward_grants']} replacement entitlement grant(s)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))