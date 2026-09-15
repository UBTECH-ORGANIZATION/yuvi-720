"""What a learner has earned the right to wear and to put in their room.

One table, server-side, because cosmetics are earned: `learner_state` keeps
`avatar_unlocks` and `room_unlocks` out of the client-writable allow-list, and
this module is the only thing that decides what belongs in them.

Two rule kinds, both read from signals that already exist:

- ``streak``  — the learner's *current* day streak has reached N days.

Rules only ever add. Once an item is granted it is kept, even if the streak that
earned it later breaks — a reward that can be confiscated is a punishment, and
this product does not punish a learner for missing a day.
"""

from __future__ import annotations

from typing import Any, Iterable

# Requirement copy is keyed, never phrased here: the Studio localizes it, and
# Hebrew is the source language.
Rule = dict[str, Any]

# id -> {kind, rule, requirement_key}
#   kind: 'avatar' (a Yuvi cosmetic) or 'prop' (a room item)
#
UNLOCKS: dict[str, dict[str, Any]] = {
    # ── Yuvi cosmetics ──
    "crown": {"kind": "avatar", "rule": {"type": "section", "number": 4},
              "requirementKey": "YuviStudio.unlock.section4"},
    "jetpack": {"kind": "avatar", "rule": {"type": "section", "number": 5},
                "requirementKey": "YuviStudio.unlock.section5"},
    "ironman": {"kind": "avatar", "rule": {"type": "section", "number": 6},
                "requirementKey": "YuviStudio.unlock.section6"},
    "laurel": {"kind": "avatar", "rule": {"type": "xp_level", "level": 7},
               "requirementKey": "YuviStudio.unlock.level.7"},
    "explorerGoggles": {"kind": "avatar", "rule": {"type": "xp_level", "level": 16},
                        "requirementKey": "YuviStudio.unlock.level.16"},
    "streakScarf": {"kind": "avatar", "rule": {"type": "streak", "days": 3},
                    "requirementKey": "YuviStudio.unlock.streak.3"},
    "cometTrail": {"kind": "avatar", "rule": {"type": "streak", "days": 7},
                   "requirementKey": "YuviStudio.unlock.streak.7"},
    "dragonwings": {"kind": "avatar", "rule": {"type": "xp_level", "level": 25},
                    "requirementKey": "YuviStudio.unlock.level.25"},

    # ── Room furniture ──
    "trophyShelf": {"kind": "prop", "rule": {"type": "xp_level", "level": 4},
                    "requirementKey": "YuviStudio.unlock.level.4"},
    "podium": {"kind": "prop", "rule": {"type": "xp_level", "level": 12},
               "requirementKey": "YuviStudio.unlock.level.12"},
    "observatory": {"kind": "prop", "rule": {"type": "xp_level", "level": 19},
                    "requirementKey": "YuviStudio.unlock.level.19"},
    "rocketModel": {"kind": "prop", "rule": {"type": "xp_level", "level": 10},
                    "requirementKey": "YuviStudio.unlock.level.10"},
    "parkCarousel": {"kind": "prop", "rule": {"type": "xp_level", "level": 9},
                     "requirementKey": "YuviStudio.unlock.level.9"},
    "parkTree": {"kind": "prop", "rule": {"type": "xp_level", "level": 13},
                 "requirementKey": "YuviStudio.unlock.level.13"},
    "parkBasketSwing": {"kind": "prop", "rule": {"type": "xp_level", "level": 15},
                        "requirementKey": "YuviStudio.unlock.level.15"},
    "mathBoard": {"kind": "prop", "rule": {"type": "xp_level", "level": 21},
                  "requirementKey": "YuviStudio.unlock.level.21"},
    "championBanner": {"kind": "prop", "rule": {"type": "xp_level", "level": 28},
                       "requirementKey": "YuviStudio.unlock.level.28"},
    "streakCalendar": {"kind": "prop", "rule": {"type": "streak", "days": 3},
                       "requirementKey": "YuviStudio.unlock.streak.3"},
    "auroraLamp": {"kind": "prop", "rule": {"type": "streak", "days": 7},
                   "requirementKey": "YuviStudio.unlock.streak.7"},
    "neon": {"kind": "prop", "rule": {"type": "xp_level", "level": 3},
              "requirementKey": "YuviStudio.unlock.level.3"},
    "level_furniture_05": {"kind": "prop", "rule": {"type": "xp_level", "level": 5},
                           "requirementKey": "YuviStudio.unlock.level.5"},
    "stringLights": {"kind": "prop", "rule": {"type": "xp_level", "level": 6},
                     "requirementKey": "YuviStudio.unlock.level.6"},
    "globe": {"kind": "prop", "rule": {"type": "xp_level", "level": 8},
              "requirementKey": "YuviStudio.unlock.level.8"},
    "level_furniture_09": {"kind": "prop", "rule": {"type": "xp_level", "level": 9},
                           "requirementKey": "YuviStudio.unlock.level.9"},
    "layout:sportsArena": {"kind": "prop", "rule": {"type": "xp_level", "level": 10},
                           "requirementKey": "YuviStudio.unlock.level.10"},
    "level_furniture_14": {"kind": "prop", "rule": {"type": "xp_level", "level": 14},
                           "requirementKey": "YuviStudio.unlock.level.14"},
    "telescope": {"kind": "prop", "rule": {"type": "xp_level", "level": 15},
                  "requirementKey": "YuviStudio.unlock.level.15"},
    "level_furniture_17": {"kind": "prop", "rule": {"type": "xp_level", "level": 17},
                           "requirementKey": "YuviStudio.unlock.level.17"},
    "level_furniture_18": {"kind": "prop", "rule": {"type": "xp_level", "level": 18},
                           "requirementKey": "YuviStudio.unlock.level.18"},
    "layout:creatorLoft": {"kind": "prop", "rule": {"type": "xp_level", "level": 20},
                          "requirementKey": "YuviStudio.unlock.level.20"},
    "starProjector": {"kind": "prop", "rule": {"type": "xp_level", "level": 20},
                      "requirementKey": "YuviStudio.unlock.level.20"},
    "trophies": {"kind": "prop", "rule": {"type": "xp_level", "level": 23},
                 "requirementKey": "YuviStudio.unlock.level.23"},
    "level_furniture_24": {"kind": "prop", "rule": {"type": "xp_level", "level": 24},
                           "requirementKey": "YuviStudio.unlock.level.24"},
    "level_furniture_26": {"kind": "prop", "rule": {"type": "xp_level", "level": 26},
                           "requirementKey": "YuviStudio.unlock.level.26"},
}

for _level, _item_id in {
    3: "studio_wall_decals_03",
    6: "room_ambient_lights_06",
    8: "studio_desk_accessory_08",
    10: "room_audio_theme_10",
    11: "profile_level_frame_11",
    13: "studio_posters_13",
    20: "room_theme_20",
    22: "profile_level_frame_22",
    23: "studio_display_shelf_23",
    27: "premium_room_ambience_27",
    29: "personal_journey_monument_29",
    30: "prestige_room_object_30",
    35: "prestige_room_object_35",
    40: "prestige_room_object_40",
    45: "prestige_room_object_45",
    50: "prestige_room_object_50",
}.items():
    UNLOCKS[_item_id] = {
        "kind": "avatar" if _item_id.startswith("profile_") else "prop",
        "rule": {"type": "xp_level", "level": _level},
        "requirementKey": f"YuviStudio.unlock.level.{_level}",
    }

for _level in range(30, 51):
    UNLOCKS[f"prestige_level_frame_{_level}"] = {
        "kind": "avatar",
        "rule": {"type": "xp_level", "level": _level},
        "requirementKey": f"YuviStudio.unlock.level.{_level}",
    }

AVATAR_IDS = frozenset(k for k, v in UNLOCKS.items() if v["kind"] == "avatar")
PROP_IDS = frozenset(k for k, v in UNLOCKS.items() if v["kind"] == "prop")

# Cosmetics the studio locks but no server rule grants. `propeller` has no
# earned source yet, so it remains visibly locked until its separate task.
UNGRANTED_IDS = frozenset({"propeller"})


def is_gated_cosmetic(asset_id: str) -> bool:
    """True when this Yuvi cosmetic may only be worn once it has been earned.

    Cosmetics can be bought with sparks or earned through XP, streaks, or
    mapping sections. Read from the shop rather than copied, so a price added
    there cannot quietly become free.
    """
    from app.services.rewards.catalog import CATALOG

    return asset_id in AVATAR_IDS or asset_id in CATALOG or asset_id in UNGRANTED_IDS

def satisfied_ids(
    current_streak: int = 0,
    completed_sections: Iterable[int] | None = None,
) -> set[str]:
    """Section and streak rewards the learner currently qualifies for.

    XP rewards settle through ``progression.rewards`` when a level is reached.
    """
    sections = set(completed_sections or [])
    out: set[str] = set()
    for item_id, entry in UNLOCKS.items():
        rule = entry["rule"]
        if rule["type"] == "streak" and current_streak >= int(rule["days"]):
            out.add(item_id)
        elif rule["type"] == "section" and rule["number"] in sections:
            out.add(item_id)
    return out


def is_gated_prop(kind: str) -> bool:
    """True when this room item may only be placed once it has been earned."""
    from app.services.rewards.catalog import CATALOG, SPORTS_ARENA_STARTER_PROP_IDS

    return kind in PROP_IDS or kind in SPORTS_ARENA_STARTER_PROP_IDS or (
        kind in CATALOG and CATALOG[kind].get("slot") == "room"
    )


def catalog_for_client(
    owned_avatar: Iterable[str] | None,
    owned_props: Iterable[str] | None,
) -> list[dict[str, Any]]:
    """The unlock table as the studio needs it: what exists, and what is held."""
    avatar_held = set(owned_avatar or [])
    props_held = set(owned_props or [])
    return [
        {
            "id": item_id,
            "kind": entry["kind"],
            "requirementKey": entry["requirementKey"],
            "owned": item_id in (avatar_held if entry["kind"] == "avatar" else props_held),
        }
        for item_id, entry in sorted(UNLOCKS.items())
    ]
