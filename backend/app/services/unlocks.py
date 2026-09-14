"""What a learner has earned the right to wear and to put in their room.

One table, server-side, because cosmetics are earned: `learner_state` keeps
`avatar_unlocks` and `room_unlocks` out of the client-writable allow-list, and
this module is the only thing that decides what belongs in them.

Two rule kinds, both read from signals that already exist:

- ``badge``   — the named badge is earned (``app.services.badges.project_badges``).
                Subject coins are addressed by subject (``science``), milestones
                and the capstone by their own key (``on_fire``, ``world``).
- ``streak``  — the learner's *current* day streak has reached N days.

Rules only ever add. Once an item is granted it is kept, even if the streak that
earned it later breaks — a reward that can be confiscated is a punishment, and
this product does not punish a learner for missing a day.
"""

from __future__ import annotations

from typing import Any, Iterable

# Requirement copy is keyed, never phrased here: the studio and the badge shelf
# localize it, and Hebrew is the source language.
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
    "laurel": {"kind": "avatar", "rule": {"type": "badge", "key": "on_fire"},
               "requirementKey": "YuviStudio.unlock.badge.on_fire"},
    "explorerGoggles": {"kind": "avatar", "rule": {"type": "badge", "key": "comeback"},
                        "requirementKey": "YuviStudio.unlock.badge.comeback"},
    "streakScarf": {"kind": "avatar", "rule": {"type": "streak", "days": 3},
                    "requirementKey": "YuviStudio.unlock.streak.3"},
    "cometTrail": {"kind": "avatar", "rule": {"type": "streak", "days": 7},
                   "requirementKey": "YuviStudio.unlock.streak.7"},
    "dragonwings": {"kind": "avatar", "rule": {"type": "xp_level", "level": 25},
                    "requirementKey": "YuviStudio.unlock.level.25"},

    # ── Room furniture ──
    "trophyShelf": {"kind": "prop", "rule": {"type": "badge", "key": "first_steps"},
                    "requirementKey": "YuviStudio.unlock.badge.first_steps"},
    "podium": {"kind": "prop", "rule": {"type": "badge", "key": "sharpshooter"},
               "requirementKey": "YuviStudio.unlock.badge.sharpshooter"},
    "observatory": {"kind": "prop", "rule": {"type": "badge", "key": "explorer"},
                    "requirementKey": "YuviStudio.unlock.badge.explorer"},
    "rocketModel": {"kind": "prop", "rule": {"type": "xp_level", "level": 10},
                    "requirementKey": "YuviStudio.unlock.level.10"},
    "parkCarousel": {"kind": "prop", "rule": {"type": "xp_level", "level": 9},
                     "requirementKey": "YuviStudio.unlock.level.9"},
    "parkTree": {"kind": "prop", "rule": {"type": "xp_level", "level": 13},
                 "requirementKey": "YuviStudio.unlock.level.13"},
    "parkBasketSwing": {"kind": "prop", "rule": {"type": "xp_level", "level": 15},
                        "requirementKey": "YuviStudio.unlock.level.15"},
    "mathBoard": {"kind": "prop", "rule": {"type": "badge", "key": "math"},
                  "requirementKey": "YuviStudio.unlock.badge.math"},
    "championBanner": {"kind": "prop", "rule": {"type": "badge", "key": "world"},
                       "requirementKey": "YuviStudio.unlock.badge.world"},
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

    Three sources, because a cosmetic can be bought with sparks, won with a
    badge or a streak, or promised for a mapping section. Read from the shop
    rather than copied, so a price added there cannot quietly become free.
    """
    from app.services.rewards.catalog import CATALOG

    return asset_id in AVATAR_IDS or asset_id in CATALOG or asset_id in UNGRANTED_IDS

# `project_badges` identifies a milestone by its coin colour, which is unique per
# milestone. This maps that back to the readable key the rules above use.
_MILESTONE_KEY = {
    "spark": "first_steps",
    "streak": "consistency",
    "devote": "dedicated",
    "flame": "on_fire",
    "aim": "sharpshooter",
    "revive": "comeback",
    "cosmos": "explorer",
}


def _earned_badge_keys(badges: Iterable[dict[str, Any]] | None) -> set[str]:
    """Badge identities a rule may name: a subject, or a milestone/capstone key."""
    keys: set[str] = set()
    for badge in badges or []:
        if not badge.get("earned"):
            continue
        subject = str(badge.get("subject") or "")
        if subject:
            keys.add(subject)
            keys.add(_MILESTONE_KEY.get(subject, subject))
    return keys


def satisfied_ids(
    badges: Iterable[dict[str, Any]] | None,
    current_streak: int = 0,
    completed_sections: Iterable[int] | None = None,
) -> set[str]:
    """Every cosmetic id the learner currently qualifies for."""
    earned = _earned_badge_keys(badges)
    sections = set(completed_sections or [])
    out: set[str] = set()
    for item_id, entry in UNLOCKS.items():
        rule = entry["rule"]
        if rule["type"] == "badge" and rule["key"] in earned:
            out.add(item_id)
        elif rule["type"] == "streak" and current_streak >= int(rule["days"]):
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


def ids_for_badge(subject: str) -> list[dict[str, str]]:
    """Cosmetics a badge grants, so the shelf can show what winning it is worth."""
    names = {subject, _MILESTONE_KEY.get(subject, subject)}
    return [
        {"id": item_id, "kind": entry["kind"]}
        for item_id, entry in sorted(UNLOCKS.items())
        if entry["rule"]["type"] == "badge" and entry["rule"]["key"] in names
    ]


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
