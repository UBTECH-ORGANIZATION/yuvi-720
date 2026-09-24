"""The tall-frame experiment is off unless both the flag AND the host say so."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.routes import agent as routes  # noqa: E402
from app.services import content_intelligence  # noqa: E402

LAYOUTS = {"player_host": "content.cet.ac.il",
           "items": {"i1": {"kind": "height_independent", "natural_h": [[1024, 1210]]}}}


def _call(env):
    with mock.patch.object(content_intelligence, "component_layouts", lambda cid: LAYOUTS), \
         mock.patch.dict(os.environ, env, clear=False):
        return asyncio.run(routes.coach_screen_frames(component_id="c", _="learner"))


class TheGate(unittest.TestCase):
    def test_off_by_default_even_with_layouts(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LESSON_TALL_FRAME_ENABLED", None)
            out = _call({})
        self.assertFalse(out["tall_frame"])
        self.assertIn("i1", out["items"])

    def test_the_flag_alone_is_not_enough(self):
        self.assertFalse(_call({"LESSON_TALL_FRAME_ENABLED": "on", "LESSON_TALL_FRAME_HOSTS": ""})["tall_frame"])

    def test_flag_and_allowlisted_host(self):
        out = _call({"LESSON_TALL_FRAME_ENABLED": "on",
                     "LESSON_TALL_FRAME_HOSTS": "content.cet.ac.il, other.host"})
        self.assertTrue(out["tall_frame"])


if __name__ == "__main__":
    unittest.main()


class TheHostReport(unittest.TestCase):
    def _shard(self, host, layouts):
        return {"lomdot": [{"extraction": {"player_host": host}, "slides": [
            {"enrichment": {"capture_version": 8, "layout": layout}} for layout in layouts]}]}

    def test_a_host_qualifies_only_on_clean_tall_probes(self):
        from scripts import tall_frame_report as report
        good = {"kind": "height_independent", "natural_h": [[1024, 1200]],
                "tall": [{"w": 1024, "h": 1240, "same_geometry": True, "inner_scroll": False}]}
        bad = {**good, "tall": [{"w": 1024, "h": 1240, "same_geometry": False, "inner_scroll": False}]}
        fit = {"kind": "fit_viewport", "natural_h": None, "tall": []}
        out = report.host_report([self._shard("cet", [good] * 10),
                                  self._shard("methodica", [fit] * 12),
                                  self._shard("mixed", [good] * 9 + [bad])], min_screens=10)
        self.assertTrue(out["cet"]["qualifies"])
        self.assertFalse(out["methodica"]["qualifies"])
        self.assertFalse(out["mixed"]["qualifies"])
