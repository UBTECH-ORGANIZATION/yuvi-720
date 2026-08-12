"""Freehand drawings — the escape hatch from a finite prop catalogue.

Props cover the objects we anticipated. A lesson that needs a bicycle pump, a
leaf or a pulley gets nothing from them, and the planner falls back to words in
boxes — the failure props were built to end, one topic further out. A `drawing`
is a list of SVG path strokes, which can express any shape and is still data.

Two things are asserted here. That the grammar is a REJECTER, not a repairer: a
half-understood path draws a shape nobody intended, and the learner cannot tell
a wrong picture from a right one. And that the planner supplies shape while we
supply placement — strokes authored in any coordinate space come out the same
size in the same place, which is what makes freehand safe to hand to a model.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.manim_visual import sanitize_scene  # noqa: E402
from app.agents.visuals.drawing import MAX_COMMANDS, clean_path  # noqa: E402

LEAF = "M 50 5 C 12 32 12 74 50 95 C 88 74 88 32 50 5 Z"


def scene_with(**overrides) -> dict:
    element = {
        "type": "drawing", "center": [0, 0], "size": 2.0,
        "strokes": [{"d": LEAF, "color": "success", "fill_opacity": 0.25}],
    }
    element.update(overrides)
    return sanitize_scene({
        "use_visual": True, "title": "t", "alt": "a", "caption": "c",
        "elements": [element],
    }) or {"elements": []}


class PathGrammar(unittest.TestCase):
    def test_a_real_path_is_accepted(self):
        self.assertEqual(clean_path(LEAF), LEAF)
        self.assertIsNotNone(clean_path("m 0 0 l 10 0 a 5 5 0 1 0 -10 0 z"))

    def test_anything_that_is_not_a_path_is_rejected(self):
        for bad in (
            "url(#x)",                      # a reference, not geometry
            "M 0 0 L 10 10; DROP TABLE x",  # command injection shape
            "<path d='M0 0'/>",             # markup
            "M 0 0 L eval(1)",              # a call
            "translate(4,4)",               # a transform
            "",
            None,
            42,
            ["M 0 0"],
        ):
            with self.subTest(bad=bad):
                self.assertIsNone(clean_path(bad))

    def test_a_path_must_begin_with_a_moveto(self):
        """A path starting mid-way has an undefined origin and would be placed
        somewhere the planner never chose."""
        self.assertIsNone(clean_path("L 10 10 L 20 20"))

    def test_absurd_paths_are_bounded(self):
        self.assertIsNone(clean_path("M 0 0" + " L 1 1" * (MAX_COMMANDS + 5)))
        self.assertIsNone(clean_path("M 0 0" + " L 1 1" * 5000))


class DrawingValidation(unittest.TestCase):
    def test_a_drawing_survives_with_its_strokes(self):
        scene = scene_with()
        self.assertEqual(len(scene["elements"]), 1)
        self.assertEqual(len(scene["elements"][0]["strokes"]), 1)

    def test_bad_strokes_are_dropped_and_good_ones_kept(self):
        """One unusable stroke must not cost the whole object."""
        scene = scene_with(strokes=[
            {"d": LEAF}, {"d": "url(#evil)"}, {"d": "M 50 95 L 50 12"},
        ])
        self.assertEqual(len(scene["elements"][0]["strokes"]), 2)

    def test_a_drawing_with_no_usable_stroke_is_dropped(self):
        self.assertEqual(scene_with(strokes=[{"d": "nonsense"}])["elements"], [])
        self.assertEqual(scene_with(strokes="not a list")["elements"], [])

    def test_size_is_clamped_so_a_drawing_cannot_swallow_the_canvas(self):
        self.assertEqual(scene_with(size=99)["elements"][0]["size"], 5.0)
        self.assertEqual(scene_with(size=0.001)["elements"][0]["size"], 0.2)

    def test_fill_and_stroke_width_are_bounded(self):
        scene = scene_with(strokes=[{"d": LEAF, "fill_opacity": 9, "stroke_width": 400}])
        stroke = scene["elements"][0]["strokes"][0]
        self.assertLessEqual(stroke["fill_opacity"], 0.85)
        self.assertLessEqual(stroke["stroke_width"], 10.0)

    def test_the_stroke_count_is_capped(self):
        scene = scene_with(strokes=[{"d": LEAF}] * 40)
        self.assertLessEqual(len(scene["elements"][0]["strokes"]), 12)


class PlacementIsOurs(unittest.TestCase):
    """The planner supplies shape; we supply size and position."""

    def _bounds(self, strokes, size, center):
        import manim as manim_ns

        from app.agents.visuals.manim_shapes import to_mobjects
        from app.agents.visuals.shapes import build_drawing

        canvas_shapes, _ = build_drawing(
            {"strokes": strokes, "size": size, "center": center},
            color_for=lambda n: "#000000",
        )
        shapes = to_mobjects(
            canvas_shapes, manim=manim_ns,
            to_scene=lambda p: manim_ns.np.array([p[0], p[1], 0.0]), unit=1.0,
        )
        group = manim_ns.VGroup(*shapes)
        return group.width, group.height, group.get_center()

    def test_the_same_shape_in_different_coordinate_spaces_lands_identically(self):
        """0..100 and -1..1 are both convenient to author in; neither should
        change where the object ends up or how big it is."""
        big = [{"d": "M 0 0 L 100 0 L 100 100 L 0 100 Z"}]
        small = [{"d": "M 0 0 L 1 0 L 1 1 L 0 1 Z"}]
        a = self._bounds(big, 2.0, [1.0, 0.5])
        b = self._bounds(small, 2.0, [1.0, 0.5])
        self.assertAlmostEqual(a[0], b[0], places=4)
        self.assertAlmostEqual(a[1], b[1], places=4)
        self.assertAlmostEqual(a[2][0], b[2][0], places=4)
        self.assertAlmostEqual(a[2][1], b[2][1], places=4)

    def test_a_drawing_is_fitted_to_the_size_it_was_given(self):
        width, height, _ = self._bounds([{"d": "M 0 0 L 40 0 L 40 40 L 0 40 Z"}], 2.0, [0, 0])
        self.assertAlmostEqual(max(width, height), 2.0, places=3)

    def test_a_drawing_is_centred_where_it_was_asked_to_be(self):
        _, _, center = self._bounds([{"d": LEAF}], 1.5, [2.5, -1.0])
        self.assertAlmostEqual(center[0], 2.5, places=3)
        self.assertAlmostEqual(center[1], -1.0, places=3)

    def test_svg_y_down_is_flipped_to_manim_y_up(self):
        """Without the flip every drawing arrives upside down — and a planner
        that compensates by negating its own y produces a path that is wrong
        against every other convention."""
        import manim as manim_ns

        from app.agents.visuals.manim_shapes import to_mobjects
        from app.agents.visuals.shapes import build_drawing

        # A wide base at SVG y=100 (visually LOW) and a point at y=0 (HIGH).
        canvas_shapes, _ = build_drawing(
            {"strokes": [{"d": "M 0 100 L 100 100 L 50 0 Z"}], "size": 2.0, "center": [0, 0]},
            color_for=lambda n: "#000000",
        )
        shapes = to_mobjects(
            canvas_shapes, manim=manim_ns,
            to_scene=lambda p: manim_ns.np.array([p[0], p[1], 0.0]), unit=1.0,
        )
        points = manim_ns.VGroup(*shapes).get_all_points()
        lowest = min(p[1] for p in points)
        widths_at_bottom = [p[0] for p in points if abs(p[1] - lowest) < 0.05]
        # The wide edge must be at the BOTTOM in Manim space.
        self.assertGreater(max(widths_at_bottom) - min(widths_at_bottom), 1.0)


if __name__ == "__main__":
    unittest.main()
