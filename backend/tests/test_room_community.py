"""Room-community privacy and live group-scope tests."""

from __future__ import annotations

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth.dependencies import require_learner
from app.routes.room_community import router
from app.services import admin_org, org_repository, room_community
import learner_state


def run(coro):
    return asyncio.run(coro)


class RoomCommunityTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self._org_file = org_repository.FALLBACK_ORG_FILE
        org_repository.FALLBACK_ORG_FILE = root / "org.json"
        self._org_getter = org_repository._get_collection_named
        org_repository._get_collection_named = lambda name: None  # type: ignore[assignment]

        from app.auth import repository as users
        self._users = users
        self._users_file = users.FALLBACK_USERS_FILE
        users.FALLBACK_USERS_FILE = root / "users.json"
        self._users_collection = users._collection
        users._collection = lambda: None  # type: ignore[assignment]

        self._state_file = learner_state.FALLBACK_STATE_FILE
        learner_state.FALLBACK_STATE_FILE = root / "state.json"
        self._state_collection = learner_state._get_collection
        learner_state._get_collection = lambda: None  # type: ignore[assignment]

        self._community_file = room_community.FALLBACK_COMMUNITY_FILE
        room_community.FALLBACK_COMMUNITY_FILE = root / "community.json"
        self._community_collection = room_community._collection
        room_community._collection = lambda: None  # type: ignore[assignment]
        run(self._seed())

    def tearDown(self) -> None:
        org_repository.FALLBACK_ORG_FILE = self._org_file
        org_repository._get_collection_named = self._org_getter  # type: ignore[assignment]
        self._users.FALLBACK_USERS_FILE = self._users_file
        self._users._collection = self._users_collection  # type: ignore[assignment]
        learner_state.FALLBACK_STATE_FILE = self._state_file
        learner_state._get_collection = self._state_collection  # type: ignore[assignment]
        room_community.FALLBACK_COMMUNITY_FILE = self._community_file
        room_community._collection = self._community_collection  # type: ignore[assignment]
        self._tmp.cleanup()

    async def _seed(self) -> None:
        from app.auth.passwords import hash_password
        for user_id in ("viewer", "owner", "outsider", "root"):
            await self._users.upsert_user({
                "_id": user_id, "username": user_id, "display_name": user_id.title(),
                "roles": ["learner"] if user_id != "root" else ["admin"],
                "password": hash_password("Aa12345"),
            })
        await org_repository.grant_admin("root", scope="system")
        await admin_org.save_school("root", {"id": "s1", "name": "School"})
        await admin_org.save_group("root", {"id": "g1", "school_id": "s1", "name": "Class"})
        for learner_id in ("viewer", "owner"):
            await admin_org.enroll_learner("root", learner_id, "g1")
        room = {"activeLayoutId": "dome", "floor": "wood", "wall": "warm", "mood": "sunset", "items": []}
        await learner_state.update_learner_state("owner", {"room": room, "yuvi_design": {"variant": "one"}})

    def _client(self, learner_id: str) -> TestClient:
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[require_learner] = lambda: learner_id
        return TestClient(app)

    def test_gallery_is_private_by_default_and_projects_only_safe_fields(self):
        self.assertEqual(run(room_community.list_rooms("viewer")), [])
        run(room_community.set_sharing("owner", True))
        cards = run(room_community.list_rooms("viewer"))
        self.assertEqual(len(cards), 1)
        self.assertEqual(set(cards[0]), {"owner_id", "display_name", "room", "yuvi_design", "liked_by_me"})
        self.assertNotIn("learner_id", cards[0])
        self.assertFalse(cards[0]["liked_by_me"])
        self.assertEqual(cards[0]["room"]["activeLayoutId"], "dome")

    def test_gallery_resolves_live_peer_scope_once(self):
        run(room_community.set_sharing("owner", True))
        original = room_community.org.learners_sharing_a_group
        calls = 0

        async def peers_once(learner_id: str) -> list[str]:
            nonlocal calls
            calls += 1
            return ["owner"]

        room_community.org.learners_sharing_a_group = peers_once  # type: ignore[assignment]
        try:
            cards = run(room_community.list_rooms("viewer"))
        finally:
            room_community.org.learners_sharing_a_group = original  # type: ignore[assignment]

        self.assertEqual(calls, 1)
        self.assertEqual([card["owner_id"] for card in cards], ["owner"])

    def test_likes_are_private_and_require_live_peer_scope(self):
        run(room_community.set_sharing("owner", True))
        original_notify = room_community.notifications.notify
        room_community.notifications.notify = AsyncMock()
        try:
            self.assertEqual(run(room_community.set_like("viewer", "owner")), {"liked_by_me": True})
            self.assertEqual(run(room_community.set_like("viewer", "owner")), {"liked_by_me": True})
            room_community.notifications.notify.assert_awaited_once_with(
                "owner", room_community.notifications.KIND_ROOM_LIKED,
                title_key="YuviStudio.community.likeNotification",
                notification_id="room_like:owner:viewer",
                params={"name": "Viewer"},
                actions=[{"label_key": "YuviStudio.community.open", "route": "/yuvi-studio"}],
                recipient_role=room_community.notifications.ROLE_LEARNER,
                actor_id="viewer",
            )
        finally:
            room_community.notifications.notify = original_notify
        self.assertEqual(run(room_community.like_count("owner")), 1)
        self.assertEqual(run(room_community.remove_like("viewer", "owner")), {"liked_by_me": False})
        self.assertEqual(run(room_community.like_count("owner")), 0)
        self.assertIsNone(run(room_community.get_room("outsider", "owner")))
        with self.assertRaises(ValueError):
            run(room_community.set_like("outsider", "owner"))

    def test_room_endpoints_do_not_reveal_inaccessible_room_ids(self):
        run(room_community.set_sharing("owner", True))

        gallery = self._client("viewer").get("/api/community/rooms")
        self.assertEqual(gallery.status_code, 200)
        self.assertEqual(gallery.headers["cache-control"], "private, no-store")
        self.assertEqual(set(gallery.json()[0]), {"owner_id", "display_name", "room", "yuvi_design", "liked_by_me"})

        liked = self._client("viewer").put("/api/community/rooms/owner/like")
        self.assertEqual(liked.status_code, 200)
        self.assertEqual(liked.json(), {"liked_by_me": True})
        self.assertTrue(self._client("viewer").get("/api/community/rooms/owner").json()["liked_by_me"])

        denied = self._client("outsider").get("/api/community/rooms/owner")
        self.assertEqual(denied.status_code, 404)
        self.assertEqual(denied.json(), {"error": "not_found"})
        self.assertEqual(denied.headers["cache-control"], "private, no-store")
        self.assertEqual(self._client("outsider").put("/api/community/rooms/owner/like").status_code, 404)