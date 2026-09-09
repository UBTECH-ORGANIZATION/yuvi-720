"""Server-side spark shop catalog.

Prices live **only** here. The client never sends a price — it sends an asset
id, and the server resolves the cost. Ids mirror the locked entries of
`frontend/src/features/Yuvi-studio/YuviAssets.ts` whose `requirementKey` is
`YuviStudio.unlock.achievement` (the six items that were previously
unreachable). Milestone unlocks (crown / jetpack / ironman / propeller) are
granted by progress, not bought, so they are deliberately absent.
"""

from __future__ import annotations

from typing import Any

# asset id -> {price, slot, tier}
CATALOG: dict[str, dict[str, Any]] = {
    "astro": {"price": 40, "slot": "headTop", "tier": 1},
    "heromask": {"price": 40, "slot": "face", "tier": 1},
    "ironhelmet": {"price": 70, "slot": "headTop", "tier": 2},
    "lightsaber": {"price": 70, "slot": "handR", "tier": 2},
    "heroarmor": {"price": 120, "slot": "body", "tier": 3},
    "dragonwings": {"price": 120, "slot": "back", "tier": 3},
    "layout:sportsArena": {"price": 900, "slot": "room", "tier": 3, "unlock": "room", "completed_components": 6},
    "layout:creatorLoft": {"price": 1500, "slot": "room", "tier": 4, "unlock": "room", "completed_components": 10},
    "sportsJerseyDisplayAlt": {"price": 40, "slot": "room", "tier": 1, "unlock": "room"},
    "sportsPortableScoreboard": {"price": 70, "slot": "room", "tier": 2, "unlock": "room"},
    "sportsSeatingBench": {"price": 70, "slot": "room", "tier": 2, "unlock": "room"},
    "sportsAdjustableBench": {"price": 120, "slot": "room", "tier": 3, "unlock": "room"},
    "sportsRacketCorner": {"price": 120, "slot": "room", "tier": 3, "unlock": "room"},
    "sportsLegPress": {"price": 200, "slot": "room", "tier": 4, "unlock": "room"},
    "sportsCableMachine": {"price": 240, "slot": "room", "tier": 4, "unlock": "room"},
}

# These pieces ship with the Sports Arena. They are not separately persisted:
# holding the layout entitlement is the authoritative proof that they are owned.
SPORTS_ARENA_STARTER_PROP_IDS = frozenset({
    "sportsDumbbellRack",
    "sportsSquatRack",
    "sportsBasketballHoop",
    "sportsParkBench",
    "sportsMiniGoal",
    "sportsWallScoreboard",
    "sportsJerseyDisplay",
    "sportsArtworkBasketball",
    "sportsArtworkSoccer",
    "sportsArtworkRunners",
    "sportsArtworkOlympic",
    "sportsArtworkPadel",
    "sportsArtworkBadminton",
    "sportsArtworkTennis",
    "sportsArtworkStrength",
    "sportsArtworkTeamwork",
    "sportsArtworkCycling",
})


def price_of(asset_id: str) -> int | None:
    """Price in sparks, or ``None`` when the item is not for sale."""
    entry = CATALOG.get(asset_id)
    return int(entry["price"]) if entry else None


def entry_for(asset_id: str) -> dict[str, Any] | None:
    return CATALOG.get(asset_id)


def catalog_for_client(owned: list[str] | None = None, completed_components: int | None = None) -> list[dict[str, Any]]:
    """Shop rows for the studio UI. Labels are localized client-side by id."""
    owned_set = set(owned or [])
    return [
        {
            "id": asset_id,
            "price": entry["price"],
            "slot": entry["slot"],
            "tier": entry["tier"],
            "owned": asset_id in owned_set,
            **({"completedComponents": entry["completed_components"]} if "completed_components" in entry else {}),
            **({"completedComponentsCurrent": completed_components} if "completed_components" in entry and completed_components is not None else {}),
        }
        for asset_id, entry in sorted(CATALOG.items(), key=lambda kv: (kv[1]["tier"], kv[0]))
    ]
