"""A number line must measure something.

The learner asked "show me with a video" on a four-rule lab protocol (zero the
balance, repeat, spot the outlier, write the unit). What came back was a 0..10
number line with ticks at 2/5/8 carrying the words "עדין מאוד" / "גדול יותר" /
"סימון א׳" — a measuring instrument used as a layout device for vocabulary. The
learner reads ticks as quantities, so a scale that measures nothing is worse
than no picture at all.

The drawable claim in that protocol is the outlier: three readings close
together and one far away, where "חריגה" is DISTANCE rather than a caption.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.manim_visual import _is_decorative_scale  # noqa: E402


def line(range_, marks, **extra):
    return {"type": "number_line", "position": [0, 0], "range": range_,
            "marks": marks, **extra}


def text(label, x=0.0):
    return {"type": "text", "position": [x, 0.9], "label": label}


class DecorativeScaleGuard(unittest.TestCase):
    def test_the_observed_failure_is_caught(self):
        """Ticks on the grid, not one digit anywhere: a ruler for words."""
        self.assertTrue(_is_decorative_scale([
            line([0.0, 10.0, 1.0], [2.0, 5.0, 8.0], label="סדר גודל"),
            text("עדין מאוד", 1.0),
            text("גדול יותר", 9.0),
            text("סימון א׳", 2.0),
        ]))

    def test_real_readings_are_kept(self):
        """Three weighings close together and one far off — the good scene. The
        marks sit off the tick grid because measurements do."""
        self.assertFalse(_is_decorative_scale([
            line([23.5, 28.0, 0.5], [24.1, 24.2, 27.8]),
            text("חריגה", 27.8),
        ]))

    def test_the_corpus_cluster_and_outlier_scene_is_kept(self):
        """`number_line_annotated` from a live render: marks 3, 3.4, 8 are a
        cluster and an outlier, and 3.4 is off-grid. Words alone must not
        condemn a scene."""
        self.assertFalse(_is_decorative_scale([
            line([0, 10, 1], [3, 3.4, 8], label="מדידות"),
            text("קרובות", 3.2),
            text("חריגה", 8.0),
        ]))

    def test_a_bare_marked_line_is_kept(self):
        """`number_line_wide`: marking -7, 0, 4 when the numbers ARE the
        subject. On-grid, no digits in labels — but nothing was pasted on it."""
        self.assertFalse(_is_decorative_scale([
            line([-10, 10, 1], [-7, 0, 4], label="מספרים"),
        ]))

    def test_a_plotted_curve_is_kept(self):
        """A sine graph: axes labelled x/y, no digit anywhere — the polyline is
        the data, so the frame is doing real work."""
        self.assertFalse(_is_decorative_scale([
            {"type": "axes", "position": [0, 0], "x_range": [-6, 6, 1],
             "y_range": [-2, 2, 1], "x_label": "x", "y_label": "y"},
            {"type": "polyline", "points": [[-6, 0], [0, 1], [6, 0]]},
        ]))

    def test_a_label_carrying_a_value_is_enough_to_keep_it(self):
        """On-grid marks are fine when something on the canvas is a quantity."""
        self.assertFalse(_is_decorative_scale([
            line([0.0, 10.0, 1.0], [2.0, 8.0]),
            text("24 גרם", 2.0),
        ]))

    def test_scenes_without_a_numeric_frame_are_untouched(self):
        """The guard is about scales specifically; other scenes have their own
        rules and must not be swept up by this one."""
        self.assertFalse(_is_decorative_scale([
            {"type": "polygon", "points": [[0, 0], [1, 0], [0, 1]],
             "labels": ["A", "B", "C"]},
            text("משולש"),
        ]))

    def test_an_axes_used_the_same_way_is_caught_too(self):
        self.assertTrue(_is_decorative_scale([
            {"type": "axes", "position": [0, 0], "x_range": [0, 10, 1],
             "y_range": [0, 10, 1], "x_label": "זמן", "y_label": "כמות"},
            text("עולה"),
        ]))

    def test_a_frame_with_no_words_on_it_is_kept(self):
        """Nothing was pasted onto the scale, so there is nothing to condemn."""
        self.assertFalse(_is_decorative_scale([line([0.0, 10.0, 1.0], [])]))


if __name__ == "__main__":
    unittest.main()
