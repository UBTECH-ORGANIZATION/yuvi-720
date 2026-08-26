"""The dashboard's period has to survive a reload.

The near-miss this pins: the period was added to `DEFAULT_PREFERENCES` (and so
to `ALLOWED_PREFERENCES`) but NOT declared on `PreferencesRequest`. Pydantic
drops undeclared fields, so the value never reached the allow-list check that
would have accepted it — the PATCH answered 200, the screen switched, and the
next load snapped back to the default. Allow-listing a preference and being
able to send one are two different things, and only the pair works.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import repository
from app.routes import auth as auth_routes

# The vocabulary the dashboard offers. Mirrored from the client's `periodModel`
# — the server is what decides which of these it will store.
PERIODS = ("day", "3day", "week", "month")


class ThePeriodIsStorable(unittest.TestCase):
    def test_it_has_a_default_and_the_default_is_the_old_behaviour(self):
        self.assertIn("teacher_period", repository.DEFAULT_PREFERENCES)
        # Every number on that screen was a 7-day window before the control
        # existed, so a teacher who never touches it must see no change.
        self.assertEqual(repository.DEFAULT_PREFERENCES["teacher_period"], "week")

    def test_it_is_writable_through_the_normal_lane(self):
        self.assertIn("teacher_period", repository.ALLOWED_PREFERENCES)

    def test_the_request_model_declares_it(self):
        """The half that was missing. Without the field, the allow-list entry
        above is unreachable and the preference is write-only in theory."""
        self.assertIn("teacher_period", auth_routes.PreferencesRequest.model_fields)


class OnlyTheFourAreAccepted(unittest.TestCase):
    def test_every_offered_period_validates(self):
        for period in PERIODS:
            model = auth_routes.PreferencesRequest(teacher_period=period)
            self.assertEqual(model.teacher_period, period)

    def test_anything_else_is_refused_rather_than_stored(self):
        """This value becomes a day count in the analytics layer, so an
        arbitrary string must not reach it."""
        for bad in ("year", "1", "", "week ", "MONTH", "3day; drop"):
            with self.assertRaises(Exception, msg=bad):
                auth_routes.PreferencesRequest(teacher_period=bad)


class ItReachesTheDocument(unittest.IsolatedAsyncioTestCase):
    async def _patch(self, body: dict) -> dict:
        written: dict = {}

        async def _update(user_id, updates):
            written.update(updates)
            return {**repository.DEFAULT_PREFERENCES, **updates}

        class _Response:
            headers: dict = {}

        with patch.object(auth_routes, "update_preferences", AsyncMock(side_effect=_update)):
            await auth_routes.patch_preferences(
                auth_routes.PreferencesRequest(**body), _Response(),
                session={"sub": "teacher-1"})
        return written

    async def test_a_chosen_period_is_written(self):
        written = await self._patch({"teacher_period": "month"})
        self.assertEqual(written.get("teacher_period"), "month")

    async def test_it_does_not_disturb_the_rest_of_the_scope(self):
        """The period is not part of the scope bar and must not behave like it:
        sending one alone leaves class, sub-group and subject untouched."""
        written = await self._patch({"teacher_period": "day"})
        for key in ("teacher_group_id", "teacher_subgroup_id", "teacher_subject"):
            self.assertNotIn(key, written)


if __name__ == "__main__":
    unittest.main()
