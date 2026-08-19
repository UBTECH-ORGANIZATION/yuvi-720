"""What a conversation stores, and what a re-save is allowed to write back.

Two bugs of the same shape lived here. `create_conversation` accepted
`teacher_id`, `source` and `visible_to_learner` from its callers and read none
of them — so nothing recorded which teacher set a child's goal, and visibility
was `shared` by falling through to a default rather than by being understood.
And `_save_conversation` wrote back four hard-coded keys, so any other field
mutated on a loaded record was silently discarded.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import mentoring


class _FakeCollection:
    def __init__(self):
        self.inserted: list[dict] = []
        self.updates: list[dict] = []

    async def insert_one(self, document):
        self.inserted.append(document)

    async def update_one(self, query, update):
        self.updates.append({"query": query, "update": update})


class CreatedFieldsTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.collection = _FakeCollection()
        self._patches = [
            patch.object(mentoring, "_get_collection_named", return_value=self.collection),
            patch.object(mentoring, "_project_goals", AsyncMock(return_value=None)),
            patch.object(
                mentoring.rewards, "price_goal",
                AsyncMock(return_value={"value": 10, "why": "because"}),
            ),
            patch("app.services.lrs.reporter.report_mentoring_record", AsyncMock(return_value=None)),
        ]
        for handle in self._patches:
            handle.start()

    async def asyncTearDown(self):
        for handle in self._patches:
            handle.stop()

    async def _create(self, **data):
        return await mentoring.create_conversation({"learner_id": "kid-a", **data})

    async def test_the_teacher_who_wrote_it_is_recorded(self):
        """Without this a conversation history row has nobody to attribute the
        talk to, and `teacher_name` is empty on every teacher-authored record."""
        record = await self._create(author="teacher", teacher_id="teacher-1")
        self.assertEqual(record["teacher_id"], "teacher-1")
        self.assertEqual(self.collection.inserted[0]["teacher_id"], "teacher-1")

    async def test_source_defaults_to_who_wrote_it(self):
        self.assertEqual((await self._create(author="teacher"))["source"], "teacher")
        self.assertEqual((await self._create(author="learner"))["source"], "learner")

    async def test_an_explicit_visibility_is_honoured(self):
        record = await self._create(visibility="teacher_only")
        self.assertEqual(record["visibility"], "teacher_only")

    async def test_the_boolean_spelling_is_understood_too(self):
        """`assign_goal` has always passed `visible_to_learner`. It worked only
        because the default happened to agree with it."""
        self.assertEqual((await self._create(visible_to_learner=True))["visibility"], "shared")
        self.assertEqual(
            (await self._create(visible_to_learner=False))["visibility"], "teacher_only")

    async def test_nothing_said_means_shared(self):
        self.assertEqual((await self._create())["visibility"], "shared")

    async def test_the_boolean_is_not_stored_as_a_second_field(self):
        """Two fields meaning the same thing is one of them eventually being
        wrong. `_brain_goal_entry` derives the boolean where it is needed."""
        record = await self._create(visible_to_learner=False)
        self.assertNotIn("visible_to_learner", record)

    async def test_a_garbage_visibility_falls_back_to_shared(self):
        self.assertEqual((await self._create(visibility="public"))["visibility"], "shared")


class ResaveTest(unittest.IsolatedAsyncioTestCase):
    """`_save_conversation` writes back an allow-list, presence-guarded."""

    def setUp(self):
        self.collection = _FakeCollection()

    async def _save(self, record):
        with patch.object(mentoring, "_get_collection_named", return_value=self.collection):
            await mentoring._save_conversation("kid-a", record)
        return self.collection.updates[0]["update"]["$set"]

    async def test_notes_survive_a_resave(self):
        """Editing the notes on a loaded conversation used to be discarded."""
        changes = await self._save({
            "id": "ment_1", "goals": [], "notes": "what we discussed",
        })
        self.assertEqual(changes["notes"], "what we discussed")

    async def test_a_field_the_record_does_not_carry_is_not_written(self):
        """A legacy record has no `notes`. Writing the key anyway would set it
        to null on a document that simply predates the field."""
        changes = await self._save({"id": "ment_1", "goals": []})
        self.assertNotIn("notes", changes)
        self.assertNotIn("teacher_only_note", changes)

    async def test_goals_and_deletion_are_always_written(self):
        """These two are what a re-save exists for; they must be present even
        on a record that arrived without them."""
        changes = await self._save({"id": "ment_1"})
        self.assertEqual(changes["goals"], [])
        self.assertIs(changes["deleted"], False)
        self.assertIn("updated_at", changes)

    async def test_visibility_and_attribution_can_be_corrected(self):
        changes = await self._save({
            "id": "ment_1", "goals": [],
            "visibility": "teacher_only", "teacher_id": "teacher-2", "source": "teacher",
        })
        self.assertEqual(changes["visibility"], "teacher_only")
        self.assertEqual(changes["teacher_id"], "teacher-2")


if __name__ == "__main__":
    unittest.main()
