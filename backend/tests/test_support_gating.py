"""One-shot hint/explanation gating + Kata sub-item identity tests.

Kata question ids repeat across sub-content screens (`q1` on nearly every one),
so "the question the learner is on" is the SUB-ITEM id parsed from the xAPI
object id (`…/{subContentId}/q{N}`). The support key must change on any real
progression and the used-flags must reset with it. A lesson RELAUNCH restarts
the content from the first question, so it archives the open activity thread
(empty ones are pruned, not kept as clutter).
"""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from app.agents import sessions, tutor_decision
from app.services.events import (
    is_component_completion,
    normalize_statement,
    split_item_question,
)


KATA_LAUNCH = {
    "lid": "learner-1",
    "obj": "MOE.SCI.G7.CHEM.DEMO",
    "cmp": "methodica-science-mass-measure-01-01",
    "unit": "methodica-science-mass-measure-01",
    "subj": "science",
    "assessment": False,
    "src": "kata",
    "sid": "sess-1",
}


def kata_statement(object_id, verb="answered", success=False):
    return {
        "id": f"stmt-{object_id}-{verb}",
        "actor": {"account": {"name": "learner-1"}},
        "verb": {"id": f"http://adlnet.gov/expapi/verbs/{verb}"},
        "object": {"id": object_id},
        "result": {"success": success},
    }


class SplitItemQuestionTest(unittest.TestCase):
    def test_slash_separated_kata_object(self):
        item, question = split_item_question(
            "https://kata.cet.ac.il/xapi/methodica-science-mass-measure-01-01-004/q2"
        )
        self.assertEqual(item, "methodica-science-mass-measure-01-01-004")
        self.assertEqual(question, "q2")

    def test_hash_separated_object(self):
        item, question = split_item_question("YuviDori-math-angles-00001-item#q1")
        self.assertEqual(item, "YuviDori-math-angles-00001-item")
        self.assertEqual(question, "q1")

    def test_component_level_object_has_no_question_tail(self):
        self.assertEqual(
            split_item_question("methodica-science-mass-measure-01-01"), (None, None)
        )
        self.assertEqual(split_item_question(None), (None, None))
        self.assertEqual(split_item_question(""), (None, None))

    def test_normalized_event_carries_sub_item_and_question(self):
        event = normalize_statement(
            kata_statement("methodica-science-mass-measure-01-01-004/q1"), KATA_LAUNCH
        )
        self.assertIsNotNone(event)
        self.assertEqual(event["sub_item_id"], "methodica-science-mass-measure-01-01-004")
        self.assertEqual(event["question_id"], "q1")

    def test_component_level_event_has_no_sub_item(self):
        event = normalize_statement(
            kata_statement("methodica-science-mass-measure-01-01", verb="completed",
                           success=True),
            KATA_LAUNCH,
        )
        self.assertIsNotNone(event)
        self.assertIsNone(event["sub_item_id"])


class ComponentCompletionScopeTest(unittest.TestCase):
    """Only a component-level `completed` finishes the component — per-screen
    `completed` (object == a sub-item) is item progress, not "lesson done"."""

    def _completed(self, object_id):
        return normalize_statement(
            kata_statement(object_id, verb="completed", success=True), KATA_LAUNCH
        )

    def test_component_object_is_component_completion(self):
        event = self._completed("methodica-science-mass-measure-01-01")
        self.assertTrue(is_component_completion(event))

    def test_per_screen_completion_is_not(self):
        # object == a sub-item (…-001) or a question (…/q1): item progress only.
        self.assertFalse(
            is_component_completion(self._completed("methodica-science-mass-measure-01-01-001"))
        )
        self.assertFalse(
            is_component_completion(self._completed("methodica-science-mass-measure-01-01-001/q1"))
        )

    def test_answered_is_never_component_completion(self):
        event = normalize_statement(
            kata_statement("methodica-science-mass-measure-01-01-001/q1"), KATA_LAUNCH
        )
        self.assertFalse(is_component_completion(event))


class SupportKeyTest(unittest.TestCase):
    def test_key_changes_when_sub_item_advances(self):
        first = tutor_decision.support_question_key(
            {"component_id": "cmp", "item_id": "cmp-001", "question_id": "q1"}, None
        )
        second = tutor_decision.support_question_key(
            {"component_id": "cmp", "item_id": "cmp-002", "question_id": "q1"}, None
        )
        self.assertNotEqual(first, second)

    def test_key_falls_back_to_surface_component(self):
        key = tutor_decision.support_question_key({}, "cmp-from-surface")
        self.assertIn("cmp-from-surface", key)

    def test_used_flags_reset_when_key_changes(self):
        state = {
            "support_used": {
                "question_key": "cmp|cmp-001|q1", "hint": True, "explanation": False,
            }
        }
        same = tutor_decision.support_used(state, "cmp|cmp-001|q1")
        self.assertEqual(same, {"hint": True, "explanation": False})
        moved = tutor_decision.support_used(state, "cmp|cmp-002|q1")
        self.assertEqual(moved, {"hint": False, "explanation": False})

    def test_used_flags_empty_state(self):
        self.assertEqual(
            tutor_decision.support_used({}, "cmp||"),
            {"hint": False, "explanation": False},
        )


class RedoResetTest(unittest.IsolatedAsyncioTestCase):
    """§6 explicit "redo the component" resets our coach thread (ordinary
    relaunches preserve it — continuity is the default)."""

    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)
        self.collection_patch = patch.object(sessions, "_get_collection_named", return_value=None)
        self.collection_patch.start()
        self.session_path_patch = patch.object(sessions, "_FALLBACK", root / "sessions.json")
        self.history_path_patch = patch.object(sessions, "_HISTORY_FALLBACK", root / "history.json")
        self.session_path_patch.start()
        self.history_path_patch.start()
        sessions._indexes_ready = False

    async def asyncTearDown(self) -> None:
        self.history_path_patch.stop()
        self.session_path_patch.stop()
        self.collection_patch.stop()
        self.temp_dir.cleanup()

    async def test_redo_archives_used_thread_and_prunes_empty_one(self) -> None:
        learner_id = "relaunch-learner"
        unit_id, component_id = "unit-1", "cmp-1"

        used = await sessions.create_conversation(
            learner_id, unit_id=unit_id, component_id=component_id
        )
        await sessions.append_turn(
            learner_id, "coach",
            user="[support:hint]", assistant="hint text",
            session_id=used["id"], exchange_id="x1",
            include_user_in_history=False,
        )
        await sessions.reset_activity_conversations(learner_id, unit_id, component_id)

        # The used thread is closed, so a new lesson load resolves a FRESH one.
        fresh = await sessions.create_conversation(
            learner_id, unit_id=unit_id, component_id=component_id
        )
        self.assertNotEqual(fresh["id"], used["id"])

        # An untouched (empty) thread is pruned on redo, not archived.
        await sessions.reset_activity_conversations(learner_id, unit_id, component_id)
        history = sessions._read_history_fallback()
        empty_survivors = [
            doc for doc in history["conversations"].values()
            if doc.get("session_id") == fresh["id"] and doc.get("is_deleted") is not True
        ]
        self.assertEqual(empty_survivors, [])


if __name__ == "__main__":
    unittest.main()
