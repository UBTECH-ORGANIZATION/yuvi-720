"""A screen's embedded video can hold several clips under ONE catalog item id.

Live proof (27/08, `…-01-01-003`, session `fDhHX_l_2ruB-F0A`): `played`/`paused`
always target the COMPONENT (no clip id anywhere), and the three `initialized`
statements this item sent in one visit are byte-identical bar their timestamp.
The only signal a NEW clip started — not a rewind of the current one — is this
same item re-`initialized` while it is already the current item. That bumps
`current_state.item_generation` so the client can re-arm per-clip support
(video summary / visual) without a distinct catalog item id.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog  # noqa: E402

C = "methodica-science-mass-measure-01-01"


class GenerationFoldTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        p = mock.patch.object(kata_catalog, "default_question_id", return_value="q1")
        p.start()
        self.addCleanup(p.stop)

    async def _fold(self, event, prior):
        from unittest.mock import AsyncMock

        from app.services import events

        captured: dict = {}

        async def fake_apply(_lid, set_updates, inc_updates=None):
            captured.update(set_updates or {})

        with mock.patch.object(
            events, "get_brain",
            new=AsyncMock(return_value={"current_state": prior, "mastery": {}}),
        ), mock.patch.object(
            events, "apply_brain_operators", new=AsyncMock(side_effect=fake_apply),
        ), mock.patch.object(events, "is_component_completion", return_value=False):
            await events._apply_event_to_brain(event)
        return captured

    async def test_arriving_on_a_new_item_starts_at_generation_zero(self):
        prior = {"component_id": C, "item_id": f"{C}-002", "question_id": "q1"}
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "initialized",
                "sub_item_id": f"{C}-003", "question_id": None,
            },
            prior,
        )
        self.assertEqual(updates.get("current_state.item_generation"), 0)

    async def test_reinitializing_the_current_item_bumps_generation(self):
        """Video 1 finished (`completed`), then the SAME item id re-`initialized`
        with a new clip — this is the only shape that distinguishes it from the
        learner simply rewinding video 1 to its start."""
        prior = {"component_id": C, "item_id": f"{C}-003", "question_id": "q1", "item_generation": 0}
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "initialized",
                "sub_item_id": f"{C}-003", "question_id": None,
            },
            prior,
        )
        self.assertEqual(updates.get("current_state.item_generation"), 1)
        # The catalog item/question identity is unchanged — only the clip did.
        self.assertEqual(updates.get("current_state.item_id"), f"{C}-003")

    async def test_a_third_reinitialization_keeps_counting(self):
        prior = {"component_id": C, "item_id": f"{C}-003", "question_id": "q1", "item_generation": 1}
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "initialized",
                "sub_item_id": f"{C}-003", "question_id": None,
            },
            prior,
        )
        self.assertEqual(updates.get("current_state.item_generation"), 2)

    async def test_answering_the_same_item_does_not_bump_generation(self):
        """Only a fresh `initialized` is evidence of a new clip — an `answered`
        for the item already on screen is normal progress, not a re-init."""
        prior = {"component_id": C, "item_id": f"{C}-003", "question_id": "q1", "item_generation": 1}
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "answered",
                "sub_item_id": f"{C}-003", "question_id": "q1",
            },
            prior,
        )
        self.assertNotIn("current_state.item_generation", updates)


if __name__ == "__main__":
    unittest.main()
