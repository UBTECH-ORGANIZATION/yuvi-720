"""The learner picks how to learn a screen — and the coach must know which.

Captured live 29/07 while a learner used the video/cards playlist screen:

    verb    https://w3id.org/xapi/adb/verbs/selected
    object  …/methodica-science-mass-measure-01-01        (the component)
    result  {"response": "listening"} … then {"response": "cards"}
    context category http://720.edu.il/xapi/categories/learning-type

This is exactly the 720 §Selected / learningType signal. We were dropping it:
the ADL bridge only knew `id.tincanapi.com/verb/selected`, so twelve of these
statements were captured by the raw audit and never reached the brain — the coach
could not tell whether the learner was watching Dr. Oshrit or flipping cards.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


COMP = "methodica-science-mass-measure-01-01"
BASE = "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01"
LAUNCH = {"lid": "L", "cmp": COMP, "src": "kata", "unit": "u", "obj": "OBJ", "sid": "s1"}


def _statement(response: str, category: str = "http://720.edu.il/xapi/categories/learning-type"):
    return {
        "id": "stmt-1",
        "actor": {"account": {"name": "L"}},
        "verb": {"id": "https://w3id.org/xapi/adb/verbs/selected"},
        "object": {"id": f"{BASE}/{COMP}"},
        "result": {"response": response},
        "context": {"category": [{"id": category}]},
        "timestamp": "2026-07-29T08:39:24.000Z",
    }


class VerbBridgeTests(unittest.TestCase):
    def test_katas_selected_iri_is_accepted(self):
        slug, compat = events._provider_verb_slug(_statement("cards"), LAUNCH)
        self.assertEqual((slug, compat), ("selected", True))

    def test_it_is_still_refused_for_a_non_provider_launch(self):
        slug, _ = events._provider_verb_slug(_statement("cards"), {"src": "spark"})
        self.assertIsNone(slug)

    def test_the_choice_and_its_kind_survive_normalization(self):
        row = events.normalize_statement(_statement("listening"), LAUNCH)
        self.assertEqual(row["verb"], "selected")
        self.assertEqual(row["result"]["response"], "listening")
        self.assertEqual(row["selection_category"], "learning-type")

    def test_another_kind_of_choice_is_labelled_as_itself(self):
        """`selected` also carries practiceDecision / isUnderstood / … ."""
        row = events.normalize_statement(
            _statement("true", "http://720.edu.il/xapi/categories/practice-decision"),
            LAUNCH,
        )
        self.assertEqual(row["selection_category"], "practice-decision")


class FoldTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        from app.services import kata_catalog, kata_client

        component = kata_client.normalize_component({
            "id": COMP,
            "subContent": [
                {"id": f"{COMP}-002", "mediaFormat": "interactive-content",
                 "questions": [{"questionId": "q1"}]},
                {"id": f"{COMP}-003", "mediaFormat": "video",
                 "questions": [{"questionId": "q1"}]},
                {"id": f"{COMP}-004", "mediaFormat": "interactive-content",
                 "questions": [{"questionId": "q1"}]},
            ],
        })
        p = patch.object(kata_catalog, "get_component", return_value=component)
        p.start()
        self.addCleanup(p.stop)

    async def _fold(self, event, prior):
        captured: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured.update(set_updates or {})

        with (
            patch.object(events, "get_brain",
                         new=AsyncMock(return_value={"current_state": prior, "mastery": {}})),
            patch.object(events, "apply_brain_operators", new=AsyncMock(side_effect=fake_apply)),
            patch.object(events, "is_component_completion", return_value=False),
        ):
            await events._apply_event_to_brain(event)
        return captured

    def _event(self, response, category="learning-type"):
        return {
            "learner_id": "L", "verb": "selected", "launch": COMP, "unit_id": "u",
            "sub_item_id": None, "question_id": None, "selection_category": category,
            "result": {"response": response}, "occurred_at": "2026-07-29T08:39:24.000Z",
        }

    async def test_the_chosen_path_is_remembered(self):
        updates = await self._fold(self._event("cards"), {"component_id": COMP})
        self.assertEqual(updates.get("current_state.learning_choice"), "cards")

    async def test_switching_path_updates_it(self):
        updates = await self._fold(
            self._event("listening"), {"component_id": COMP, "learning_choice": "cards"}
        )
        self.assertEqual(updates.get("current_state.learning_choice"), "listening")

    async def test_a_different_kind_of_choice_does_not_pose_as_the_path(self):
        updates = await self._fold(
            self._event("true", category="practice-decision"), {"component_id": COMP}
        )
        self.assertNotIn("current_state.learning_choice", updates)

    async def test_choosing_a_path_puts_them_on_the_screen_that_offered_it(self):
        """Measured 29/07: `selected "listening"` at 12:04:33, then FIVE MINUTES
        of the learner working through the -003 playlist with no further Kata
        event at all. The pointer sat on -002 the whole time, so the chat kept
        its marked thread — and every nudge — on the question they had left.

        Same narrow rule as playback: the screen they are on carries no media and
        the very next one does, so the choice cannot mean anything else.
        """
        updates = await self._fold(
            self._event("listening"),
            {"component_id": COMP, "item_id": f"{COMP}-002", "question_id": "q1"},
        )
        self.assertEqual(updates.get("current_state.item_id"), f"{COMP}-003")
        self.assertEqual(updates.get("current_state.learning_choice"), "listening")

    async def test_switching_path_on_the_video_screen_moves_nothing(self):
        """Toggling video↔cards in place is not progress."""
        updates = await self._fold(
            self._event("cards"),
            {"component_id": COMP, "item_id": f"{COMP}-003", "question_id": "q1"},
        )
        self.assertNotIn("current_state.item_id", updates)
        self.assertEqual(updates.get("current_state.learning_choice"), "cards")

    async def test_a_choice_with_no_video_next_is_not_attributed(self):
        updates = await self._fold(
            self._event("cards"),
            {"component_id": COMP, "item_id": f"{COMP}-004", "question_id": "q1"},
        )
        self.assertNotIn("current_state.item_id", updates)

    async def test_a_different_kind_of_choice_never_moves_them(self):
        """practiceDecision / isUnderstood say nothing about position."""
        updates = await self._fold(
            self._event("true", category="practice-decision"),
            {"component_id": COMP, "item_id": f"{COMP}-002", "question_id": "q1"},
        )
        self.assertNotIn("current_state.item_id", updates)

    async def test_the_path_is_forgotten_when_they_leave_the_screen(self):
        """Otherwise the coach talks about "the clip you chose" two questions on."""
        updates = await self._fold(
            {
                "learner_id": "L", "verb": "initialized", "launch": COMP, "unit_id": "u",
                "sub_item_id": f"{COMP}-004", "question_id": None, "result": {},
                "occurred_at": "2026-07-29T08:45:00.000Z",
            },
            {"component_id": COMP, "item_id": f"{COMP}-003", "learning_choice": "listening"},
        )
        self.assertIsNone(updates.get("current_state.learning_choice"))


if __name__ == "__main__":
    unittest.main()
