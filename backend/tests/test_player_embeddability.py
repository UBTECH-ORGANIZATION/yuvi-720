"""Which provider players may be rendered inside the lesson frame.

History, because the default here has flipped once already:

* Measured 2026-08-02 with a bare ``<iframe>``: ``learning.cet.ac.il`` (CET's
  player SPA) reload-looped — no SSO session in a cross-site frame, 30 document
  loads in 20s through ``auth.cet.ac.il/v2/logout``. It was blocklisted.
* Re-measured 2026-08-23: the player now authenticates from the launch context
  itself (``POST /api/authentication/content-session`` succeeds inside a
  frame), renders, grades, persists state, and its relayed events arrived in
  our LRS from a framed run. The blocklist default is empty again.

So the frame is a rendering decision, taken per player host and overridable by
configuration — never a judgement about the content itself. The client-side
reload-storm detector (`embedGuard`) is the standing safety net for any
provider that regresses.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import learning_sessions  # noqa: E402

METHODICA = (
    "https://lomdot.education.gov.il/metodica/720active/science/mass-measure/01/"
    "methodica-science-mass-measure-01-01/index.html?slxapi=%7B%7D&registration=r1"
)
CET_PLAYER = (
    "https://learning.cet.ac.il/player/learning-activity/6a5cd81c15692669432e4e5d"
    "?slxapi=%7B%7D&registration=r1&component=CET.MATH.G7.NUM.COORD-SYS-A.POS-NUM.WRITE-00001"
)


class EmbeddabilityTests(unittest.TestCase):
    def test_the_science_lomda_is_framed_exactly_as_before(self):
        self.assertTrue(learning_sessions.is_embeddable(METHODICA))

    def test_the_cet_player_is_framed_since_content_session_auth(self):
        """The day the 2026-08-02 comment promised arrived on 2026-08-23: CET
        authenticates the framed player from the launch context, so it gets the
        frame like everyone else."""
        self.assertTrue(learning_sessions.is_embeddable(CET_PLAYER))

    def test_a_provider_nobody_has_met_is_framed(self):
        """The default is trust. An unknown host gets the frame; the client's own
        reload-storm detector is what catches a bad one without a deploy."""
        self.assertTrue(learning_sessions.is_embeddable("https://content.example.org/act/1"))

    def test_the_list_is_configuration_not_code(self):
        """Re-blocking a regressed provider is an env var and a redeploy — not
        a patch."""
        with patch.dict(os.environ, {"NON_EMBEDDABLE_PLAYER_HOSTS": "learning.cet.ac.il"}):
            self.assertFalse(learning_sessions.is_embeddable(CET_PLAYER))
            self.assertTrue(learning_sessions.is_embeddable(METHODICA))
        with patch.dict(os.environ, {"NON_EMBEDDABLE_PLAYER_HOSTS": "lomdot.education.gov.il"}):
            self.assertFalse(learning_sessions.is_embeddable(METHODICA))
            self.assertTrue(learning_sessions.is_embeddable(CET_PLAYER))

    def test_the_host_is_matched_whole_and_case_insensitively(self):
        """Substring matching would catch `notlearning.cet.ac.il.evil.example`,
        and a host is case-insensitive by definition."""
        with patch.dict(os.environ, {"NON_EMBEDDABLE_PLAYER_HOSTS": "learning.cet.ac.il"}):
            self.assertFalse(learning_sessions.is_embeddable("https://LEARNING.CET.AC.IL/player/x"))
            self.assertTrue(learning_sessions.is_embeddable("https://learning.cet.ac.il.example.com/x"))
            self.assertTrue(learning_sessions.is_embeddable("https://sub.learning.cet.ac.il/x"))

    def test_a_missing_or_odd_url_never_raises(self):
        """A launch we cannot parse still has to render something."""
        self.assertTrue(learning_sessions.is_embeddable(""))
        self.assertTrue(learning_sessions.is_embeddable("not-a-url"))


class TeacherPreviewTests(unittest.IsolatedAsyncioTestCase):
    """The teacher preview is content-only: whatever it launches must be unable
    to write a statement, and Kata must never mistake it for a learner."""

    async def test_the_preview_launch_tracks_nothing_and_is_cached(self):
        learning_sessions._preview_cache.clear()
        launcher = AsyncMock(return_value={
            "launch_url": CET_PLAYER, "registration_id": "r-preview",
        })
        with patch.object(learning_sessions.kata_client, "resolve_component",
                          AsyncMock(return_value=(
                              {"id": "u1", "title": "unit"},
                              {"id": "cmp-1", "title": "lomda"},
                          ))), \
             patch.object(learning_sessions.kata_client, "create_launch_context",
                          launcher), \
             patch.dict(os.environ, {"PUBLIC_APP_URL": "https://spark.example"}):
            view = await learning_sessions.create_preview_launch(
                "gal", "cmp-1", request_base_url="http://localhost:8720/")
            again = await learning_sessions.create_preview_launch(
                "gal", "cmp-1", request_base_url="http://localhost:8720/")

        kwargs = launcher.await_args.kwargs
        # The sink: `preview` is not a mintable launch token, so the ingest
        # 401s every statement — nothing reaches the Brain or the LRS.
        self.assertEqual(kwargs["lrs_endpoint"], "https://spark.example/api/xapi/preview/")
        self.assertEqual(kwargs["lrs_auth"], "Basic preview")
        # A pseudonym Kata's own records can't confuse with a learner working.
        self.assertTrue(kwargs["student_id"].startswith("preview-"))
        self.assertEqual(view["title"], "lomda")
        self.assertIn("player_url", view)
        # Second open within the TTL: no second registration minted.
        self.assertEqual(launcher.await_count, 1)
        self.assertEqual(again, view)
        learning_sessions._preview_cache.clear()


if __name__ == "__main__":
    unittest.main()
