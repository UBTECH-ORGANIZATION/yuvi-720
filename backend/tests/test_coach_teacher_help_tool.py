"""`suggest_teacher_help`: Yuvi's own judgement opens the raise-hand button.

The tool is the conversational leg of the hand gate. What matters is that it
is lesson-only, that it writes the unlock where a reload can find it, that the
learner's client hears about it exactly once, and that the model's evidence
sentence never leaves the turn's own metadata.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.coach_modes import CoachMode  # noqa: E402
from app.agents.coach_tools.registry import (  # noqa: E402
    CoachToolContext,
    dispatch,
    reset_for_tests,
    schemas,
)
from app.services import coach_handoff, presence, realtime  # noqa: E402


COMP = "CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.COMPL-00001"
ITEM = f"{COMP}-item-00001"


def _context(mode: CoachMode = CoachMode.LESSON, bundle: dict | None = None) -> CoachToolContext:
    return CoachToolContext(
        learner_id="kid-1",
        mode=mode,
        language="he",
        session_id="lesson-1",
        exchange_id="exchange-1",
        bundle=bundle if bundle is not None else {
            "current": {"component_id": COMP, "item_id": ITEM, "question_id": "q1"},
        },
    )


def _learner_frames(publish) -> list[dict]:
    return [call.args[1] for call in publish.call_args_list if call.args[0] == "learner:kid-1"]


class TeacherHelpToolTests(unittest.TestCase):
    def setUp(self):
        reset_for_tests()
        from app.agents.coach_tools import teacher_help_tools
        importlib.reload(teacher_help_tools)
        presence.reset_for_tests()
        realtime.reset_for_tests()
        for item in (
            patch("app.brain.repository._get_collection_named", return_value=None),
            patch("app.brain.org.teachers_for_learner", new=AsyncMock(return_value=[])),
            patch.dict(os.environ, {"HAND_UNLOCK_GATE_ENABLED": "1"}),
        ):
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(reset_for_tests)

    def test_the_tool_is_offered_in_lesson_mode_only(self):
        names = lambda mode: {schema["function"]["name"] for schema in schemas(mode)}
        self.assertIn("suggest_teacher_help", names(CoachMode.LESSON))
        self.assertNotIn("suggest_teacher_help", names(CoachMode.GENERAL))

    def test_general_mode_cannot_open_the_hand(self):
        result = asyncio.run(dispatch(
            "suggest_teacher_help", {"reason": "asked_for_teacher"}, _context(CoachMode.GENERAL)))
        self.assertEqual(result, {"error": "tool_not_allowed_for_mode"})
        self.assertIsNone(presence.snapshot("kid-1")["hand_unlock"])

    def test_a_model_invented_reason_is_rejected(self):
        result = asyncio.run(dispatch(
            "suggest_teacher_help", {"reason": "bored"}, _context()))
        self.assertEqual(result, {"error": "invalid_argument_value:reason"})
        self.assertIsNone(presence.snapshot("kid-1")["hand_unlock"])

    def test_an_accepted_call_unlocks_the_hand_and_tells_the_learner_once(self):
        context = _context()
        with patch.object(realtime, "publish", wraps=realtime.publish) as publish:
            result = asyncio.run(dispatch(
                "suggest_teacher_help",
                {"reason": "stuck_after_help", "evidence": "still lost after the hint"},
                context,
            ))
        self.assertEqual(result, {"status": "accepted", "data": {"reason": "stuck_after_help"}})

        unlock = presence.snapshot("kid-1")["hand_unlock"]
        self.assertEqual(unlock["question_key"], f"{COMP}|{ITEM}|q1")
        self.assertEqual(unlock["reason"], "stuck_after_help")
        self.assertEqual(unlock["source"], "coach")
        self.assertIsNotNone(unlock["at"])

        self.assertEqual(_learner_frames(publish), [{
            "type": "hand_unlock", "reason": "stuck_after_help", "source": "coach",
            "question_key": f"{COMP}|{ITEM}|q1",
        }])
        # The evidence stays in the turn's metadata — the frame and presence
        # carry the reason only.
        self.assertEqual(context.teacher_suggestions, [{
            "reason": "stuck_after_help",
            "question_key": f"{COMP}|{ITEM}|q1",
            "evidence": "still lost after the hint",
            "unlocked": True,
        }])
        self.assertNotIn("evidence", unlock)

    def test_evidence_is_capped(self):
        context = _context()
        asyncio.run(dispatch(
            "suggest_teacher_help", {"reason": "other", "evidence": "x" * 500}, context))
        self.assertEqual(len(context.teacher_suggestions[0]["evidence"]), 120)

    def test_a_second_call_in_the_same_turn_is_a_no_op(self):
        context = _context()
        with patch.object(realtime, "publish", wraps=realtime.publish) as publish:
            asyncio.run(dispatch("suggest_teacher_help", {"reason": "emotional"}, context))
            result = asyncio.run(dispatch("suggest_teacher_help", {"reason": "off_track"}, context))
        self.assertEqual(result["data"]["reason"], "emotional")
        self.assertEqual(len(context.teacher_suggestions), 1)
        self.assertEqual(len(_learner_frames(publish)), 1)

    def test_no_screen_still_unlocks_with_no_question_key(self):
        """A lesson turn before the player reported a position: the hand still
        opens; the next screen change re-locks it like any other unlock."""
        context = _context(bundle={"current": {}})
        asyncio.run(dispatch("suggest_teacher_help", {"reason": "asked_for_teacher"}, context))
        self.assertIsNone(presence.snapshot("kid-1")["hand_unlock"]["question_key"])

    def test_the_kill_switch_makes_the_tool_inert(self):
        context = _context()
        with patch.dict(os.environ, {"HAND_UNLOCK_GATE_ENABLED": "0"}), \
             patch.object(realtime, "publish", wraps=realtime.publish) as publish:
            asyncio.run(dispatch("suggest_teacher_help", {"reason": "emotional"}, context))
            # Off means always open: nothing to write, nothing to announce.
            self.assertTrue(coach_handoff.hand_state("kid-1")["unlocked"])
        self.assertIsNone(presence.snapshot("kid-1")["hand_unlock"])
        self.assertEqual(_learner_frames(publish), [])
        self.assertEqual(context.teacher_suggestions[0]["unlocked"], False)


if __name__ == "__main__":
    unittest.main()
