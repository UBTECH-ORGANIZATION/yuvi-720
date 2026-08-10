"""Teacher-authored insights (F6 student §3) — the write lane into the profile.

The sharp edge here is `visibility`. `teacher_directives` is already inside the
Coach's read scope, so a note marked `coach` changes what Yuvi says to the
child. That must be opt-in and provable; a `private` note reaching an agent
would be a privacy breach, not a UI bug.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import teacher_insights_store as store


def run(coro):
    return asyncio.run(coro)


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, length=None):
        return list(self._rows[:length] if length else self._rows)


class _FakeCollection:
    """Enough of the motor surface for this module: insert, find, update."""

    def __init__(self):
        self.rows: list[dict] = []

    async def insert_one(self, document):
        self.rows.append(dict(document))

    def find(self, query):
        def matches(row):
            return all(row.get(field) == value for field, value in query.items())
        return _FakeCursor([row for row in self.rows if matches(row)])

    async def update_one(self, query, update):
        for row in self.rows:
            if all(row.get(f) == v for f, v in query.items()):
                row.update(update.get("$set") or {})
                return type("R", (), {"matched_count": 1})()
        return type("R", (), {"matched_count": 0})()


class TeacherInsightsStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.collection = _FakeCollection()
        self.brain: dict = {"strengths": [], "challenges": [], "teacher_directives": []}
        self.applied: list[dict] = []

        async def _apply(learner_id, updates):
            self.applied.append(updates)
            self.brain.update(updates)
            return self.brain

        self._patches = [
            patch("app.services.teacher_insights_store._get_collection_named",
                  return_value=self.collection),
            patch("app.services.teacher_insights_store.get_brain",
                  new=AsyncMock(side_effect=lambda lid: self.brain)),
            patch("app.services.teacher_insights_store.apply_brain_updates",
                  new=AsyncMock(side_effect=_apply)),
        ]
        for item in self._patches:
            item.start()

    def tearDown(self) -> None:
        for item in self._patches:
            item.stop()

    def _create(self, **kwargs):
        payload = {
            "learner_id": "kid", "teacher_id": "alice",
            "kind": "note", "text": "something", "visibility": "private",
        }
        payload.update(kwargs)
        return run(store.create(**payload))

    # ── validation ───────────────────────────────────────────────────────────

    def test_rejects_unknown_kind_and_visibility(self):
        with self.assertRaises(ValueError):
            self._create(kind="vibes")
        with self.assertRaises(ValueError):
            self._create(visibility="public")

    def test_rejects_empty_text(self):
        with self.assertRaises(ValueError):
            self._create(text="   ")

    # ── mirroring into the learner profile ───────────────────────────────────

    def test_strength_is_mirrored_into_brain_strengths(self):
        self._create(kind="strength", text="Great at explaining her reasoning")
        labels = [s["label"] for s in self.brain["strengths"]]
        self.assertIn("Great at explaining her reasoning", labels)
        self.assertEqual(self.brain["strengths"][-1]["source"], "teacher")
        self.assertEqual(self.brain["strengths"][-1]["teacher_id"], "alice")

    def test_weakness_and_challenge_both_mirror_into_challenges(self):
        self._create(kind="weakness", text="Rushes word problems")
        self._create(kind="challenge", text="Loses focus after 20 minutes")
        labels = [c["label"] for c in self.brain["challenges"]]
        self.assertIn("Rushes word problems", labels)
        self.assertIn("Loses focus after 20 minutes", labels)

    def test_system_authored_entries_are_preserved(self):
        """A teacher note must never clobber what the engine derived."""
        self.brain["strengths"] = [{"label": "system-derived", "source": "system"}]
        self._create(kind="strength", text="teacher-derived")
        sources = [s["source"] for s in self.brain["strengths"]]
        self.assertIn("system", sources)
        self.assertIn("teacher", sources)

    def test_soft_delete_removes_it_from_the_profile(self):
        insight = self._create(kind="strength", text="temporary read")
        self.assertTrue(any(s["label"] == "temporary read" for s in self.brain["strengths"]))
        removed = run(store.soft_delete(insight["_id"], learner_id="kid"))
        self.assertTrue(removed)
        self.assertFalse(any(s["label"] == "temporary read" for s in self.brain["strengths"]))
        # Soft: the row survives for the record, flagged.
        self.assertTrue(self.collection.rows[0]["deleted"])

    def test_soft_delete_is_scoped_to_the_learner(self):
        insight = self._create(kind="note", text="x")
        self.assertFalse(run(store.soft_delete(insight["_id"], learner_id="other-kid")))

    # ── the visibility boundary ──────────────────────────────────────────────

    def test_private_note_never_reaches_the_coach(self):
        self._create(kind="note", text="Parents divorcing — handle gently",
                     visibility="private")
        self.assertEqual(self.brain["teacher_directives"], [])

    def test_shared_note_is_visible_to_the_learner_but_not_to_the_coach(self):
        self._create(kind="note", text="Nice work this week", visibility="shared")
        self.assertEqual(self.brain["teacher_directives"], [])
        visible = run(store.list_visible_to_learner("kid"))
        self.assertEqual(len(visible), 1)

    def test_coach_note_becomes_a_directive(self):
        self._create(kind="note", text="Use football examples", visibility="coach")
        directives = self.brain["teacher_directives"]
        self.assertEqual(len(directives), 1)
        self.assertEqual(directives[0]["text"], "Use football examples")
        self.assertEqual(directives[0]["origin"], "teacher_insight")
        self.assertEqual(directives[0]["author"], "teacher")

    def test_private_notes_are_excluded_from_the_learner_view(self):
        self._create(kind="note", text="private read", visibility="private")
        self._create(kind="note", text="shared read", visibility="shared")
        visible = [row["text"] for row in run(store.list_visible_to_learner("kid"))]
        self.assertEqual(visible, ["shared read"])

    def test_deleting_a_coach_note_withdraws_the_directive(self):
        insight = self._create(kind="note", text="Use football examples", visibility="coach")
        self.assertEqual(len(self.brain["teacher_directives"]), 1)
        run(store.soft_delete(insight["_id"], learner_id="kid"))
        self.assertEqual(self.brain["teacher_directives"], [])

    def test_directives_from_other_sources_are_not_disturbed(self):
        self.brain["teacher_directives"] = [
            {"id": "td_manual", "text": "existing", "author": "teacher"}
        ]
        self._create(kind="note", text="from insight", visibility="coach")
        ids = [d["id"] for d in self.brain["teacher_directives"]]
        self.assertIn("td_manual", ids)
        self.assertEqual(len(ids), 2)

    # ── listing ──────────────────────────────────────────────────────────────

    def test_list_excludes_deleted_and_orders_newest_first(self):
        first = self._create(kind="note", text="one")
        self._create(kind="note", text="two")
        run(store.soft_delete(first["_id"], learner_id="kid"))
        rows = run(store.list_for("kid"))
        self.assertEqual([row["text"] for row in rows], ["two"])
        self.assertEqual(len(run(store.list_for("kid", include_deleted=True))), 2)


if __name__ == "__main__":
    unittest.main()


class SharedNoteNotifiesTheStudent(TeacherInsightsStoreTest):
    """The A10 row this file used to miss: shared → the student's bell.

    Only `shared`. A `private` note is teacher analytics, and a `coach`
    directive steers Yuvi — a bell row announcing it would turn a steering
    lane into surveillance-by-notification.
    """

    def _create_with_notify(self, **kwargs):
        notify = AsyncMock(return_value={"_id": "n1"})
        with patch("app.services.notifications.notify", notify), \
             patch("app.services.notifications.KIND_TEACHER_NOTE", "teacher_note"):
            row = self._create(**kwargs)
        return row, notify

    def test_a_shared_note_rings_the_students_bell_once(self):
        row, notify = self._create_with_notify(visibility="shared", text="כל הכבוד על ההתמדה")
        notify.assert_awaited_once()
        args, kwargs = notify.await_args
        self.assertEqual(args[0], "kid")
        # Deterministic per insight — a retry cannot ring twice.
        self.assertEqual(kwargs["notification_id"], f"teacher_note:{row['_id']}")
        self.assertEqual(kwargs["title_key"], "notif.teacherNote.shared")
        self.assertIn("text", kwargs["params"])

    def test_a_private_note_stays_silent(self):
        _, notify = self._create_with_notify(visibility="private")
        notify.assert_not_awaited()

    def test_a_coach_directive_stays_silent(self):
        _, notify = self._create_with_notify(visibility="coach")
        notify.assert_not_awaited()

    def test_a_failed_bell_does_not_lose_the_note(self):
        with patch("app.services.notifications.notify",
                   AsyncMock(side_effect=RuntimeError("bus down"))):
            row = self._create(visibility="shared")
        self.assertEqual(len(self.collection.rows), 1)
        self.assertEqual(row["visibility"], "shared")
