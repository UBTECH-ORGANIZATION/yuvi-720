"""A component is a sequence of פריטים — and only some of them ask a question.

Per the 720 content spec a פריט is "יחידת אינטראקציה שניתן לתעד אותה כאירוע אחד":
a video, a reading, a simulation, or a set of questions. Yuvi's arrival turn was
wired to `question_intro`, which is gated SILENT when no question resolves — so a
video or summary screen produced no message, and therefore no thread in the chat
at all. These tests pin the screen-kind spine that fixes it, measured against the
real Kata catalog shapes:

    …-01-01-003  mediaFormat "video"      + 1 question  → still a question screen
    …-01-04-006  mediaFormat "video"      + 0 questions → a watch screen
    …-01-05-001  interactive-content      + 4 questions → one screen, 4 numbers
"""

from __future__ import annotations

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import kata_catalog, kata_client  # noqa: E402


COMPONENT = "methodica-science-mass-measure-01-04"
RAW = {
    "id": COMPONENT,
    "subContent": [
        {
            "id": f"{COMPONENT}-001",
            "title": "מתקדם 1: חישוב מסה עקיפה של נוזל",
            "contentType": "simulation",
            "mediaFormat": "interactive-content",
            "informationToBot": "…",
            "questions": [{"questionId": "q1", "questionText": "כמה?"}],
        },
        {
            "id": f"{COMPONENT}-006",
            "title": "פריט העשרה: הקשר בין מדידה מדויקת וצדק",
            "contentType": "motivational",
            "mediaFormat": "video",
            "informationToBot": "פריט העשרה…",
            "questions": [],
        },
        {
            # A reading screen with no bot notes at all — invisible to the old
            # `information_by_item` scan, which is exactly why the spine exists.
            "id": f"{COMPONENT}-007",
            "title": "סיכום",
            "contentType": "summary",
            "mediaFormat": "text",
            "questions": [],
        },
    ],
}


class ItemSpineTests(unittest.TestCase):
    def setUp(self):
        component = kata_client.normalize_component(RAW)
        p = mock.patch.object(kata_catalog, "get_component", return_value=component)
        p.start()
        self.addCleanup(p.stop)

    def test_every_screen_is_carried_in_learner_order(self):
        ids = [row["id"] for row in kata_catalog.item_profiles(COMPONENT)]
        self.assertEqual(
            ids, [f"{COMPONENT}-001", f"{COMPONENT}-006", f"{COMPONENT}-007"]
        )

    def test_a_screen_that_asks_is_a_question_screen(self):
        self.assertEqual(kata_catalog.item_kind(COMPONENT, f"{COMPONENT}-001"), "question")

    def test_a_video_with_no_question_is_a_watch_screen(self):
        self.assertEqual(kata_catalog.item_kind(COMPONENT, f"{COMPONENT}-006"), "watch")

    def test_a_text_screen_is_a_read_screen(self):
        self.assertEqual(kata_catalog.item_kind(COMPONENT, f"{COMPONENT}-007"), "read")

    def test_a_screen_with_no_notes_is_still_found_as_teaching(self):
        """The old scan only saw screens carrying `informationToBot`."""
        self.assertEqual(
            kata_catalog.non_question_items(COMPONENT),
            [f"{COMPONENT}-006", f"{COMPONENT}-007"],
        )

    def test_teaching_screens_take_no_question_number(self):
        ordinals = kata_catalog.question_item_ordinals(COMPONENT)
        self.assertEqual(ordinals[f"{COMPONENT}-001|q1"], 1)
        self.assertNotIn(f"{COMPONENT}-006", ordinals)
        self.assertNotIn(f"{COMPONENT}-007", ordinals)

    def test_the_media_format_survives_for_the_coach(self):
        profile = kata_catalog.item_profile(COMPONENT, f"{COMPONENT}-006")
        self.assertEqual(profile["media_format"], "video")
        self.assertEqual(profile["content_type"], "motivational")
        self.assertEqual(profile["kind"], "watch")

    def test_unknown_screen_has_no_kind(self):
        self.assertEqual(kata_catalog.item_kind(COMPONENT, "nope"), "")
        self.assertEqual(kata_catalog.item_profile(COMPONENT, "nope"), {})


class VideoQuestionScreenTests(unittest.TestCase):
    """`…-01-01-003` plays a video AND asks — the learner is WATCHING it.

    Kata's own title says it: "הקנייה: איך מודדים נכון (פלייליסט - סרטון/קלפים)".
    The question appears inside the clip, so captioning the thread "שאלה 3" while
    the video is still playing names something the learner has not reached. The
    screen is a video; that it also asks is `question_count`, which is what gates
    the hint/explanation buttons.
    """

    def setUp(self):
        component = kata_client.normalize_component({
            "id": "c",
            "subContent": [{
                "id": "c-003",
                "title": "הקנייה: איך מודדים נכון",
                "contentType": "instruction",
                "mediaFormat": "video",
                "questions": [{"questionId": "q1"}],
            }],
        })
        p = mock.patch.object(kata_catalog, "get_component", return_value=component)
        p.start()
        self.addCleanup(p.stop)

    def test_it_is_a_watch_screen(self):
        self.assertEqual(kata_catalog.item_kind("c", "c-003"), "watch")

    def test_but_it_still_counts_as_asking(self):
        """`question_count` is what the buttons and the numbering read."""
        profile = kata_catalog.item_profile("c", "c-003")
        self.assertEqual(profile["question_count"], 1)
        self.assertEqual(profile["media_format"], "video")
        self.assertEqual(kata_catalog.non_question_items("c"), [])


class LegacySnapshotTests(unittest.TestCase):
    """Snapshots taken before the spine existed must still answer."""

    SNAPSHOT = {
        "id": "old",
        "questions_by_item": {"old-001": [{"questionId": "q1"}]},
        "information_by_item": {"old-001": "…", "old-002": "teaching", "q1": "…"},
    }

    def setUp(self):
        p = mock.patch.object(kata_catalog, "get_component", return_value=self.SNAPSHOT)
        p.start()
        self.addCleanup(p.stop)

    def test_kinds_are_derived_from_what_is_there(self):
        self.assertEqual(kata_catalog.item_kind("old", "old-001"), "question")
        # No mediaFormat to go on — a teaching screen of unknown medium.
        self.assertEqual(kata_catalog.item_kind("old", "old-002"), "step")

    def test_teaching_screens_are_still_listed(self):
        self.assertEqual(kata_catalog.non_question_items("old"), ["old-002"])


if __name__ == "__main__":
    unittest.main()
