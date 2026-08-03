"""Which provider players may be rendered inside the lesson frame.

Measured 2026-08-02, with a bare ``<iframe>`` and no platform code involved:

* ``lomdot.education.gov.il`` (methodica, static lomda) — **1 document load**,
  stable. This is the content the ministry review runs on, and nothing here may
  change how it behaves.
* ``learning.cet.ac.il`` (CET's player SPA) — **30 document loads in 20s**. It
  finds no CET SSO session (720 learners authenticate against the platform,
  never against CET), redirects ``auth.cet.ac.il/v2/logout`` →
  ``apigateway.cet.ac.il/AccessMngApi/logout/timeout`` → back to itself, and
  repeats every ~2.5s. Its session cookies are ``SameSite=Lax``, so they can
  never reach a cross-site frame; the bounce also drops the ``slxapi`` query
  parameter, losing the launch context. Identical with and without our sandbox
  attribute; top-level it loads exactly once.

So the frame is a rendering decision, taken per player host and overridable by
configuration — never a judgement about the content itself.
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

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

    def test_the_cet_player_is_not_framed(self):
        self.assertFalse(learning_sessions.is_embeddable(CET_PLAYER))

    def test_a_provider_nobody_has_met_is_framed(self):
        """The default is trust. An unknown host gets the frame; the client's own
        reload-storm detector is what catches a bad one without a deploy."""
        self.assertTrue(learning_sessions.is_embeddable("https://content.example.org/act/1"))

    def test_the_list_is_configuration_not_code(self):
        """The day CET authenticates the player from the launch registration, the
        fix is an env var and a redeploy — not a patch."""
        with patch.dict(os.environ, {"NON_EMBEDDABLE_PLAYER_HOSTS": ""}):
            self.assertTrue(learning_sessions.is_embeddable(CET_PLAYER))
        with patch.dict(os.environ, {"NON_EMBEDDABLE_PLAYER_HOSTS": "lomdot.education.gov.il"}):
            self.assertFalse(learning_sessions.is_embeddable(METHODICA))
            self.assertTrue(learning_sessions.is_embeddable(CET_PLAYER))

    def test_the_host_is_matched_whole_and_case_insensitively(self):
        """Substring matching would catch `notlearning.cet.ac.il.evil.example`,
        and a host is case-insensitive by definition."""
        self.assertFalse(learning_sessions.is_embeddable("https://LEARNING.CET.AC.IL/player/x"))
        self.assertTrue(learning_sessions.is_embeddable("https://learning.cet.ac.il.example.com/x"))
        self.assertTrue(learning_sessions.is_embeddable("https://sub.learning.cet.ac.il/x"))

    def test_a_missing_or_odd_url_never_raises(self):
        """A launch we cannot parse still has to render something."""
        self.assertTrue(learning_sessions.is_embeddable(""))
        self.assertTrue(learning_sessions.is_embeddable("not-a-url"))


if __name__ == "__main__":
    unittest.main()
