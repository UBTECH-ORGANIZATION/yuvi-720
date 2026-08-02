"""The provider's animation ticker must not become learning evidence.

Measured 29/07 while walking `…-01-02`: the content emitted a `played`+`paused`
PAIR roughly once a second for as long as the learner sat on the screen — 182 of
the 600 most recent stored events for a single component visit — every one of
them against the COMPONENT, with no screen id and an entirely null `result`.

That is a decorative animation loop on the provider side, not playback. Storing
it costs writes on every learner, dilutes any count built on `learning_events`,
and a burst on a component that DOES hold a video could walk the item pointer.

The damper keeps the FIRST statement of a burst — so the pointer move and the
"they were on the video" evidence both survive — and only ever fires on a
statement carrying no result payload at all.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import events  # noqa: E402


def _media(verb: str = "played", **overrides) -> dict:
    event = {
        "learner_id": "L",
        "session_id": "s-1",
        "verb": verb,
        "object_id": "https://lomdot/…/methodica-science-mass-measure-01-02",
        "sub_item_id": None,
        "result": {"success": None, "response": None, "score_scaled": None,
                   "duration": None, "completion": None},
    }
    event.update(overrides)
    return event


class MediaTickerDamperTests(unittest.TestCase):
    def setUp(self):
        events._media_last_seen.clear()
        events._media_epoch.clear()

    def test_the_first_of_a_burst_is_kept(self):
        self.assertFalse(events._is_media_ticker_noise(_media()))

    def test_the_repeat_that_follows_is_dropped(self):
        events._is_media_ticker_noise(_media())
        self.assertTrue(events._is_media_ticker_noise(_media()))

    def test_a_whole_ticker_burst_collapses_to_one_stored_event(self):
        kept = sum(0 if events._is_media_ticker_noise(_media()) else 1 for _ in range(91))
        self.assertEqual(kept, 1)

    def test_played_and_paused_are_damped_independently(self):
        """A play/pause PAIR is what the ticker emits; each keeps its own first."""
        self.assertFalse(events._is_media_ticker_noise(_media("played")))
        self.assertFalse(events._is_media_ticker_noise(_media("paused")))

    def test_a_real_play_with_a_duration_is_never_dropped(self):
        played = _media(result={"success": None, "response": None,
                                "score_scaled": None, "duration": 12.5, "completion": None})
        events._is_media_ticker_noise(played)
        self.assertFalse(events._is_media_ticker_noise(played))

    def test_a_play_that_reports_completion_is_never_dropped(self):
        played = _media(result={"success": None, "response": None,
                                "score_scaled": None, "duration": None, "completion": True})
        events._is_media_ticker_noise(played)
        self.assertFalse(events._is_media_ticker_noise(played))

    def test_a_different_screen_is_its_own_signal(self):
        events._is_media_ticker_noise(_media(sub_item_id="…-02-001"))
        self.assertFalse(events._is_media_ticker_noise(_media(sub_item_id="…-02-003")))

    def test_a_different_session_is_its_own_signal(self):
        events._is_media_ticker_noise(_media())
        self.assertFalse(events._is_media_ticker_noise(_media(session_id="s-2")))

    def test_a_scoring_verb_is_never_treated_as_media_noise(self):
        answered = _media("answered")
        events._is_media_ticker_noise(answered)
        self.assertFalse(events._is_media_ticker_noise(answered))

    def test_playback_after_the_learner_navigates_is_new_information(self):
        """Kata often announces a video screen ONLY by playing it. Suppressing
        the `played` that follows an `enter` would strand the learner on the
        question they just left (test-lesson-navigation A3b)."""
        events._is_media_ticker_noise(_media("played"))
        self.assertTrue(events._is_media_ticker_noise(_media("played")))
        events._is_media_ticker_noise(_media("enter", sub_item_id="…-02-002"))
        self.assertFalse(events._is_media_ticker_noise(_media("played")))

    def test_an_answer_also_re_arms_playback(self):
        events._is_media_ticker_noise(_media("played"))
        events._is_media_ticker_noise(_media("answered"))
        self.assertFalse(events._is_media_ticker_noise(_media("played")))

    def test_one_learner_acting_does_not_re_arm_another(self):
        events._is_media_ticker_noise(_media("played", learner_id="A"))
        events._is_media_ticker_noise(_media("enter", learner_id="B"))
        self.assertTrue(events._is_media_ticker_noise(_media("played", learner_id="A")))

    def test_the_burst_memory_stays_bounded(self):
        for index in range(events._MEDIA_NOISE_MEMORY_LIMIT * 2):
            events._is_media_ticker_noise(_media(session_id=f"s-{index}"))
        self.assertLessEqual(len(events._media_last_seen), events._MEDIA_NOISE_MEMORY_LIMIT)


if __name__ == "__main__":
    unittest.main()
