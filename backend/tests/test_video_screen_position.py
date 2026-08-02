"""A learner watching a video is ON the video screen.

Measured 29/07 on a live session (`…-01-01`, learner on the מאזניים question):

    08:12:17  completed  -002
    08:12:23  played     (object = the COMPONENT, no screen id)
    08:12:25  played     …
    08:13:56  paused     …            ← 90 seconds of playback
              (no `initialized` for -003 at all)

Kata reports playback against the component and its `initialized` for the video
screen arrives late or never, so the pointer, the chat's marked thread and the
coach's grounding all stayed on the question the learner had already finished —
they were watching "איך מודדים נכון" while Yuvi still held the מאזניים question.

Playback is attributed only when it cannot mean anything else: the screen they
are on carries no media and the very next one does.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog, kata_client  # noqa: E402


C = "methodica-science-mass-measure-01-01"
COMPONENT = kata_client.normalize_component({
    "id": C,
    "subContent": [
        {"id": f"{C}-002", "mediaFormat": "interactive-content", "contentType": "instruction",
         "questions": [{"questionId": "q1"}]},
        # Plays a clip AND asks about it — a question screen that is the one playing.
        {"id": f"{C}-003", "mediaFormat": "video", "contentType": "instruction",
         "questions": [{"questionId": "q1"}]},
        {"id": f"{C}-004", "mediaFormat": "interactive-content", "contentType": "practice",
         "questions": [{"questionId": "q1"}]},
        {"id": f"{C}-005", "mediaFormat": "interactive-content", "contentType": "practice",
         "questions": [{"questionId": "q1"}]},
    ],
})


class AttributionTests(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(kata_catalog, "get_component", return_value=COMPONENT)
        p.start()
        self.addCleanup(p.stop)

    def test_playback_on_a_silent_screen_means_the_next_one_started(self):
        self.assertEqual(
            kata_catalog.next_item_if_watchable(C, f"{C}-002"), f"{C}-003"
        )

    def test_playback_while_already_on_the_video_screen_moves_nothing(self):
        """Pausing and replaying the clip must not push them forward."""
        self.assertIsNone(kata_catalog.next_item_if_watchable(C, f"{C}-003"))

    def test_playback_with_no_video_next_is_not_attributed(self):
        """Something else played — guessing a screen would be worse than waiting."""
        self.assertIsNone(kata_catalog.next_item_if_watchable(C, f"{C}-004"))

    def test_the_last_screen_has_no_next(self):
        self.assertIsNone(kata_catalog.next_item_if_watchable(C, f"{C}-005"))

    def test_unknown_inputs_are_silent(self):
        self.assertIsNone(kata_catalog.next_item_if_watchable(C, "nope"))
        self.assertIsNone(kata_catalog.next_item_if_watchable(None, f"{C}-002"))
        self.assertIsNone(kata_catalog.next_item_if_watchable(C, None))

    def test_a_video_question_screen_reads_as_a_watch_screen(self):
        rows = kata_catalog.item_profiles(C)
        video = next(r for r in rows if r["id"] == f"{C}-003")
        self.assertTrue(kata_catalog.plays_media(video))
        self.assertEqual(kata_catalog.kind_for_row(video), "watch")
        self.assertEqual(video["question_count"], 1)   # …that also asks


class FoldTests(unittest.IsolatedAsyncioTestCase):
    """The same rule, through the real event fold."""

    def setUp(self):
        p = mock.patch.object(kata_catalog, "get_component", return_value=COMPONENT)
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

    async def test_played_moves_the_pointer_onto_the_video_screen(self):
        prior = {
            "component_id": C, "item_id": f"{C}-002", "question_id": "q1",
            "at": "2026-07-29T08:12:17.000Z",
        }
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "played", "sub_item_id": None,
                "question_id": None, "occurred_at": "2026-07-29T08:12:23.000Z",
                "result": {},
            },
            prior,
        )
        self.assertEqual(updates.get("current_state.item_id"), f"{C}-003")
        self.assertEqual(updates.get("current_state.question_id"), "q1")

    async def test_a_replayed_older_statement_cannot_move_them(self):
        prior = {
            "component_id": C, "item_id": f"{C}-002", "question_id": "q1",
            "at": "2026-07-29T08:20:00.000Z",
        }
        updates = await self._fold(
            {
                "learner_id": "t", "launch": C, "verb": "played", "sub_item_id": None,
                "question_id": None, "occurred_at": "2026-07-29T08:12:23.000Z",
                "result": {},
            },
            prior,
        )
        self.assertNotIn("current_state.item_id", updates)


if __name__ == "__main__":
    unittest.main()
