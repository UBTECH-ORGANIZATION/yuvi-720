"""Turn earned badges and a live day streak into granted cosmetics.

`unlocks.py` says what the rules are; this says when they are applied. It is
called from the two reads that always happen before a learner can use a reward —
opening the studio (`GET /api/rewards/catalog`) and looking at the shelf
(`GET /api/badges`) — so a grant never depends on a background job.

Every grant goes through the rewards ledger's claim, so re-running this is free
and a reward is only ever announced once.
"""

from __future__ import annotations

from typing import Any

from app.brain.repository import get_brain
from app.services import kata_catalog, unlocks
from app.services.badges import project_badges
from app.services.events import get_learner_events
from app.services.rewards.wallet import grant_unlock
from app.services.streaks import active_days, current_day_streak
from learner_state import get_learner_state, grant_room_unlock  # type: ignore


async def _learner_events(learner_id: str) -> list[dict[str, Any]]:
    try:
        return await get_learner_events(learner_id)
    except Exception:
        return []


async def sync_unlocks(learner_id: str) -> dict[str, Any]:
    """Grant everything the learner now qualifies for. Returns what they hold.

    Never revokes: a streak reward stays earned after the streak breaks, because
    taking a reward back would punish a learner for missing a day.
    """
    await kata_catalog.ensure_loaded()
    brain = await get_brain(learner_id)
    events = await _learner_events(learner_id)
    badges = project_badges(brain, events=events)
    streak = current_day_streak(active_days(events))

    state = await get_learner_state(learner_id)
    held_avatar = set(state.get("avatar_unlocks") or [])
    held_props = set(state.get("room_unlocks") or [])

    newly: list[str] = []
    for item_id in sorted(unlocks.satisfied_ids(badges, streak)):
        entry = unlocks.UNLOCKS[item_id]
        if entry["kind"] == "avatar":
            if item_id in held_avatar:
                continue
            # The ledger claim is what makes this idempotent across every caller.
            result = await grant_unlock(learner_id, item_id, f"earn:{item_id}")
            if result.get("granted"):
                held_avatar.add(item_id)
                newly.append(item_id)
        else:
            if item_id in held_props:
                continue
            await grant_room_unlock(learner_id, item_id)
            held_props.add(item_id)
            newly.append(item_id)

    return {
        "avatar_unlocks": sorted(held_avatar),
        "room_unlocks": sorted(held_props),
        "streak": streak,
        "newly_unlocked": newly,
    }


async def held_props(learner_id: str) -> set[str]:
    """Room items this learner has earned. Used to screen room writes."""
    state = await get_learner_state(learner_id)
    return set(state.get("room_unlocks") or [])
