"""A deck that can actually show something.

Three failures are pinned here, all of them silent, and all three the reason a
Yuvi presentation had never displayed a single picture to anyone:

* the renderer read four field names (`kind`, `url`, `video_url`, `image_url`)
  that `render_visual` does not produce, so every diagram was dropped on arrival;
* it was reachable from one branch of the layout switch, so `compare`, `fact`
  and `timeline` could not have shown one even with the right payload;
* and `normalize_slide` copied `visual.hint` and not the rendered `visual`, so a
  teacher fixing a typo threw away the artwork of the whole deck.

The first two are the frontend's (`tests/slide-deck.test.ts`). The third, the
vocabulary the new layouts speak, and the two things a slide may never carry to
a child are here.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.tasks import attempts, generate, spec


RENDERED = {
    "id": "visual-abc",
    "type": "scene",
    "mime_type": "image/svg+xml",
    "data_url": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "title": "משולש ישר זווית",
    "alt": "משולש עם ניצבים 3 ו-4",
    "caption": "",
    "renderer": "mafs",
    "scene": {"use_visual": True, "elements": []},
}


class ARenderedDiagramSurvivesAnEdit(unittest.TestCase):
    """The expensive half is the drawing. It is not thrown away for a typo."""

    def test_it_comes_back_out_of_normalization(self):
        slide = spec.normalize_slide(
            {"layout": "text", "title": "משולשים", "body": "שלושה צלעות",
             "visual": RENDERED}, 0)
        assert slide is not None
        self.assertEqual(slide["visual"], RENDERED)

    def test_a_drawn_slide_is_not_queued_to_be_drawn_again(self):
        slide = spec.normalize_slide(
            {"layout": "text", "body": "טקסט", "visual_hint": "a triangle",
             "visual": RENDERED}, 0)
        assert slide is not None
        self.assertNotIn("visual_hint", slide)

    def test_a_hint_with_no_render_yet_still_asks_for_one(self):
        slide = spec.normalize_slide(
            {"layout": "text", "body": "טקסט", "visual_hint": "a number line 0-10"}, 0)
        assert slide is not None
        self.assertEqual(slide["visual_hint"], "a number line 0-10")
        self.assertNotIn("visual", slide)

    def test_the_models_idea_of_a_visual_is_not_a_rendered_one(self):
        # `{"visual": {"hint": …}}` is a shape the model emits. Storing it as a
        # rendered payload would put an empty box on the slide forever.
        for pretender in ({"hint": "draw a cell"},
                          {"type": "scene", "data_url": "https://example.com/x.svg"},
                          {"data_url": "data:image/svg+xml;base64,AAA"}):
            slide = spec.normalize_slide(
                {"layout": "text", "body": "טקסט", "visual": pretender}, 0)
            assert slide is not None
            self.assertNotIn("visual", slide, pretender)


class TheLayoutsAddedWithTheStage(unittest.TestCase):

    def test_a_grid_of_tiles_normalizes(self):
        slide = spec.normalize_slide({
            "layout": "fact_grid", "title": "שלושה מצבי צבירה",
            "cards": [{"emoji": "🧊", "front": "מוצק", "back": "צורה קבועה"},
                      {"emoji": "💧", "front": "נוזל", "back": "לוקח צורה"},
                      {"front": "גז", "back": "מתפזר"}],
        }, 0)
        assert slide is not None
        self.assertEqual(len(slide["cards"]), 3)
        self.assertEqual(slide["cards"][0]["emoji"], "🧊")
        self.assertNotIn("emoji", slide["cards"][2])

    def test_a_sentence_is_not_an_emoji(self):
        # Asked for an emoji, a model sometimes writes a phrase — and a phrase
        # in a 34px slot is a broken tile.
        slide = spec.normalize_slide({
            "layout": "fact_grid",
            "cards": [{"emoji": "קרח שנמס", "front": "א", "back": "ב"},
                      {"front": "ג", "back": "ד"}],
        }, 0)
        assert slide is not None
        self.assertNotIn("emoji", slide["cards"][0])

    def test_a_reveal_needs_something_to_reveal(self):
        self.assertIsNone(spec.normalize_slide(
            {"layout": "reveal", "title": "בדקו את עצמכם",
             "cards": [{"front": "מסה", "back": "כמה חומר"}]}, 0))

    def test_a_quote_is_its_body(self):
        self.assertIsNone(spec.normalize_slide({"layout": "quote", "title": "כלל"}, 0))
        slide = spec.normalize_slide({"layout": "quote", "body": "אנרגיה לא נעלמת"}, 0)
        assert slide is not None
        self.assertEqual(slide["layout"], "quote")

    def test_three_figures_on_one_slide(self):
        slide = spec.normalize_slide({
            "layout": "big_number",
            "values": [{"value": "3", "caption": "נכונות"},
                       {"value": "4", "caption": "סה\"כ"}],
        }, 0)
        assert slide is not None
        self.assertEqual([entry["value"] for entry in slide["values"]], ["3", "4"])
        # The single-figure field is still filled, so anything reading `value`
        # keeps working on a multi-figure slide.
        self.assertEqual(slide["value"], "3")

    def test_the_old_names_for_the_new_layouts_still_land(self):
        for alias, layout in (("click_reveal", "reveal"), ("flashcards", "reveal"),
                              ("fact-grid", "fact_grid"), ("tiles", "fact_grid"),
                              ("quotation", "quote")):
            slide = spec.normalize_slide(
                {"layout": alias, "body": "טקסט",
                 "cards": [{"front": "א", "back": "ב"}, {"front": "ג", "back": "ד"}]}, 0)
            assert slide is not None, alias
            self.assertEqual(slide["layout"], layout, alias)

    def test_a_layout_nobody_has_built_still_renders_as_text(self):
        slide = spec.normalize_slide({"layout": "carousel_3d", "body": "טקסט"}, 0)
        assert slide is not None
        self.assertEqual(slide["layout"], "text")


class WhatASlideMayNotCarry(unittest.TestCase):

    def test_only_our_own_illustrations_may_be_shown(self):
        # An image URL on a slide is a request from a CHILD's browser to
        # whatever host is named in it. That is not a rendering choice, and it
        # is not the model's to make.
        for hostile in ("https://images.pexels.com/photo.jpg",
                        "//evil.example/x.svg",
                        "/api/learning/illustrations/../../secrets.svg",
                        "javascript:alert(1)",
                        "data:image/svg+xml,<svg onload=alert(1)>"):
            slide = spec.normalize_slide(
                {"layout": "text_image", "body": "טקסט", "image_url": hostile}, 0)
            assert slide is not None
            self.assertEqual(slide.get("image_url", ""), "", hostile)

    def test_the_library_path_is_allowed(self):
        slide = spec.normalize_slide(
            {"layout": "title", "body": "טקסט",
             "image_url": "/api/learning/illustrations/lib-cell.svg"}, 0)
        assert slide is not None
        self.assertEqual(slide["image_url"], "/api/learning/illustrations/lib-cell.svg")

    def test_teacher_notes_never_reach_the_learner(self):
        # Written TO the teacher, ABOUT the class: "most students say the
        # heavier one falls faster — let them say it before you correct it".
        # Not a sentence to leave in a child's page source.
        snapshot = {"presentation": {"slides": [
            {"id": "s1", "layout": "text", "body": [], "notes": "שאלו קודם את הכיתה"},
        ]}}
        stripped = attempts._without_answers(snapshot)
        slide = stripped["presentation"]["slides"][0]
        self.assertNotIn("notes", slide)
        self.assertEqual(slide["id"], "s1")

    def test_the_teachers_own_copy_keeps_them(self):
        slide = spec.normalize_slide(
            {"layout": "text", "body": "טקסט", "notes": "שאלו קודם את הכיתה"}, 0)
        assert slide is not None
        self.assertEqual(slide["notes"], "שאלו קודם את הכיתה")


if __name__ == "__main__":
    unittest.main()


class WhatATeacherCanAskADeckFor(unittest.TestCase):
    """Seven settings, and every one of them has to change the output.

    A control a teacher can move without being able to see what it did is worse
    than no control: it teaches them not to trust the rest of the form either.
    """

    def spec_for(self, **presentation):
        return spec.normalize_spec({
            "title": "זוויות במשולש", "components": ["presentation"],
            "presentation": presentation,
        })["presentation"]

    def test_the_defaults_are_the_deck_a_teacher_expects(self):
        settings = self.spec_for()
        self.assertEqual(settings["theme"], "auto")
        self.assertEqual(settings["density"], "balanced")
        for key in ("examples", "diagrams", "self_check", "teacher_notes"):
            self.assertTrue(settings[key], key)
        # And with everything at its default, the prompt says only the density —
        # a prompt restating six defaults buries the one line that matters.
        text = generate._deck_settings(settings)
        self.assertIn("DENSITY: balanced", text)
        self.assertNotIn("Do NOT", text)

    def test_a_theme_nobody_drew_falls_back_rather_than_reaching_the_page(self):
        self.assertEqual(self.spec_for(theme="rainbow")["theme"], "auto")
        self.assertEqual(self.spec_for(theme="HISTORY")["theme"], "history")
        self.assertEqual(self.spec_for(density="cramped")["density"], "balanced")

    def test_every_toggle_off_says_so_in_the_prompt(self):
        text = generate._deck_settings(self.spec_for(
            examples=False, diagrams=False, self_check=False, teacher_notes=False))
        self.assertIn("DIAGRAMS: none", text)
        self.assertIn("reveal", text)
        self.assertIn("`notes`", text)
        self.assertIn("No worked examples", text)

    def test_a_checkbox_stays_a_checkbox(self):
        # `bool` is a subclass of `int`; the int branch would clamp True to 1,
        # which happens to work and would silently stop being a boolean.
        for given, expected in ((0, False), ("", False), (1, True), ("yes", True)):
            self.assertIs(self.spec_for(diagrams=given)["diagrams"], expected, given)

    def test_key_concepts_become_a_list_the_deck_must_cover(self):
        text = generate._deck_settings(self.spec_for(
            key_concepts="זווית חיצונית, סכום זוויות; משולש שווה שוקיים"))
        self.assertIn("MUST COVER", text)
        self.assertIn("- זווית חיצונית", text)
        self.assertIn("- סכום זוויות", text)
        self.assertIn("- משולש שווה שוקיים", text)

    def test_key_concepts_are_bounded_prose_on_their_way_into_a_prompt(self):
        settings = self.spec_for(key_concepts="x" * 5000)
        self.assertLessEqual(len(settings["key_concepts"]), spec.MAX_TEXT)

    def test_the_density_is_named_in_every_case(self):
        for density in spec.PRESENTATION_DENSITIES:
            self.assertIn(f"DENSITY: {density}",
                          generate._deck_settings(self.spec_for(density=density)))


class HowTheDeckIsDrawnReachesTheChild(unittest.IsolatedAsyncioTestCase):

    async def test_the_open_payload_carries_the_ground(self):
        # Without these the child's slides fell back to the default violet while
        # the teacher's preview showed the subject's ground — and "the preview
        # is what the child sees" is the whole reason the slide is a stage.
        from unittest.mock import AsyncMock, patch
        task = {"_id": "tsk-1", "spec": {"title": "t", "language": "he",
                                         "subject": "math",
                                         "presentation": {"theme": "history"}}}
        with patch("app.services.tasks.store.get_activation",
                   AsyncMock(return_value={"content_snapshot": {}, "due_at": None})), \
             patch("app.services.tasks.store.start_attempt",
                   AsyncMock(return_value={"answers": {}, "status": "in_progress"})), \
             patch("app.services.tasks.store.get_task", AsyncMock(return_value=task)):
            payload = await attempts.open_task("tsk-1:1", "kid-a")
        self.assertEqual(payload["subject"], "math")
        self.assertEqual(payload["theme"], "history")
