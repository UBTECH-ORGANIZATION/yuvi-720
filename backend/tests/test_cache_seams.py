"""The write seams the plan names: a roster edit, a staffing change, a path
choice and a notifications read each move the right cache version.

Driven through the in-memory store; the org repository's Mongo write is
stubbed so only the bump is under test.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core import cache as cache_config  # noqa: E402
from app.services import cache_bumps, cache_store, org_repository  # noqa: E402


def _env(**values):
    return mock.patch.dict(os.environ, {"SPARK_ENVIRONMENT": "test", "SPARK_CACHE": "memory", **values})


class _Store(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        cache_config.reset_verification_cache()
        self._env = _env()
        self._env.start()
        os.environ.pop("REDIS_CONNECTION_STRING", None)
        await cache_store.reset()

    async def asyncTearDown(self):
        await cache_store.reset()
        self._env.stop()


class RosterEdits(_Store):
    async def test_enrolling_forgets_the_group_list_and_bumps_both_sides(self):
        groups = {"moti": ["g-old"]}

        async def groups_for_learner(learner_id):
            return groups[learner_id]

        with mock.patch("app.brain.org.groups_for_learner", groups_for_learner):
            self.assertEqual(await cache_bumps._groups_of("moti"), ["g-old"])
            groups["moti"] = ["g-old", "g-new"]
            # still the cached list — nothing told the cache the roster moved
            self.assertEqual(await cache_bumps._groups_of("moti"), ["g-old"])

            with mock.patch.object(org_repository, "_upsert", mock.AsyncMock(return_value={})):
                await org_repository.enroll_learner("moti", "g-new")

            self.assertEqual(await cache_bumps._groups_of("moti"), ["g-old", "g-new"])
        self.assertEqual(await cache_store.version("learner", "moti"), 1)
        self.assertGreaterEqual(await cache_store.version("grp", "g-new"), 1)
        self.assertGreaterEqual(await cache_store.version("grp", "g-old"), 1)

    async def test_unenrolling_bumps_the_class_that_was_left(self):
        async def groups_for_learner(_):
            return []

        with mock.patch("app.brain.org.groups_for_learner", groups_for_learner), \
                mock.patch.object(org_repository, "_upsert", mock.AsyncMock(return_value={})), \
                mock.patch.object(org_repository, "_find_one", mock.AsyncMock(return_value={"active": True})):
            await org_repository.unenroll_learner("moti", "g-old")
        self.assertEqual(await cache_store.version("grp", "g-old"), 1)
        self.assertEqual(await cache_store.version("learner", "moti"), 1)

    async def test_staffing_moves_the_teacher_scope_and_the_class(self):
        with mock.patch.object(org_repository, "_upsert", mock.AsyncMock(return_value={})):
            await org_repository.link_teacher("t1", "g1")
        self.assertEqual(await cache_store.version("teacher", "t1"), 1)
        self.assertEqual(await cache_store.version("grp", "g1"), 1)

    async def test_editing_or_archiving_a_group_bumps_it(self):
        with mock.patch.object(org_repository, "_upsert", mock.AsyncMock(return_value={})), \
                mock.patch.object(org_repository, "get_group", mock.AsyncMock(return_value={"_id": "g1"})), \
                mock.patch.object(org_repository, "get_school", mock.AsyncMock(return_value={}), create=True):
            await org_repository.upsert_group("g1", school_id="s1", name="ז2")
            await org_repository.archive_group("g1")
        self.assertEqual(await cache_store.version("grp", "g1"), 2)


class LearnerWrites(_Store):
    async def test_a_path_choice_moves_the_learner_version(self):
        from app.services import events

        class Collection:
            async def update_one(self, *_args, **_kwargs):
                return None

        async def no_groups(_):
            return []

        with mock.patch.object(events, "_events_collection", mock.AsyncMock(return_value=Collection())), \
                mock.patch("app.brain.org.groups_for_learner", no_groups):
            await events.record_path_choice("moti", "comp-1", None, "more_practice")
        self.assertEqual(await cache_store.version("learner", "moti"), 1)


class NotificationReads(_Store):
    async def test_the_deadline_reconcile_runs_once_per_window(self):
        from app.routes import notifications as route

        reconcile = mock.AsyncMock()
        with mock.patch("app.services.student_calendar.reconcile_due_reminders", reconcile):
            for _ in range(3):
                await route._reconcile_learner_deadlines("moti", route.notifications.ROLE_LEARNER)
        reconcile.assert_awaited_once_with("moti")

    async def test_without_a_store_every_read_reconciles(self):
        from app.routes import notifications as route

        reconcile = mock.AsyncMock()
        with _env(SPARK_CACHE="off"):
            await cache_store.reset()
            with mock.patch("app.services.student_calendar.reconcile_due_reminders", reconcile):
                await route._reconcile_learner_deadlines("moti", route.notifications.ROLE_LEARNER)
                await route._reconcile_learner_deadlines("moti", route.notifications.ROLE_LEARNER)
        self.assertEqual(reconcile.await_count, 2)


if __name__ == "__main__":
    unittest.main()
