"""Spec v1.2 (integration report 9, 22/09): a media `completed` is not reported
to the ministry — "אין צורך לשלוח הודעת מדיה completed". `played`/`paused` still
are, and a non-media completion (a questionnaire, a component) is untouched."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


class MediaCompletedIsNotForwardedTests(unittest.IsolatedAsyncioTestCase):
    async def _forward(self, verb: str, media: bool) -> bool:
        """True when the relay got past the media guard (the duplicate check ran)."""
        reached = []
        with (
            patch("app.services.lrs.config.is_enabled", return_value=True),
            patch.object(events, "_is_media_item", return_value=media),
            patch.object(events, "_is_forward_duplicate", side_effect=lambda *a: reached.append(a) or True),
        ):
            await events._forward_to_moe_lrs(
                {"verb": {"id": f"http://adlnet.gov/expapi/verbs/{verb}"}, "object": {"id": "x"}},
                {"cmp": "comp-1"},
                "learner-1",
                {"verb": verb, "launch": "comp-1", "sub_item_id": "clip-1"},
            )
        return bool(reached)

    async def test_a_media_completion_stays_home(self):
        self.assertFalse(await self._forward("completed", media=True))

    async def test_media_played_and_paused_still_go(self):
        self.assertTrue(await self._forward("played", media=True))
        self.assertTrue(await self._forward("paused", media=True))

    async def test_a_questionnaire_completion_still_goes(self):
        self.assertTrue(await self._forward("completed", media=False))


if __name__ == "__main__":
    unittest.main()
