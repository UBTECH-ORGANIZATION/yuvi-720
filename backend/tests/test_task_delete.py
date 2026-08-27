"""Deleting a task takes everything downstream of it, or it is not a delete.

A task is five collections: the task, its generated content per component,
every opening, every child's activation of an opening, and every attempt they
submitted. Removing only the task row leaves a child holding a live activation
that points at material which no longer exists — worse than the clutter the
teacher was clearing.

The other half is that it is IRREVERSIBLE and takes children's work with it, so
the client has to be able to say how much before asking. That is what
`/tasks/{id}/impact` is for, and it is pinned here beside the delete because a
confirmation dialog quoting the wrong numbers is how a teacher deletes forty
attempts believing it was a draft.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import store


def run(coro):
    return asyncio.run(coro)


class DeleteTakesTheWholeTree(unittest.TestCase):
    """Driven through the JSON fallback, so no live database is touched."""

    def setUp(self) -> None:
        self.data = {"tasks": [], "content": [], "launches": [],
                     "activations": [], "attempts": []}
        self._read = store._read_fallback
        self._write = store._write_fallback
        self._collection = store._get_collection_named
        store._read_fallback = lambda: {k: list(v) for k, v in self.data.items()}
        store._write_fallback = self._capture
        # Force the fallback path: no Mongo handle for any collection.
        store._get_collection_named = lambda name: None

    def _capture(self, data):
        self.data = {key: list(value) for key, value in data.items()}

    def tearDown(self) -> None:
        store._read_fallback = self._read
        store._write_fallback = self._write
        store._get_collection_named = self._collection

    def _seed(self):
        task_id = "task-1"
        launch = store.launch_id(task_id, 1)
        other = "task-2"
        self.data = {
            "tasks": [{"_id": task_id, "teacher_id": "t1"}, {"_id": other, "teacher_id": "t1"}],
            "content": [
                {"_id": store.content_id(task_id, "practice")},
                {"_id": store.content_id(task_id, "test")},
                {"_id": store.content_id(other, "practice")},
            ],
            "launches": [{"_id": launch, "task_id": task_id},
                         {"_id": store.launch_id(other, 1), "task_id": other}],
            "activations": [
                {"_id": store.activation_id(launch, "kid-a"),
                 "launch_id": launch, "task_id": task_id},
                {"_id": store.activation_id(launch, "kid-b"),
                 "launch_id": launch, "task_id": task_id},
            ],
            "attempts": [
                {"_id": "att-1", "launch_id": launch, "task_id": task_id,
                 "learner_id": "kid-a"},
                {"_id": "att-2", "launch_id": launch, "task_id": task_id,
                 "learner_id": "kid-b"},
            ],
        }
        return task_id, other

    def test_every_collection_is_cleared(self):
        task_id, _ = self._seed()
        removed = run(store.delete_task(task_id))

        self.assertEqual(removed["tasks"], 1)
        self.assertEqual(removed["content"], 2)
        self.assertEqual(removed["launches"], 1)
        self.assertEqual(removed["activations"], 2)
        self.assertEqual(removed["attempts"], 2)
        self.assertIsNone(run(store.get_task(task_id)))

    def test_a_neighbouring_task_is_untouched(self):
        """The blast radius is one task. Ids compose from the task id, so a
        sloppy prefix match here would take the next task's content with it."""
        task_id, other = self._seed()
        run(store.delete_task(task_id))

        self.assertIsNotNone(run(store.get_task(other)))
        self.assertEqual([row["_id"] for row in self.data["content"]],
                         [store.content_id(other, "practice")])
        self.assertEqual(len(self.data["launches"]), 1)

    def test_nothing_of_the_task_survives_anywhere(self):
        """Stated over the whole store rather than per collection, so a
        collection added later fails this instead of being quietly missed."""
        task_id, _ = self._seed()
        run(store.delete_task(task_id))
        for rows in self.data.values():
            for row in rows:
                self.assertNotIn(task_id, str(row.get("_id")))

    def test_deleting_a_task_nobody_ever_opened_is_not_an_error(self):
        """A draft is the common case: no launches, no activations, no
        attempts. It must not need a different path."""
        self.data = {"tasks": [{"_id": "draft-1", "teacher_id": "t1"}],
                     "content": [], "launches": [], "activations": [], "attempts": []}
        removed = run(store.delete_task("draft-1"))
        self.assertEqual(removed["tasks"], 1)
        self.assertEqual(removed["attempts"], 0)
        self.assertEqual(self.data["tasks"], [])


if __name__ == "__main__":
    unittest.main()
