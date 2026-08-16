"""Arrows must point AT a shape, not into its fill.

Measured 16/08 on a photosynthesis diagram: the light arrow ended inside the
stem, the CO₂ arrow ended inside the leaf, and the O₂ arrow started inside it —
the planner puts an endpoint at the object's centre because semantically that is
"the leaf", and the render then buries the head in the fill.

Snapping is geometric and content-agnostic: any filled shape that can answer
"is this point inside me?" participates.
"""

from __future__ import annotations

import math
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.manim_visual import _ARROW_CLEARANCE, _snap_arrows_to_shapes  # noqa: E402


LEAF = {"type": "polygon", "points": [[0, -1], [2, -1], [2, 1], [0, 1]], "color": "primary"}
SUN = {"type": "circle", "center": [-4, 2], "radius": 1.0, "color": "accent"}


def arrow(tail, head):
    return {"type": "arrow", "points": [list(tail), list(head)], "color": "ink"}


class ArrowSnapTests(unittest.TestCase):
    def test_a_head_inside_a_shape_is_pulled_to_its_edge(self):
        item = arrow([-3, 0], [1, 0])          # ends at the middle of the leaf
        _snap_arrows_to_shapes([LEAF, item])
        head_x = item["points"][1][0]
        self.assertAlmostEqual(head_x, -_ARROW_CLEARANCE, places=2)
        self.assertEqual(item["points"][0], [-3, 0])

    def test_a_tail_inside_a_shape_is_pushed_out(self):
        item = arrow([1, 0], [5, 0])           # oxygen leaving the leaf
        _snap_arrows_to_shapes([LEAF, item])
        self.assertAlmostEqual(item["points"][0][0], 2 + _ARROW_CLEARANCE, places=2)

    def test_a_circle_works_the_same(self):
        item = arrow([-4, 2], [0, 2])          # light leaving the sun
        _snap_arrows_to_shapes([SUN, item])
        self.assertAlmostEqual(item["points"][0][0], -3 + _ARROW_CLEARANCE, places=2)

    def test_an_arrow_drawn_inside_an_object_is_left_alone(self):
        item = arrow([0.5, 0], [1.5, 0])
        _snap_arrows_to_shapes([LEAF, item])
        self.assertEqual(item["points"], [[0.5, 0], [1.5, 0]])

    def test_an_arrow_passing_over_a_shape_is_left_alone(self):
        item = arrow([-3, 0], [5, 0])
        _snap_arrows_to_shapes([LEAF, item])
        self.assertEqual(item["points"], [[-3, 0], [5, 0]])

    def test_a_trim_that_would_erase_the_arrow_is_abandoned(self):
        """Better a short overlap than an arrowhead with no arrow behind it."""
        item = arrow([-0.15, 0], [1, 0])
        _snap_arrows_to_shapes([LEAF, item])
        self.assertEqual(item["points"], [[-0.15, 0], [1, 0]])

    def test_both_ends_snap_against_different_shapes(self):
        item = arrow([-4, 2], [1, 0])
        _snap_arrows_to_shapes([SUN, LEAF, item])
        tail, head = item["points"]
        self.assertGreater(math.hypot(tail[0] + 4, tail[1] - 2), 1.0)   # outside the sun
        self.assertLess(head[0], 0)                                      # outside the leaf
