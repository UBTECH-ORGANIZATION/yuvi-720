"""Learning session relaunches preserve the Coach's live question context."""

import unittest

from app.services.learning_sessions import _session_state_updates


UNIT = {"id": "unit-1"}
COMPONENT = {"id": "component-1"}
PRIOR_STATE = {
    "component_id": "component-1",
    "item_id": "component-1-003",
    "question_id": "q1",
}


class LearningSessionContinuityTests(unittest.TestCase):
    def test_same_component_relaunch_preserves_current_question(self):
        updates = _session_state_updates(UNIT, COMPONENT, PRIOR_STATE, restart=False)

        self.assertEqual(updates, {
            "current_state.unit_id": "unit-1",
            "current_state.component_id": "component-1",
        })

    def test_explicit_redo_resets_current_question(self):
        updates = _session_state_updates(UNIT, COMPONENT, PRIOR_STATE, restart=True)

        self.assertIsNone(updates["current_state.item_id"])
        self.assertIsNone(updates["current_state.question_id"])

    def test_new_component_resets_current_question(self):
        updates = _session_state_updates(UNIT, {"id": "component-2"}, PRIOR_STATE, restart=False)

        self.assertIsNone(updates["current_state.item_id"])
        self.assertIsNone(updates["current_state.question_id"])