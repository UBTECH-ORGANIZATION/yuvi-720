"""Clear a user's completed tours so the tour can be exercised again.

Exists because the PATCH lane is deliberately union-only: there is no API that
un-completes a tour, and adding one purely for testing would be a production
backdoor into a preference the auto-start reads. So the reset lives here, out of
the request path entirely, and the browser check shells out to it.

    python scripts/reset_tour.py gal [teacher]
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.repository import _get_collection_named, get_preferences  # noqa: E402


async def main() -> int:
    if len(sys.argv) < 2:
        print("usage: reset_tour.py <user_id> [slug ...]")
        return 2
    user_id = sys.argv[1]
    slugs = sys.argv[2:]

    collection = _get_collection_named("users")
    if collection is None:
        print("no users collection (Mongo unavailable)")
        return 1

    if slugs:
        await collection.update_one(
            {"_id": user_id},
            {"$pull": {"preferences.tours_completed": {"$in": slugs}}})
    else:
        await collection.update_one(
            {"_id": user_id}, {"$set": {"preferences.tours_completed": []}})

    remaining = (await get_preferences(user_id)).get("tours_completed")
    print(f"{user_id}: tours_completed = {remaining}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
