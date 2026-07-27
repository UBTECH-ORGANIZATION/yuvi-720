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
}


def price_of(asset_id: str) -> int | None:
    """Price in sparks, or ``None`` when the item is not for sale."""
    entry = CATALOG.get(asset_id)
    return int(entry["price"]) if entry else None


def catalog_for_client(owned: list[str] | None = None) -> list[dict[str, Any]]:
    """Shop rows for the studio UI. Labels are localized client-side by id."""
    owned_set = set(owned or [])
    return [
        {
            "id": asset_id,
            "price": entry["price"],
            "slot": entry["slot"],
            "tier": entry["tier"],
            "owned": asset_id in owned_set,
        }
        for asset_id, entry in sorted(CATALOG.items(), key=lambda kv: (kv[1]["tier"], kv[0]))
    ]
