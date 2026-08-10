"""Phase 8 — the `tours_completed` preference.

Small surface, three ways to get it wrong, all of them user-visible:

* An **unknown slug** stored is an unbounded list in a document read on every
  request. It is rejected, and rejected loudly — a client that believes it
  recorded a tour and did not would re-open that tour forever.
* A **replace instead of a union** lets a stale tab un-complete a tour that
  another tab just finished, and the tour comes back.
* A **missing default** means `preferences.tours_completed` is `None` for every
  account created before this phase, and the client's `.has()` throws.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import repository


class TourDefaults(unittest.IsolatedAsyncioTestCase):
    def test_default_is_an_empty_list(self):
        self.assertEqual(repository.DEFAULT_PREFERENCES["tours_completed"], [])

    def test_the_preference_is_writable_through_the_normal_lane(self):
        # ALLOWED_PREFERENCES is derived from DEFAULT_PREFERENCES, so this is
        # really asserting the derivation still holds.
        self.assertIn("tours_completed", repository.ALLOWED_PREFERENCES)

    def test_the_teacher_tour_is_a_known_slug(self):
        self.assertIn("teacher", repository.TOUR_SLUGS)

    async def test_an_account_predating_the_phase_still_reads_a_list(self):
        """An old user document has no `tours_completed`; the default fills in."""
        with patch.object(repository, "get_user_by_id",
                          AsyncMock(return_value={"preferences": {"language": "he"}})):
            preferences = await repository.get_preferences("someone")
        self.assertEqual(preferences["tours_completed"], [])
        self.assertEqual(preferences["language"], "he")


class TourWrites(unittest.IsolatedAsyncioTestCase):
    async def test_unknown_slugs_are_dropped_before_the_write(self):
        write = AsyncMock(return_value={"preferences": {"tours_completed": []}})
        with patch.object(repository, "_collection", return_value=None), \
             patch.object(repository, "_set_fields", write), \
             patch.object(repository, "get_user_by_id",
                          AsyncMock(return_value={"preferences": {"tours_completed": []}})):
            await repository.mark_tours_completed("u1", ["not-a-tour"])
        write.assert_not_awaited()

    async def test_the_write_is_a_union_not_a_replace(self):
        """The whole point: finishing 'teacher' must not drop an earlier tour."""
        captured: dict = {}

        async def fake_set_fields(user_id, fields):
            captured.update(fields)
            return {"preferences": {"tours_completed": fields["preferences.tours_completed"]}}

        with patch.object(repository, "_collection", return_value=None), \
             patch.object(repository, "_set_fields", fake_set_fields), \
             patch.object(repository, "get_user_by_id", AsyncMock(
                 return_value={"preferences": {"tours_completed": ["learner"]}})):
            result = await repository.mark_tours_completed("u1", ["teacher"])

        self.assertEqual(captured["preferences.tours_completed"], ["learner", "teacher"])
        self.assertEqual(result["tours_completed"], ["learner", "teacher"])

    async def test_recording_the_same_tour_twice_does_not_duplicate_it(self):
        with patch.object(repository, "_collection", return_value=None), \
             patch.object(repository, "_set_fields", AsyncMock(
                 return_value={"preferences": {"tours_completed": ["teacher"]}})), \
             patch.object(repository, "get_user_by_id", AsyncMock(
                 return_value={"preferences": {"tours_completed": ["teacher"]}})):
            result = await repository.mark_tours_completed("u1", ["teacher"])
        self.assertEqual(result["tours_completed"], ["teacher"])

    async def test_mongo_path_uses_addToSet_rather_than_set(self):
        """`$set` here is the race that loses a concurrently-finished tour."""
        collection = AsyncMock()
        collection.update_one = AsyncMock()
        with patch.object(repository, "_collection", return_value=collection), \
             patch.object(repository, "get_user_by_id", AsyncMock(
                 return_value={"preferences": {"tours_completed": ["teacher"]}})):
            await repository.mark_tours_completed("u1", ["teacher"])

        _filter, update = collection.update_one.await_args.args
        self.assertIn("$addToSet", update)
        self.assertEqual(
            update["$addToSet"]["preferences.tours_completed"], {"$each": ["teacher"]})
        # A `$set` of the list itself would defeat the whole thing.
        self.assertNotIn("preferences.tours_completed", update.get("$set", {}))


class TourRouteValidation(unittest.IsolatedAsyncioTestCase):
    """The PATCH lane: an unknown slug is a 400, not a silent drop."""

    async def _patch(self, payload: dict):
        from fastapi import HTTPException

        from app.routes import auth as auth_routes

        request = auth_routes.PreferencesRequest(**payload)
        response = unittest.mock.MagicMock()
        response.headers = {}
        try:
            return await auth_routes.patch_preferences(
                request, response, session={"sub": "u1"}), None
        except HTTPException as exc:
            return None, exc

    async def test_an_unknown_slug_is_rejected_with_400(self):
        result, error = await self._patch({"tours_completed": ["evil"]})
        self.assertIsNone(result)
        self.assertIsNotNone(error)
        self.assertEqual(error.status_code, 400)
        self.assertIn("unknown_tour", error.detail)

    async def test_a_known_slug_reaches_the_union_write(self):
        marker = AsyncMock(return_value={"tours_completed": ["teacher"]})
        with patch("app.routes.auth.mark_tours_completed", marker):
            result, error = await self._patch({"tours_completed": ["teacher"]})
        self.assertIsNone(error)
        marker.assert_awaited_once_with("u1", ["teacher"])
        self.assertEqual(result["preferences"]["tours_completed"], ["teacher"])

    async def test_a_tour_only_patch_does_not_go_through_the_generic_set_lane(self):
        """`update_preferences` would `$set` the list and clobber the union."""
        generic = AsyncMock()
        with patch("app.routes.auth.mark_tours_completed", AsyncMock(
                       return_value={"tours_completed": ["teacher"]})), \
             patch("app.routes.auth.update_preferences", generic):
            await self._patch({"tours_completed": ["teacher"]})
        generic.assert_not_awaited()

    async def test_an_empty_patch_is_still_a_400(self):
        result, error = await self._patch({})
        self.assertIsNone(result)
        self.assertEqual(error.status_code, 400)
        self.assertEqual(error.detail, "no_supported_preferences")

    async def test_a_theme_patch_is_unaffected_by_the_new_branch(self):
        with patch("app.routes.auth.update_preferences", AsyncMock(
                return_value={"theme": "dark"})) as generic:
            result, error = await self._patch({"theme": "dark"})
        self.assertIsNone(error)
        generic.assert_awaited_once()
        self.assertEqual(result["preferences"]["theme"], "dark")


if __name__ == "__main__":
    unittest.main()
