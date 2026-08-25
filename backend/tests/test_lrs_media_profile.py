"""The MoE requires `mediaPosition` on every media event (spec v1.1 removed
`mediaDuration`, so the profile's `length` extension is no longer forwarded).

Kata does not send it, so we cannot invent it. What we CAN do is read the xAPI
Video Profile's own `time` extensions off the relayed statement — the standard
names, in seconds. Any provider that follows the profile then satisfies the
ministry with no code change, and Kata complies the day it starts sending them.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.events import _video_profile_seconds  # noqa: E402

TIME = "https://w3id.org/xapi/video/extensions/time"
TIME_TO = "https://w3id.org/xapi/video/extensions/time-to"
LENGTH = "https://w3id.org/xapi/video/extensions/length"


class VideoProfilePassThrough(unittest.TestCase):
    def test_time_becomes_position_and_length_is_no_longer_sent(self):
        """Spec v1.1 removed `mediaDuration` — `length` must not reach the wire."""
        found = _video_profile_seconds(
            {"result": {"extensions": {TIME: 105}},
             "context": {"extensions": {LENGTH: 120}}}
        )
        self.assertEqual(found, {"mediaPosition": 105})

    def test_either_pool_is_searched(self):
        """Players disagree about whether `time` rides on result or context."""
        self.assertEqual(
            _video_profile_seconds({"context": {"extensions": {TIME: 12}}}),
            {"mediaPosition": 12},
        )
        self.assertEqual(
            _video_profile_seconds({"result": {"extensions": {TIME: 12}}}),
            {"mediaPosition": 12},
        )

    def test_time_to_is_accepted_when_time_is_absent(self):
        found = _video_profile_seconds({"result": {"extensions": {TIME_TO: 44}}})
        self.assertEqual(found, {"mediaPosition": 44})

    def test_position_zero_survives(self):
        """Start-of-clip is a real position; a falsy check would drop it."""
        found = _video_profile_seconds({"result": {"extensions": {TIME: 0}}})
        self.assertEqual(found, {"mediaPosition": 0})

    def test_fractional_seconds_are_kept_but_whole_ones_stay_int(self):
        found = _video_profile_seconds({"result": {"extensions": {TIME: 39.75}}})
        self.assertEqual(found["mediaPosition"], 39.75)
        whole = _video_profile_seconds({"result": {"extensions": {TIME: 40.0}}})
        self.assertEqual(whole["mediaPosition"], 40)
        self.assertIsInstance(whole["mediaPosition"], int)

    def test_a_statement_without_the_profile_yields_nothing(self):
        """Today's Kata statements. Absent beats invented."""
        self.assertEqual(_video_profile_seconds({}), {})
        self.assertEqual(
            _video_profile_seconds({"result": {"extensions": {"other": 3}}}), {}
        )

    def test_junk_values_are_ignored_rather_than_coerced(self):
        for bad in ("105", None, True, -4, [1], {"a": 1}):
            with self.subTest(bad=bad):
                self.assertEqual(
                    _video_profile_seconds({"result": {"extensions": {TIME: bad}}}), {}
                )


if __name__ == "__main__":
    unittest.main()
