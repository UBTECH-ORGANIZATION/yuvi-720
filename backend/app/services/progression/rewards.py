"""Idempotent settlement of rewards earned by reaching XP levels."""

from __future__ import annotations

from typing import Any, Optional

from app.services.progression import ledger
from app.services.rewards import grant_level_sparks
from learner_state import (  # type: ignore
    grant_avatar_unlock,
    grant_room_unlock,
    normalize_learner_id,
)


LEVEL_REWARDS: dict[int, dict[str, Any]] = {
    2: {"sparks": 30},
    3: {"room": ["studio_wall_decals_03", "neon"]},
    4: {"sparks": 40, "room": ["trophyShelf"]},
    5: {"room": ["level_furniture_05"]},
    6: {"room": ["room_ambient_lights_06", "stringLights"]},
    7: {"sparks": 50, "avatar": ["laurel"]},
    8: {"room": ["studio_desk_accessory_08", "globe"]},
    9: {"room": ["level_furniture_09", "parkCarousel"]},
    10: {"sparks": 25, "room": ["room_audio_theme_10", "layout:sportsArena", "rocketModel"]},
    11: {"room": ["level_furniture_11"]},
    12: {"sparks": 60, "room": ["podium"]},
    13: {"room": ["studio_posters_13", "parkTree"]},
    14: {"room": ["level_furniture_14"]},
    15: {"room": ["telescope", "parkBasketSwing"]},
    16: {"sparks": 70, "avatar": ["explorerGoggles"]},
    17: {"room": ["level_furniture_17"]},
    18: {"room": ["level_furniture_18"]},
    19: {"sparks": 80, "room": ["observatory"]},
    20: {
        "room": ["room_theme_20", "layout:creatorLoft", "starProjector"],
        "extra_hint_tokens": 1,
    },
    21: {"sparks": 90, "room": ["mathBoard"]},
    22: {"room": ["level_furniture_22"]},
    23: {"room": ["studio_display_shelf_23", "trophies"]},
    24: {"room": ["level_furniture_24"]},
    25: {"sparks": 50, "avatar": ["dragonwings"]},
    26: {"room": ["level_furniture_26"]},
    27: {"room": ["premium_room_ambience_27"]},
    28: {"sparks": 120, "room": ["championBanner"]},
    29: {"room": ["personal_journey_monument_29"]},
}

PRESTIGE_ROOM_LEVELS = frozenset({30, 35, 40, 45, 50})


def reward_for_level(level: int) -> dict[str, Any]:
    normalized = int(level)
    if normalized in LEVEL_REWARDS:
        return {**LEVEL_REWARDS[normalized]}
    if 30 <= normalized <= 50:
        reward: dict[str, Any] = {
            "sparks": 100,
            "room": [f"prestige_level_furniture_{normalized}"],
        }
        if normalized in PRESTIGE_ROOM_LEVELS:
            reward["room"].append(f"prestige_room_object_{normalized}")
        return reward
    return {}


def public_reward_for_level(level: int) -> dict[str, Any]:
    reward = reward_for_level(level)
    return {
        "level": int(level),
        "sparks": int(reward.get("sparks") or 0),
        "extraHintTokens": int(reward.get("extra_hint_tokens") or 0),
        "avatarUnlocks": list(reward.get("avatar") or []),
        "roomUnlocks": list(reward.get("room") or []),
    }


async def settle_through_level(
    learner_id: Optional[str], reached_level: int
) -> list[dict[str, Any]]:
    """Grant every unclaimed reward through ``reached_level`` exactly once."""
    lid = normalize_learner_id(learner_id)
    status = await ledger.get_status(lid)
    claimed = set(status.get("claimedLevelRewards") or [])
    settled: list[dict[str, Any]] = []
    for level in range(2, min(50, int(reached_level)) + 1):
        if level in claimed:
            continue
        reward = reward_for_level(level)
        sparks = int(reward.get("sparks") or 0)
        if sparks:
            await grant_level_sparks(lid, level, sparks)
        for asset_id in reward.get("avatar") or []:
            await grant_avatar_unlock(lid, asset_id)
        for asset_id in reward.get("room") or []:
            await grant_room_unlock(lid, asset_id)
        hint_tokens = int(reward.get("extra_hint_tokens") or 0)
        if hint_tokens:
            await ledger.claim_entitlement_once(
                lid,
                key=f"level:{level}:extra_hint_tokens",
                field="extra_hint_tokens",
                amount=hint_tokens,
            )
        await ledger.mark_level_reward_claimed(lid, level)
        settled.append(public_reward_for_level(level))
    return settled