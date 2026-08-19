"""Clearing a teacher's scope, which the preferences lane could not do.

`patch_preferences` dumped the body with `exclude_none=True`, so a null could
never reach the document. That is right for every preference that existed
before: a theme, a language and a roster view are value-or-default, and a client
sending `{"theme": null}` means "no opinion", not "erase it".

Scope broke the assumption, because for scope **null is a value** — "the whole
class", "every subject" — and it is the value a teacher reaches for most: the ✕
on a chip, switching class, or the client resolving a sub-group that has since
been deleted. Every one of those writes a null, every one of them was silently
refused with a 400, and because the write is fire-and-forget the screen cleared
and the document did not. The filter came back on the next load, for good.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import repository
from app.routes import auth as auth_routes


class TheScopeIsStorable(unittest.TestCase):
    def test_all_three_parts_have_a_default(self):
        for key in ("teacher_group_id", "teacher_subgroup_id", "teacher_subject"):
            self.assertIn(key, repository.DEFAULT_PREFERENCES, key)
            # Null is "not narrowed", which is what a teacher starts with.
            self.assertIsNone(repository.DEFAULT_PREFERENCES[key], key)

    def test_and_is_writable_through_the_normal_lane(self):
        for key in ("teacher_subgroup_id", "teacher_subject"):
            self.assertIn(key, repository.ALLOWED_PREFERENCES, key)


class ClearingIsAWrite(unittest.IsolatedAsyncioTestCase):
    async def _patch(self, body: dict):
        """Run the route against a stubbed store; return what it tried to write."""
        written: dict = {}

        async def _update(user_id, updates):
            written.update(updates)
            return {**repository.DEFAULT_PREFERENCES, **updates}

        payload = auth_routes.PreferencesRequest(**body)

        class _Response:
            headers: dict = {}

        with patch.object(auth_routes, "update_preferences", AsyncMock(side_effect=_update)):
            await auth_routes.patch_preferences(
                payload, _Response(), session={"sub": "teacher-1"})
        return written

    async def test_a_null_sub_group_is_stored_rather_than_dropped(self):
        written = await self._patch({"teacher_subgroup_id": None})
        self.assertIn("teacher_subgroup_id", written)
        self.assertIsNone(written["teacher_subgroup_id"])

    async def test_a_null_subject_is_stored_too(self):
        written = await self._patch({"teacher_subject": None})
        self.assertEqual(written, {"teacher_subject": None})

    async def test_switching_class_can_widen_in_one_write(self):
        # What `selectGroup` sends. If the null were dropped here, the old
        # class's sub-group would stay in the document and be seeded back on the
        # next load — against a class it does not belong to.
        written = await self._patch({
            "teacher_group_id": "g-2", "teacher_subgroup_id": None,
        })
        self.assertEqual(written, {"teacher_group_id": "g-2", "teacher_subgroup_id": None})

    async def test_a_field_nobody_sent_is_still_left_alone(self):
        # The property that makes the exception safe: absent stays absent, so a
        # PATCH of one preference cannot blank the rest.
        written = await self._patch({"teacher_subject": "math"})
        self.assertEqual(written, {"teacher_subject": "math"})

    async def test_everything_else_still_reads_null_as_no_opinion(self):
        """The rule this exception is carved out of.

        A client that sends `{"theme": null}` has no opinion about the theme —
        storing that would erase a choice the teacher made on another device.
        With nothing left to write, the route refuses the whole request.
        """
        from fastapi import HTTPException

        with self.assertRaises(HTTPException) as caught:
            await self._patch({"theme": None, "language": None})
        self.assertEqual(caught.exception.status_code, 400)

    async def test_the_carve_out_names_only_scope(self):
        self.assertEqual(auth_routes.CLEARABLE_PREFERENCES,
                         {"teacher_subgroup_id", "teacher_subject"})


if __name__ == "__main__":
    unittest.main()
