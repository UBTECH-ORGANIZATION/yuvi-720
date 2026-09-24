"""Capture v8: from walked atoms to the public object catalog, and which
screen may speak for which slide.

Fixtures mirror what the walker recorded on real lomdot on 2026-09-24
(methodica mass-measure-02-01 and CET PLOT-00001), trimmed to the shapes the
rules care about.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import content_intelligence as ci  # noqa: E402
from scripts import content_objects as co  # noqa: E402

GRID = [[820, 640, 820, 547], [1280, 860, 1280, 785]]


def _sample(w, h, rects):
    cw, ch = next((row[2], row[3]) for row in GRID if row[0] == w and row[1] == h)
    return {"w": w, "h": h, "content_w": cw, "content_h": ch, "rects": rects}


def _rect(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def _treasure_screen(option_texts=("מסת התיבה בלבד", "מסת האוצר בלבד",
                                   "נפח התיבה", "גודל התיבה")) -> dict:
    """The treasure-chest question: 4 answer rows, a photo, a title, the
    question text, and the card that wraps them all."""
    atoms = [
        {"n": i + 1, "kind": "option", "text": t, "parent": 6, "order": i + 1,
         "interactive": True}
        for i, t in enumerate(option_texts)
    ] + [
        {"n": 5, "kind": "image", "text": "", "parent": 6, "order": 5,
         "src_digest": "sha1:32fe1e322deea7ae", "rect": _rect(49, 223, 362, 362)},
        {"n": 6, "kind": "text", "tag": "div", "parent": None, "order": 0,
         "text": "מצאו את האוצר! לפניכם שתי תיבות. המסה של כל אחת מהן היא 10 ק\"ג"},
        {"n": 7, "kind": "text", "tag": "h2", "parent": 6, "order": 6,
         "text": "מצאו את האוצר!"},
        {"n": 8, "kind": "text", "tag": "p", "parent": 6, "order": 7,
         "text": "לפניכם שתי תיבות. המסה של כל אחת מהן היא 10 ק\"ג. באחת מהן "
                 "מסתתר אוצר, והשנייה ריקה. איזה מידע נוסף יעזור לכם לגלות "
                 "באיזו תיבה נמצא האוצר?"},
        {"n": 9, "kind": "text", "tag": "button", "parent": None, "order": 8,
         "text": "צדקתי?"},
    ]
    big = {str(i + 1): _rect(636, 398 + 68 * i, 604, 56) for i in range(4)}
    small = {str(i + 1): _rect(407, 300 + 44 * i, 387, 36) for i in range(4)}
    for rects, scale in ((big, 1.0), (small, 0.64)):
        rects["5"] = _rect(49 * scale, 223 * scale, 362 * scale, 362 * scale)
        rects["6"] = _rect(40 * scale, 214 * scale, 1200 * scale, 444 * scale)
        rects["7"] = _rect(448 * scale, 214 * scale, 792 * scale, 32 * scale)
        rects["8"] = _rect(448 * scale, 246 * scale, 792 * scale, 128 * scale)
        rects["9"] = _rect(34 * scale, 732 * scale, 140 * scale, 38 * scale)
    return {
        "index": 1, "title": "מצאו את האוצר!",
        "visible_text": "מצאו את האוצר! לפניכם שתי תיבות. המסה של כל אחת מהן היא "
                        "10 ק\"ג. באחת מהן מסתתר אוצר, והשנייה ריקה. איזה מידע "
                        "נוסף יעזור לכם לגלות באיזו תיבה נמצא האוצר? "
                        + " ".join(option_texts),
        "grid": GRID, "atoms": atoms,
        "object_samples": [_sample(820, 640, small), _sample(1280, 860, big)],
    }


TREASURE_SLIDE = {
    "item_id": "mm-02-01-001", "title": "מציאת האוצר", "role": "question",
    "position": 1, "fingerprint": "f1",
    "questions": [{
        "question_id": "q1",
        "question_text": "לפניכם שתי תיבות. המסה של כל אחת מהן היא 10 ק\"ג. באחת "
                         "מהן מסתתר אוצר, והשנייה ריקה. איזה מידע נוסף יעזור "
                         "לכם לגלות באיזו תיבה נמצא האוצר?",
        # catalog order differs from screen order on purpose
        "answers": ["נפח התיבה", "מסת התיבה בלבד", "מסת האוצר בלבד", "גודל התיבה"],
        "correct": ["מסת התיבה בלבד"],
    }],
}


class AtomsBecomeObjects(unittest.TestCase):
    def setUp(self):
        self.objects, self.rejections = co.build_objects(
            _treasure_screen(), TREASURE_SLIDE)
        self.by_id = {o["id"]: o for o in self.objects}

    def test_the_question_text_is_the_tight_block_not_the_card(self):
        stem = self.by_id["stem:q1"]
        self.assertEqual(stem["r"][1], [448, 246, 792, 128])
        self.assertIn({"atom": "6", "kind": "text", "reason": "container"},
                      self.rejections)

    def test_options_carry_the_catalog_index_whatever_the_screen_order(self):
        """Row 1 on screen is catalog answer 1 ('מסת התיבה בלבד'); the index
        must follow the TEXT, never the position — a wrong index marks the
        wrong answer."""
        options = [o for o in self.objects if o["kind"] == "option"]
        self.assertEqual([(o["label_he"], o["option_index"]) for o in options],
                         [("אפשרות 1", 1), ("אפשרות 2", 2),
                          ("אפשרות 3", 0), ("אפשרות 4", 3)])
        self.assertTrue(all(o["parent"] == "opts:q1" for o in options))
        self.assertEqual(self.by_id["opts:q1"]["r"][1], [636, 398, 604, 260])

    def test_an_uncertain_match_leaves_the_index_out(self):
        objects, _ = co.build_objects(
            _treasure_screen(option_texts=("א", "ב", "ג", "ד")), TREASURE_SLIDE)
        options = [o for o in objects if o["kind"] == "option"]
        self.assertTrue(options)
        self.assertTrue(all("option_index" not in o for o in options))

    def test_controls_are_not_content(self):
        self.assertIn({"atom": "9", "kind": "text", "reason": "control or chrome"},
                      self.rejections)

    def test_the_title_is_labelled_as_a_title(self):
        title = next(o for o in self.objects if o["kind"] == "text")
        self.assertEqual(title["label_he"], "הכותרת")

    def test_every_object_passes_the_runtime_validator(self):
        enrichment = {"capture_version": 8, "grid": GRID, "objects": self.objects}
        self.assertEqual(ci.validate_objects(enrichment), [])

    def test_no_object_carries_vendor_text_or_answers(self):
        blob = repr(self.objects)
        for text in ("מסת התיבה בלבד", "לפניכם", "correct"):
            self.assertNotIn(text, blob)

    def test_a_label_that_names_the_answer_falls_back_to_the_template(self):
        objects, _ = co.build_objects(
            _treasure_screen(), TREASURE_SLIDE,
            graphic_labels={"sha1:32fe1e322deea7ae": "מסת התיבה בלבד"})
        image = next(o for o in objects if o["kind"] == "image")
        self.assertEqual(image["label_he"], "התמונה")

    def test_a_safe_vision_label_is_used(self):
        objects, _ = co.build_objects(
            _treasure_screen(), TREASURE_SLIDE,
            graphic_labels={"sha1:32fe1e322deea7ae": "מאזניים עם שתי תיבות"})
        image = next(o for o in objects if o["kind"] == "image")
        self.assertEqual(image["label_he"], "מאזניים עם שתי תיבות")


class DecorationIsCountedPerDistinctScreen(unittest.TestCase):
    def test_a_question_captured_three_times_keeps_its_photo(self):
        """Clean + two feedback states of one question are ONE screen."""
        screens = [_treasure_screen() for _ in range(3)]
        self.assertEqual(co.decorative_image_digests(screens), frozenset())

    def test_a_small_image_on_every_distinct_screen_is_furniture(self):
        screens = []
        for i in range(4):
            screen = {"visible_text": f"מסך שונה לגמרי מספר {i} עם תוכן חדש {i * 7}",
                      "atoms": [{"n": 1, "kind": "image", "src_digest": "sha1:mascot",
                                 "rect": _rect(10, 10, 90, 90)}]}
            screens.append(screen)
        self.assertEqual(co.decorative_image_digests(screens), frozenset({"sha1:mascot"}))


class OnlyVerifiedScreensSpeakForSlides(unittest.TestCase):
    def test_a_screen_showing_the_question_is_assigned_by_text(self):
        assigned = co.assign_screens([_treasure_screen()], [TREASURE_SLIDE], lambda s: "")
        self.assertEqual(assigned["mm-02-01-001"]["method"], "text")

    def test_a_stuck_walk_duplicate_is_refused_for_the_next_slide(self):
        """A gated page captured twice must not be given to the NEXT slide
        (v7 did that positionally: ~7 of 16 captures sat on the wrong slide)."""
        second = dict(TREASURE_SLIDE, item_id="mm-02-01-002", position=2)
        assigned = co.assign_screens(
            [_treasure_screen(), _treasure_screen()], [TREASURE_SLIDE, second],
            lambda s: "")
        self.assertIn("mm-02-01-001", assigned)
        self.assertNotIn("mm-02-01-002", assigned)

    def test_the_players_page_id_wins(self):
        screen = dict(_treasure_screen(), visible_text="כיתוב אחר לגמרי")
        slide = dict(TREASURE_SLIDE, item_id="mptti9na1c802zgwy")
        assigned = co.assign_screens([screen], [slide], lambda s: "mptti9na1c802zgwy")
        self.assertEqual(assigned["mptti9na1c802zgwy"]["method"], "page_id")

    def test_a_video_slide_between_verified_neighbours_takes_the_screen_between(self):
        video = {"item_id": "v", "title": "סרטון", "role": "video", "position": 2,
                 "questions": []}
        after = dict(TREASURE_SLIDE, item_id="after", position=3,
                     questions=[dict(TREASURE_SLIDE["questions"][0],
                                     question_text="מה קורה למסה כשמוסיפים מים לכוס "
                                                   "שעומדת על המאזניים בכיתה")])
        middle = {"index": 2, "visible_text": "סרטון קצר", "media": [{"kind": "video"}]}
        last = {"index": 3, "visible_text": "מה קורה למסה כשמוסיפים מים לכוס שעומדת "
                                            "על המאזניים בכיתה"}
        assigned = co.assign_screens(
            [_treasure_screen(), middle, last], [TREASURE_SLIDE, video, after],
            lambda s: "")
        self.assertEqual(assigned["v"]["method"], "sandwich")
        self.assertIs(assigned["v"]["screen"], middle)


class WorkSurvivesKataRenames(unittest.TestCase):
    OLD = [{"item_id": "CET-item-00001", "fingerprint": "fa", "position": 1,
            "enrichment": {"vendor_page_id": "mnew1"}},
           {"item_id": "CET-item-00002", "fingerprint": "fb", "position": 2,
            "enrichment": {"vendor_page_id": "somewhere-else"}}]

    def test_a_renamed_slide_keeps_its_texts_and_matching_capture(self):
        new = [{"item_id": "mnew1", "fingerprint": "fa", "position": 1},
               {"item_id": "mnew2", "fingerprint": "fb", "position": 2}]
        matched = co.match_prior_slides(new, self.OLD)
        self.assertEqual(matched["mnew1"][0]["item_id"], "CET-item-00001")
        self.assertTrue(matched["mnew1"][1])
        # its old capture named a different page: texts carry, capture does not
        self.assertEqual(matched["mnew2"][0]["item_id"], "CET-item-00002")
        self.assertFalse(matched["mnew2"][1])

    def test_ambiguous_fingerprints_need_the_same_position(self):
        old = [{"item_id": "a", "fingerprint": "same", "position": 1},
               {"item_id": "b", "fingerprint": "same", "position": 2}]
        new = [{"item_id": "x", "fingerprint": "same", "position": 2}]
        self.assertEqual(co.match_prior_slides(new, old)["x"][0]["item_id"], "b")

    def test_matching_is_one_to_one(self):
        old = [{"item_id": "a", "fingerprint": "same", "position": 1}]
        new = [{"item_id": "x", "fingerprint": "same", "position": 1},
               {"item_id": "y", "fingerprint": "same", "position": 1}]
        matched = co.match_prior_slides(new, old)
        self.assertEqual(len(matched), 1)


class CommittedCapturesAreReverified(unittest.TestCase):
    def test_a_capture_that_does_not_show_its_slide_is_dropped(self):
        ok, reason = co.reverify_capture(
            TREASURE_SLIDE, {"visible_text": "פתיחה: מי תלווה אותנו בלמידה? בחרו דמות"})
        self.assertFalse(ok)
        self.assertIn("does not show", reason)

    def test_a_capture_that_shows_its_slide_stays(self):
        ok, _ = co.reverify_capture(TREASURE_SLIDE,
                                    {"visible_text": _treasure_screen()["visible_text"]})
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
