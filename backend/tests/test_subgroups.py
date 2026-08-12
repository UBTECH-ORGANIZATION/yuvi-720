"""Sub-groups: a label on learners the teacher can already see.

Three properties, and all three are the kind that fail silently:

1. **A sub-group cannot reach outside its class.** The learner list arrives from
   a browser, so every id is checked against the parent group individually. The
   failure mode is a teacher assigning a goal to somebody else's student and
   nothing anywhere saying so.
2. **Membership is resolved live, never trusted from storage.** A child who
   leaves the class must leave every sub-group at the next read. Stored ids are
   a snapshot of the day the selection was drawn.
3. **Refusals do not leak existence.** Another teacher's sub-group and a
   sub-group that was never created must be indistinguishable.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import subgroups


def run(coro):
    return asyncio.run(coro)


MINE = "group-mine"
THEIRS = "group-theirs"
ENROLLED = ["kid-a", "kid-b", "kid-c"]


def _org(enrolled=None, groups=(MINE,)):
    """This teacher teaches `MINE` and nothing else."""
    return _Stack([
        patch("app.brain.org.teacher_can_access_group",
              AsyncMock(side_effect=lambda teacher_id, group_id: group_id == MINE)),
        patch("app.brain.org.learners_in_group",
              AsyncMock(return_value=list(ENROLLED if enrolled is None else enrolled))),
        patch("app.brain.org.get_group",
              AsyncMock(side_effect=lambda group_id:
                        {"_id": group_id} if group_id in groups else None)),
    ])


class _Stack:
    """Every org read a sub-group call makes, as one context manager."""

    def __init__(self, patchers):
        self._patchers = patchers
        self._stack = None

    def __enter__(self):
        from contextlib import ExitStack

        self._stack = ExitStack()
        for patcher in self._patchers:
            self._stack.enter_context(patcher)
        return self

    def __exit__(self, *exc):
        return self._stack.__exit__(*exc)


class CreateTests(unittest.TestCase):
    def test_a_learner_outside_the_class_is_refused_not_stored(self):
        org_reads = _org()
        saved = {}

        async def capture(subgroup_id, **fields):
            saved.update({"_id": subgroup_id, **fields})
            return saved

        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])), \
             patch("app.services.org_repository.upsert_subgroup", capture):
            result = run(subgroups.create(
                "teacher-a", MINE, name="קבוצת חיזוק",
                learner_ids=["kid-a", "kid-not-here", "kid-b"],
            ))

        self.assertEqual(result["learner_ids"], ["kid-a", "kid-b"])
        self.assertEqual(result["skipped"], [{"learner_id": "kid-not-here", "reason": "not_in_group"}])
        # And it never reached storage — the refusal is not cosmetic.
        self.assertNotIn("kid-not-here", saved["learner_ids"])

    def test_another_teachers_group_is_refused(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.upsert_subgroup", AsyncMock()) as write:
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.create("teacher-a", THEIRS, name="x", learner_ids=["kid-a"]))
        self.assertEqual(str(caught.exception), "not_authorized")
        write.assert_not_awaited()

    def test_a_selection_with_nobody_left_in_the_class_is_not_saved(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])), \
             patch("app.services.org_repository.upsert_subgroup", AsyncMock()) as write:
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.create("teacher-a", MINE, name="x", learner_ids=["ghost"]))
        self.assertEqual(str(caught.exception), "no_members_in_group")
        write.assert_not_awaited()

    def test_a_blank_name_is_refused(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])):
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.create("teacher-a", MINE, name="   ", learner_ids=["kid-a"]))
        self.assertEqual(str(caught.exception), "name_required")

    def test_the_same_name_twice_is_refused(self):
        org_reads = _org()
        existing = [{"_id": "sg-1", "group_id": MINE, "name": "קבוצת חיזוק", "learner_ids": []}]
        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=existing)):
            with self.assertRaises(subgroups.SubgroupError) as caught:
                # Casing and stray spaces do not make it a different group.
                run(subgroups.create("teacher-a", MINE, name="  קבוצת   חיזוק ",
                                     learner_ids=["kid-a"]))
        self.assertEqual(str(caught.exception), "name_taken")

    def test_duplicate_ids_are_collapsed(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])), \
             patch("app.services.org_repository.upsert_subgroup",
                   AsyncMock(side_effect=lambda sid, **f: {"_id": sid, **f})):
            result = run(subgroups.create(
                "teacher-a", MINE, name="x", learner_ids=["kid-a", "kid-a", "kid-b"]))
        self.assertEqual(result["learner_ids"], ["kid-a", "kid-b"])


class MembershipDriftTests(unittest.TestCase):
    """The property that decays over time rather than failing on day one."""

    STORED = {"_id": "sg-1", "group_id": MINE, "name": "קבוצת חיזוק",
              "learner_ids": ["kid-a", "kid-b", "kid-c"], "active": True,
              "created_by": "teacher-a", "created_at": "2026-08-01T00:00:00Z"}

    def test_a_learner_who_left_the_class_leaves_the_subgroup(self):
        # kid-c transferred out; the stored list still names them.
        org_reads = _org(enrolled=["kid-a", "kid-b"])
        with org_reads, \
             patch("app.services.org_repository.list_subgroups",
                   AsyncMock(return_value=[self.STORED])):
            rows = run(subgroups.list_for_group("teacher-a", MINE))

        self.assertEqual(rows[0]["learner_ids"], ["kid-a", "kid-b"])
        self.assertEqual(rows[0]["size"], 2)
        # Reported, not silently swallowed: a group of three showing two without
        # explanation looks like a bug to the teacher who drew it.
        self.assertEqual(rows[0]["dropped"], ["kid-c"])

    def test_every_write_path_reads_the_live_membership(self):
        """`members_of` is what goals, kudos and tasks target."""
        org_reads = _org(enrolled=["kid-a"])
        with org_reads, \
             patch("app.services.org_repository.get_subgroup",
                   AsyncMock(return_value=self.STORED)):
            members = run(subgroups.members_of("teacher-a", "sg-1"))
        self.assertEqual(members, ["kid-a"])

    def test_the_switcher_order_is_stable(self):
        """Unsorted rows made the class picker default to a different class on
        different page loads; a sub-group switcher would do the same."""
        rows = [
            {"_id": "sg-2", "group_id": MINE, "name": "ב", "learner_ids": ["kid-a"]},
            {"_id": "sg-1", "group_id": MINE, "name": "א", "learner_ids": ["kid-b"]},
        ]
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=rows)):
            listed = run(subgroups.list_for_group("teacher-a", MINE))
        self.assertEqual([row["name"] for row in listed], ["א", "ב"])


class ScopeTests(unittest.TestCase):
    def test_another_teachers_subgroup_is_refused(self):
        org_reads = _org()
        theirs = {"_id": "sg-x", "group_id": THEIRS, "name": "x",
                  "learner_ids": ["kid-a"], "active": True}
        with org_reads, \
             patch("app.services.org_repository.get_subgroup", AsyncMock(return_value=theirs)):
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.members_of("teacher-a", "sg-x"))
        self.assertEqual(str(caught.exception), "not_authorized")

    def test_a_missing_subgroup_and_someone_elses_are_both_refused(self):
        """Different codes internally; the route maps both to the same 403 so
        the outside cannot tell a sub-group exists."""
        from app.routes import teacher_subgroups as routes

        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.get_subgroup", AsyncMock(return_value=None)):
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.members_of("teacher-a", "sg-nope"))
        self.assertEqual(str(caught.exception), "not_found")

        missing = routes._failed(subgroups.SubgroupError("not_found"))
        forbidden = routes._failed(subgroups.SubgroupError("not_authorized"))
        self.assertEqual(missing.status_code, forbidden.status_code)
        self.assertEqual(missing.body, forbidden.body)

    def test_an_archived_subgroup_is_gone_for_every_caller(self):
        org_reads = _org()
        archived = {"_id": "sg-1", "group_id": MINE, "name": "x",
                    "learner_ids": ["kid-a"], "active": False}
        with org_reads, \
             patch("app.services.org_repository.get_subgroup", AsyncMock(return_value=archived)):
            for call in (subgroups.members_of, subgroups.archive):
                with self.assertRaises(subgroups.SubgroupError) as caught:
                    run(call("teacher-a", "sg-1"))
                self.assertEqual(str(caught.exception), "not_found")


class UpdateTests(unittest.TestCase):
    STORED = {"_id": "sg-1", "group_id": MINE, "name": "old",
              "learner_ids": ["kid-a"], "active": True, "created_by": "teacher-a",
              "created_at": "2026-08-01T00:00:00Z"}

    def test_redrawing_the_membership_revalidates(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.get_subgroup",
                   AsyncMock(return_value=self.STORED)), \
             patch("app.services.org_repository.upsert_subgroup",
                   AsyncMock(side_effect=lambda sid, **f: {"_id": sid, **f})):
            result = run(subgroups.update(
                "teacher-a", "sg-1", learner_ids=["kid-b", "kid-elsewhere"]))
        self.assertEqual(result["learner_ids"], ["kid-b"])
        self.assertEqual(result["skipped"],
                         [{"learner_id": "kid-elsewhere", "reason": "not_in_group"}])

    def test_a_rename_keeps_the_membership_and_the_author(self):
        org_reads = _org()
        with org_reads, \
             patch("app.services.org_repository.get_subgroup",
                   AsyncMock(return_value=self.STORED)), \
             patch("app.services.org_repository.upsert_subgroup",
                   AsyncMock(side_effect=lambda sid, **f: {"_id": sid, **f})) as write:
            result = run(subgroups.update("teacher-b", "sg-1", name="new"))

        self.assertEqual(result["name"], "new")
        self.assertEqual(result["learner_ids"], ["kid-a"])
        # A second teacher editing does not become the author, and the original
        # creation time survives.
        self.assertEqual(write.await_args.kwargs["created_by"], "teacher-a")
        self.assertEqual(write.await_args.kwargs["created_at"], "2026-08-01T00:00:00Z")


class AdminTests(unittest.TestCase):
    """An admin passes the access check for *any* group id, including one that
    was never a group — `teacher_can_access_group` short-circuits on the grant.
    So existence is checked separately, or an admin could name a sub-group of
    nothing: invisible from every screen and unreachable by every read."""

    def test_an_admin_cannot_make_a_subgroup_of_a_group_that_does_not_exist(self):
        everywhere = _Stack([
            patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)),
            patch("app.brain.org.learners_in_group", AsyncMock(return_value=ENROLLED)),
            patch("app.brain.org.get_group", AsyncMock(return_value=None)),
        ])
        with everywhere, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])), \
             patch("app.services.org_repository.upsert_subgroup", AsyncMock()) as write:
            with self.assertRaises(subgroups.SubgroupError) as caught:
                run(subgroups.create("admin-a", "never-existed", name="x",
                                     learner_ids=["kid-a"]))
        self.assertEqual(str(caught.exception), "not_authorized")
        write.assert_not_awaited()

    def test_an_admin_can_still_use_a_real_group(self):
        everywhere = _Stack([
            patch("app.brain.org.teacher_can_access_group", AsyncMock(return_value=True)),
            patch("app.brain.org.learners_in_group", AsyncMock(return_value=ENROLLED)),
            patch("app.brain.org.get_group", AsyncMock(return_value={"_id": THEIRS})),
        ])
        with everywhere, \
             patch("app.services.org_repository.list_subgroups", AsyncMock(return_value=[])), \
             patch("app.services.org_repository.upsert_subgroup",
                   AsyncMock(side_effect=lambda sid, **f: {"_id": sid, **f})):
            result = run(subgroups.create("admin-a", THEIRS, name="x",
                                          learner_ids=["kid-a"]))
        self.assertEqual(result["learner_ids"], ["kid-a"])


if __name__ == "__main__":
    unittest.main()
