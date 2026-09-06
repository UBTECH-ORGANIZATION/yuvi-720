"""Who may remove a mentoring record, and what removing it does to the brain.

Teacher-documented conversations used to be undeletable by anyone. That was
the right rule while `assign_goal` was the only way a teacher could produce
one — it wrote a goal, not a paragraph about a child — and the wrong rule the
moment a composer started filing write-ups under a teacher's name. The rule is
now symmetrical: each side may remove only what it wrote.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mentoring


def _record(**overrides) -> dict:
    base = {
        "id": "ment_1",
        "learner_id": "kid-a",
        "author": "teacher",
        "teacher_id": "teacher-1",
        "notes": "דיברנו על זוויות",
        "goals": [],
        "deleted": False,
    }
    base.update(overrides)
    return base


class DeletePermissionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.saved: list[dict] = []
        self.record = _record()
        self._patches = [
            patch.object(mentoring, "_load_conversation",
                         AsyncMock(side_effect=lambda lid, cid: self.record)),
            patch.object(mentoring, "_save_conversation",
                         AsyncMock(side_effect=lambda lid, rec: self.saved.append(rec))),
            patch.object(mentoring, "_project_goals", AsyncMock(return_value=None)),
        ]
        for handle in self._patches:
            handle.start()

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def _delete(self, **kwargs) -> str:
        return await mentoring.delete_conversation("kid-a", "ment_1", **kwargs)

    async def test_the_teacher_who_wrote_it_can_remove_it(self):
        self.assertEqual(await self._delete(actor="teacher", teacher_id="teacher-1"),
                         "deleted")
        self.assertTrue(self.saved[0]["deleted"])
        self.assertTrue(self.saved[0]["deleted_at"])

    async def test_a_colleague_cannot_remove_someone_elses_write_up(self):
        """Scope says they may READ this child. It does not say they may
        delete another teacher's record of a conversation they were not in."""
        self.assertEqual(await self._delete(actor="teacher", teacher_id="teacher-2"),
                         "forbidden")
        self.assertFalse(self.saved)

    async def test_a_record_from_before_authorship_was_stored_can_be_removed(self):
        """`teacher_id` is absent on old records. Refusing those would make the
        oldest data in the system permanently unremovable."""
        self.record = _record(teacher_id=None)
        self.assertEqual(await self._delete(actor="teacher", teacher_id="teacher-9"),
                         "deleted")

    async def test_a_teacher_cannot_delete_a_childs_own_reflection(self):
        self.record = _record(author="learner", teacher_id=None)
        self.assertEqual(await self._delete(actor="teacher", teacher_id="teacher-1"),
                         "forbidden")
        self.assertFalse(self.saved)

    async def test_a_learner_still_cannot_delete_what_a_teacher_documented(self):
        self.assertEqual(await self._delete(actor="learner"), "forbidden")
        self.assertFalse(self.saved)

    async def test_a_learner_deletes_their_own_and_the_default_actor_is_the_learner(self):
        """The learner route calls this with no `actor`, and must keep working."""
        self.record = _record(author="learner", teacher_id=None)
        self.assertEqual(await self._delete(), "deleted")

    async def test_an_already_deleted_record_is_simply_not_there(self):
        self.record = _record(deleted=True)
        self.assertEqual(await self._delete(actor="teacher", teacher_id="teacher-1"),
                         "not_found")


class EditPermissionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.saved: list[dict] = []
        self.record = _record(
            author="learner",
            meeting_stage="good",
            goals=[{
                "id": "goal_1", "title": "להתאמן", "next_steps": "עשר דקות",
                "deadline": "2026-09-12", "progress_stage": "progressed",
                "reward_value": 15, "deleted": False,
            }],
        )
        self._patches = [
            patch.object(mentoring, "_load_conversation",
                         AsyncMock(side_effect=lambda lid, cid: self.record)),
            patch.object(mentoring, "_save_conversation",
                         AsyncMock(side_effect=lambda lid, rec: self.saved.append(rec))),
            patch.object(mentoring, "_project_goals", AsyncMock(return_value=None)),
        ]
        for handle in self._patches:
            handle.start()

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def test_a_learner_can_edit_their_conversation_summary(self):
        updated = await mentoring.update_conversation(
            "kid-a", "ment_1", {"notes": "עדכנתי את הסיכום", "meeting_stage": "thoughtful"},
        )
        self.assertEqual(updated["notes"], "עדכנתי את הסיכום")
        self.assertEqual(updated["meeting_stage"], "thoughtful")
        self.assertEqual(len(self.saved), 1)

    async def test_a_learner_can_edit_a_goal_without_resetting_its_progress_or_reward(self):
        updated = await mentoring.update_goal(
            "kid-a", "ment_1", "goal_1",
            {"title": "לתרגל", "next_steps": "חמש עשרה דקות", "deadline": "2026-09-14"},
        )
        goal = updated["goals"][0]
        self.assertEqual(goal["title"], "לתרגל")
        self.assertEqual(goal["progress_stage"], "progressed")
        self.assertEqual(goal["reward_value"], 15)
        mentoring._project_goals.assert_awaited_once_with("kid-a")

    async def test_a_learner_cannot_edit_a_teacher_documented_conversation(self):
        self.record["author"] = "teacher"
        self.assertIsNone(await mentoring.update_conversation("kid-a", "ment_1", {"notes": "שינוי"}))
        self.assertIsNone(await mentoring.update_goal("kid-a", "ment_1", "goal_1", {"title": "שינוי"}))
        self.assertFalse(self.saved)


class ProjectionSlotsTest(unittest.IsolatedAsyncioTestCase):
    """`brain.goals` is shared with the learner's own activeness goals.

    The mirror used to be `(preserved + mentoring)[-24:]`, and a slice drops
    from the FRONT — where `preserved` sits. So one conversation carrying four
    goals, routine now that the composer exists, could evict four of the
    child's own goals. The cap belongs to the mentoring source alone.
    """

    async def asyncSetUp(self):
        self.updates: list[dict] = []
        self.brain = {
            "goals": [
                {"id": f"self_{index}", "source": "activeness", "title": f"שלי {index}"}
                for index in range(6)
            ],
        }
        # 30 mentoring goals across 30 talks — more than the slot count.
        conversations = [
            {"id": f"ment_{index}", "learner_id": "kid-a", "visibility": "shared",
             "date": "2026-08-01", "author": "teacher",
             "goals": [{"id": f"goal_{index}", "title": f"יעד {index}",
                        "next_steps": "", "deleted": False}]}
            for index in range(30)
        ]
        self._patches = [
            patch.object(mentoring, "_raw_conversations",
                         AsyncMock(return_value=conversations)),
            patch.object(mentoring, "get_brain", AsyncMock(return_value=self.brain)),
            patch.object(mentoring, "apply_brain_updates",
                         AsyncMock(side_effect=lambda lid, up: self.updates.append(up))),
        ]
        for handle in self._patches:
            handle.start()

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def test_the_learners_own_goals_are_never_evicted_by_a_talk(self):
        await mentoring._project_goals("kid-a")
        goals = self.updates[0]["goals"]
        self.assertEqual(len([g for g in goals if g.get("source") == "activeness"]), 6)

    async def test_the_cap_applies_to_the_mentoring_slice_and_keeps_the_newest(self):
        await mentoring._project_goals("kid-a")
        mirrored = [g for g in self.updates[0]["goals"] if g.get("source") == "mentoring"]
        self.assertEqual(len(mirrored), mentoring.MENTORING_GOAL_SLOTS)
        # Newest last in `_raw_conversations` insertion order, so the tail wins.
        self.assertEqual(mirrored[-1]["text"], "יעד 29")



class PendingCountTest(unittest.IsolatedAsyncioTestCase):
    """The number on the app bar's badge, over a real (async) cursor.

    It was written as `sum(1 async for row in cursor for goal in ...)`, which
    builds an async generator that `sum` cannot consume. Every call raised, the
    except fell through to the JSON fallback — empty on a Mongo deployment —
    and the badge read zero for every teacher regardless of what was waiting.
    """

    class _Cursor:
        def __init__(self, rows):
            self._rows = rows

        def __aiter__(self):
            async def gen():
                for row in self._rows:
                    yield row
            return gen()

    class _Collection:
        def __init__(self, rows):
            self.rows = rows

        def find(self, _query, _projection=None):
            return PendingCountTest._Cursor(self.rows)

    @staticmethod
    def _goal(stage="summarized", approved=None):
        return {"progress_stage": stage, "approved_by": approved, "deleted": False}

    async def test_it_counts_finished_goals_nobody_has_signed_off(self):
        rows = [
            {"goals": [self._goal(), self._goal()]},
            {"goals": [self._goal(approved="teacher-1")]},   # already signed off
            {"goals": [self._goal(stage="chosen")]},         # not finished
            {"goals": []},
        ]
        with patch.object(mentoring, "_get_collection_named",
                          return_value=self._Collection(rows)):
            self.assertEqual(
                await mentoring.count_pending_approvals(["kid-a", "kid-b"]), 2)

    async def test_no_learners_asks_nothing(self):
        with patch.object(mentoring, "_get_collection_named",
                          return_value=self._Collection([{"goals": [self._goal()]}])):
            self.assertEqual(await mentoring.count_pending_approvals([]), 0)

if __name__ == "__main__":
    unittest.main()
