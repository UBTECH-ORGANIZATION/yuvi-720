"""Private, group-scoped room-community persistence and projections."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.auth.repository import get_user_by_id
from app.brain import org
from app.brain.repository import _get_collection_named
from app.services import notifications
from learner_state import get_learner_state, normalize_learner_id


COLLECTION = "room_community"
FALLBACK_COMMUNITY_FILE = Path(__file__).resolve().parents[2] / ".runtime" / "room_community.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _collection() -> Optional[Any]:
    return _get_collection_named(COLLECTION)


def _read_fallback() -> dict[str, Any]:
    try:
        if FALLBACK_COMMUNITY_FILE.exists():
            return json.loads(FALLBACK_COMMUNITY_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"room community fallback read failed: {type(exc).__name__}")
    return {"sharing": {}, "likes": {}}


def _write_fallback(data: dict[str, Any]) -> None:
    try:
        FALLBACK_COMMUNITY_FILE.parent.mkdir(parents=True, exist_ok=True)
        FALLBACK_COMMUNITY_FILE.write_text(
            json.dumps({
                "sharing": data.get("sharing", {}),
                "likes": data.get("likes", {}),
            }, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        print(f"room community fallback write failed: {type(exc).__name__}")


async def is_shared(owner_id: str) -> bool:
    safe_owner = normalize_learner_id(owner_id)
    collection = _collection()
    if collection is not None:
        document = await collection.find_one({"_id": f"share:{safe_owner}"})
        return bool(document and document.get("shared"))
    return bool(_read_fallback().get("sharing", {}).get(safe_owner))


async def set_sharing(owner_id: str, shared: bool) -> dict[str, bool]:
    safe_owner = normalize_learner_id(owner_id)
    value = bool(shared)
    collection = _collection()
    if collection is not None:
        await collection.update_one(
            {"_id": f"share:{safe_owner}"},
            {"$set": {"shared": value, "updated_at": _now()}},
            upsert=True,
        )
    else:
        data = _read_fallback()
        data.setdefault("sharing", {})[safe_owner] = value
        _write_fallback(data)
    return {"shared": value}


async def sharing_settings(owner_id: str) -> dict[str, bool]:
    return {"shared": await is_shared(owner_id)}


async def _can_view(viewer_id: str, owner_id: str) -> bool:
    safe_viewer = normalize_learner_id(viewer_id)
    safe_owner = normalize_learner_id(owner_id)
    if safe_viewer == safe_owner:
        return False
    peers = await org.learners_sharing_a_group(safe_viewer)
    return safe_owner in peers and await is_shared(safe_owner)


async def _is_liked(viewer_id: str, owner_id: str) -> bool:
    key = f"like:{owner_id}:{viewer_id}"
    collection = _collection()
    if collection is not None:
        document = await collection.find_one({"_id": key})
        return bool(document and document.get("liked"))
    return bool(_read_fallback().get("likes", {}).get(owner_id, {}).get(viewer_id))


async def _room_card(viewer_id: str, owner_id: str) -> Optional[dict[str, Any]]:
    if not await _can_view(viewer_id, owner_id):
        return None
    return await _authorized_room_card(viewer_id, owner_id)


async def _authorized_room_card(viewer_id: str, owner_id: str) -> Optional[dict[str, Any]]:
    if not await is_shared(owner_id):
        return None
    state = await get_learner_state(owner_id)
    room = state.get("room")
    if not isinstance(room, dict):
        return None
    user = await get_user_by_id(owner_id)
    display_name = (user or {}).get("display_name")
    if not isinstance(display_name, str) or not display_name.strip():
        return None
    return {
        "owner_id": owner_id,
        "display_name": display_name,
        "room": room,
        "yuvi_design": state.get("yuvi_design"),
        "liked_by_me": await _is_liked(viewer_id, owner_id),
    }


async def list_rooms(viewer_id: str) -> list[dict[str, Any]]:
    peer_ids = await org.learners_sharing_a_group(viewer_id)
    cards = [
        card
        for card in await asyncio.gather(
            *(_authorized_room_card(viewer_id, owner_id) for owner_id in peer_ids)
        )
        if card is not None
    ]
    return sorted(cards, key=lambda card: (card["display_name"].casefold(), card["owner_id"]))


async def get_room(viewer_id: str, owner_id: str) -> Optional[dict[str, Any]]:
    return await _room_card(viewer_id, normalize_learner_id(owner_id))


async def set_like(viewer_id: str, owner_id: str) -> dict[str, bool]:
    safe_viewer = normalize_learner_id(viewer_id)
    safe_owner = normalize_learner_id(owner_id)
    if not await _can_view(safe_viewer, safe_owner):
        raise ValueError("room_not_found")
    was_liked = await _is_liked(safe_viewer, safe_owner)
    collection = _collection()
    if collection is not None:
        await collection.update_one(
            {"_id": f"like:{safe_owner}:{safe_viewer}"},
            {"$set": {"owner_id": safe_owner, "visitor_id": safe_viewer, "liked": True, "updated_at": _now()}},
            upsert=True,
        )
    else:
        data = _read_fallback()
        data.setdefault("likes", {}).setdefault(safe_owner, {})[safe_viewer] = True
        _write_fallback(data)
    if not was_liked:
        visitor = await get_user_by_id(safe_viewer)
        visitor_name = (visitor or {}).get("display_name")
        await notifications.notify(
            safe_owner,
            notifications.KIND_ROOM_LIKED,
            title_key="YuviStudio.community.likeNotification",
            notification_id=f"room_like:{safe_owner}:{safe_viewer}",
            params={"name": visitor_name if isinstance(visitor_name, str) else safe_viewer},
            actions=[{"label_key": "YuviStudio.community.open", "route": "/yuvi-studio"}],
            recipient_role=notifications.ROLE_LEARNER,
            actor_id=safe_viewer,
        )
    return {"liked_by_me": True}


async def remove_like(viewer_id: str, owner_id: str) -> dict[str, bool]:
    safe_viewer = normalize_learner_id(viewer_id)
    safe_owner = normalize_learner_id(owner_id)
    if not await _can_view(safe_viewer, safe_owner):
        raise ValueError("room_not_found")
    collection = _collection()
    if collection is not None:
        await collection.delete_one({"_id": f"like:{safe_owner}:{safe_viewer}"})
    else:
        data = _read_fallback()
        data.setdefault("likes", {}).setdefault(safe_owner, {}).pop(safe_viewer, None)
        _write_fallback(data)
    return {"liked_by_me": False}


async def like_count(owner_id: str) -> int:
    """Internal aggregate for system use; it is intentionally not an API response."""
    safe_owner = normalize_learner_id(owner_id)
    collection = _collection()
    if collection is not None:
        return await collection.count_documents({"owner_id": safe_owner, "liked": True})
    return len(_read_fallback().get("likes", {}).get(safe_owner, {}))