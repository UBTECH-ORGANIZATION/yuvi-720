"""The class-book unwrap ledger lives on the USER, not in localStorage.

The gift-wrapped first sight of a week's book is a once-per-edition ceremony
that should follow the teacher across browsers — so it persists as a
preference ({group_id: that week's Sunday}) through the normal PATCH lane,
bounded and shape-checked because preferences round-trip on /api/auth/me.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pydantic

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import repository
from app.routes import auth as auth_routes


class TheLedgerIsAPreference(unittest.TestCase):
    def test_it_has_an_empty_default_and_is_writable(self):
        self.assertEqual(repository.DEFAULT_PREFERENCES.get("teacher_book_seen"), {})
        self.assertIn("teacher_book_seen", repository.ALLOWED_PREFERENCES)

    def test_a_week_must_look_like_a_date(self):
        with self.assertRaises(pydantic.ValidationError):
            auth_routes.PreferencesRequest(teacher_book_seen={"group-720": "not-a-date"})

    def test_the_map_is_bounded(self):
        too_many = {f"group-{index}": "2026-08-23" for index in range(51)}
        with self.assertRaises(pydantic.ValidationError):
            auth_routes.PreferencesRequest(teacher_book_seen=too_many)


class TheLedgerRoundTrips(unittest.IsolatedAsyncioTestCase):
    async def test_a_valid_map_is_written_as_sent(self):
        written: dict = {}

        async def _update(user_id, updates):
            written.update(updates)
            return {**repository.DEFAULT_PREFERENCES, **updates}

        payload = auth_routes.PreferencesRequest(
            teacher_book_seen={"group-720": "2026-08-23"})

        class _Response:
            headers: dict = {}

        with patch.object(auth_routes, "update_preferences", AsyncMock(side_effect=_update)):
            await auth_routes.patch_preferences(
                payload, _Response(), session={"sub": "teacher-1"})
        self.assertEqual(written, {"teacher_book_seen": {"group-720": "2026-08-23"}})


if __name__ == "__main__":
    unittest.main()
