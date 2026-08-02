"""The prop vocabulary — real objects instead of words next to a ruler.

The planner could only emit abstract geometry, so "why is the inflated balloon
heavier?" came out as the words בלון מנופח / בלון ריק floating above a number
line. Nothing in the picture was a balloon and nothing was a balance; the line's
positions carried no meaning. Props give the planner the objects themselves.

The physics assertions here matter more than the geometry ones: a balance whose
heavier pan RISES is not a cosmetic bug, it draws the misconception the picture
exists to correct.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.manim_props import PROP_KINDS  # noqa: E402
from app.agents.manim_visual import sanitize_scene  # noqa: E402


def scene_with(*elements: dict) -> dict:
    return sanitize_scene({
        "use_visual": True, "title": "t", "alt": "a", "caption": "c",
        "elements": list(elements),
    }) or {"elements": []}


class PropValidation(unittest.TestCase):
    def test_a_known_prop_survives_with_its_parameters(self):
        scene = scene_with({
            "type": "prop", "prop": "balloon", "center": [0, 0],
            "inflation": 0.4, "size": 0.8, "particles": 12, "seed": 3,
        })
        self.assertEqual(len(scene["elements"]), 1)
        element = scene["elements"][0]
        self.assertEqual(element["prop"], "balloon")
        self.assertEqual(element["inflation"], 0.4)
        self.assertEqual(element["particles"], 12)

    def test_an_unknown_prop_is_dropped_not_approximated(self):
        """A prop the renderer cannot build would leave a hole in the picture
        with its labels still floating where the parts should have been."""
        scene = scene_with({"type": "prop", "prop": "bicycle_pump", "center": [0, 0]})
        self.assertEqual(scene["elements"], [])

    def test_labels_are_kept_per_named_anchor(self):
        scene = scene_with({
            "type": "prop", "prop": "balance_scale", "center": [0, 0],
            "labels": {"left_pan": "ריק", "right_pan": "מנופח"},
        })
        self.assertEqual(
            scene["elements"][0]["labels"], {"left_pan": "ריק", "right_pan": "מנופח"}
        )

    def test_a_nested_load_is_kept_for_the_pan_it_sits_on(self):
        scene = scene_with({
            "type": "prop", "prop": "balance_scale", "center": [0, 0],
            "left_load": {"prop": "balloon", "inflation": 0.1},
            "right_load": {"prop": "balloon", "inflation": 1.0, "particles": 9},
        })
        element = scene["elements"][0]
        self.assertEqual(element["left_load"]["prop"], "balloon")
        self.assertEqual(element["right_load"]["particles"], 9)

    def test_a_nonsense_load_is_dropped_but_the_scale_survives(self):
        scene = scene_with({
            "type": "prop", "prop": "balance_scale", "center": [0, 0],
            "left_load": {"prop": "spaceship"},
        })
        self.assertEqual(len(scene["elements"]), 1)
        self.assertNotIn("left_load", scene["elements"][0])

    def test_bar_comparison_needs_at_least_one_real_value(self):
        self.assertEqual(
            scene_with({"type": "prop", "prop": "bar_comparison", "center": [0, 0],
                        "items": [{"label": "no value"}]})["elements"],
            [],
        )

    def test_every_catalogued_prop_validates(self):
        for name in sorted(PROP_KINDS):
            with self.subTest(prop=name):
                spec = {"type": "prop", "prop": name, "center": [0, 0]}
                if name == "bar_comparison":
                    spec["items"] = [{"value": 1}, {"value": 2}]
                self.assertEqual(len(scene_with(spec)["elements"]), 1)


class BalancePhysics(unittest.TestCase):
    """Geometry checks that do not need Manim — the factory maths only."""

    def _ends(self, **spec):
        import math

        from app.agents import manim_props

        captured: dict = {}

        class FakeMobject:
            def __init__(self, *points, **kwargs):
                captured.setdefault("points", []).extend(points)

            def shift(self, *_a, **_k):
                return self

            def get_bottom(self):
                return [0.0, 0.0, 0.0]

        class FakeManim:
            Line = Polygon = Dot = Ellipse = Rectangle = FakeMobject
            UP = [0.0, 1.0, 0.0]

            class VGroup(list):
                def __init__(self, *items):
                    super().__init__(items)

                def get_bottom(self):
                    return [0.0, 0.0, 0.0]

        points: list = []

        def to_scene(point):
            points.append(list(point))
            return [point[0], point[1], 0.0]

        manim_props.build_prop(
            {"prop": "balance_scale", "center": [0, 0], **spec},
            manim=FakeManim, color_for=lambda n: "#000000",
            to_scene=to_scene, unit=1.0,
        )
        # Pick the beam ENDS out of every mapped point rather than trusting a
        # call index: they are the pair furthest from the pillar on each side.
        beam_half = 1.55  # size defaults to 1.0
        left = min((p for p in points if p[0] < -0.1), key=lambda p: abs(abs(p[0]) - beam_half))
        right = min((p for p in points if p[0] > 0.1), key=lambda p: abs(abs(p[0]) - beam_half))
        return left, right

    def test_the_heavier_side_goes_down(self):
        left, right = self._ends(left_mass=3.0, right_mass=3.5)
        self.assertLess(right[1], left[1], "3.5 g must sit LOWER than 3.0 g")

    def test_the_mirror_case_goes_the_other_way(self):
        left, right = self._ends(left_mass=9.0, right_mass=1.0)
        self.assertLess(left[1], right[1])

    def test_equal_masses_sit_level(self):
        left, right = self._ends(left_mass=4.0, right_mass=4.0)
        self.assertAlmostEqual(left[1], right[1], places=6)

    def test_a_positive_tilt_dips_the_right_pan(self):
        left, right = self._ends(tilt=1.0)
        self.assertLess(right[1], left[1])

    def test_a_huge_difference_does_not_stand_the_beam_up(self):
        """3 g vs 300 g is still a beam balance, not a see-saw."""
        left, right = self._ends(left_mass=3.0, right_mass=300.0)
        self.assertLess(abs(left[1] - right[1]), 1.4)


if __name__ == "__main__":
    unittest.main()
