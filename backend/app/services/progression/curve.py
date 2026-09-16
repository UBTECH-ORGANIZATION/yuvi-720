"""Versioned XP thresholds and pure level calculations."""

from __future__ import annotations

from typing import Any

RULES_VERSION = 1
MAX_LEVEL = 50

# Index N is the cumulative XP required to enter level N + 1. Keeping the
# approved values explicit prevents a formula edit from rewriting history.
XP_TO_NEXT: tuple[int, ...] = (
    100, 125, 150, 175, 200, 225, 250, 275, 300, 350,
    400, 450, 500, 550, 600, 650, 700, 750, 800, 900,
    1_100, 1_350, 1_700, 2_100, 2_600, 3_250, 4_050,
    1_100, 1_100, 1_100, 1_100, 1_100, 1_100, 1_100,
    1_100, 1_100, 1_100, 1_100, 1_100, 1_100, 1_100,
    1_100, 1_100, 1_100, 1_100, 1_100, 1_100, 1_100, 1_100,
)


def _cumulative_thresholds() -> tuple[int, ...]:
    total = 0
    thresholds = [0, 0]
    for amount in XP_TO_NEXT:
        total += amount
        thresholds.append(total)
    return tuple(thresholds)


# Index is the level; value is cumulative XP required to enter that level.
LEVEL_START_XP = _cumulative_thresholds()


def status_for_total_xp(total_xp: int) -> dict[str, Any]:
    """Return level and current-level progress for a non-negative XP total."""
    safe_total = max(0, int(total_xp))
    level = MAX_LEVEL
    for candidate in range(1, MAX_LEVEL):
        if safe_total < LEVEL_START_XP[candidate + 1]:
            level = candidate
            break

    level_start = LEVEL_START_XP[level]
    if level == MAX_LEVEL:
        return {
            "level": level,
            "totalXp": safe_total,
            "currentLevelXp": max(0, safe_total - level_start),
            "xpToNext": None,
            "nextLevel": None,
            "nextLevelTotalXp": None,
            "progress": 1.0,
            "rulesVersion": RULES_VERSION,
        }

    xp_to_next = XP_TO_NEXT[level - 1]
    current_level_xp = safe_total - level_start
    return {
        "level": level,
        "totalXp": safe_total,
        "currentLevelXp": current_level_xp,
        "xpToNext": xp_to_next,
        "nextLevel": level + 1,
        "nextLevelTotalXp": LEVEL_START_XP[level + 1],
        "progress": current_level_xp / xp_to_next,
        "rulesVersion": RULES_VERSION,
    }