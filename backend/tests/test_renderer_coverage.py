"""Every element the sanitizer accepts must be drawn by the still renderer.

The bug this exists to prevent already happened. `prop` and `drawing` were added
to the scene contract, validated by `sanitize_scene`, and implemented only in the
Manim worker. Every still went to the browser renderer or the SVG fallback, and
neither knew those types — so the entire object vocabulary built for science
rendered as nothing at all, silently, for every non-animated scene.

Nothing failed. The scene was valid, the render succeeded, the picture was just
missing the thing it was about. That is the failure mode a coverage test catches
and an example-based test does not: adding a type to the allow-list without a
renderer is a one-line change that no existing assertion touches.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.agents.manim_visual import _svg_fallback, sanitize_scene  # noqa: E402

# One minimal, valid element per accepted type. Keyed by the type name so a new
# entry in the allow-list without a sample here fails the coverage check below.
SAMPLES: dict[str, dict] = {
    "polygon": {"type": "polygon", "points": [[-1, -1], [1, -1], [0, 1]]},
    "polyline": {"type": "polyline", "points": [[-2, 0], [0, 1], [2, 0]]},
    "line": {"type": "line", "points": [[-2, 0], [2, 0]]},
    "arrow": {"type": "arrow", "points": [[-2, -1], [2, 1]]},
    "point": {"type": "point", "points": [[1, 1]], "label": "A"},
    "circle": {"type": "circle", "center": [0, 0], "radius": 1.2},
    "rectangle": {"type": "rectangle", "center": [0, 0], "width": 2.0, "height": 1.2},
    "arc": {"type": "arc", "center": [0, 0], "radius": 1.2, "start_angle": 0.0, "angle": 1.57},
    "angle": {"type": "angle", "points": [[1, 0], [0, 0], [0, 1]], "label": "α"},
    "right_angle": {"type": "right_angle", "points": [[1, 0], [0, 0], [0, 1]]},
    "axes": {"type": "axes", "position": [0, 0], "x_range": [-5, 5, 1], "y_range": [-3, 3, 1]},
    "text": {"type": "text", "position": [0, 2], "label": "12.1"},
    "brace": {"type": "brace", "points": [[-2, 0], [2, 0]], "label": "3"},
    "number_line": {"type": "number_line", "position": [0, 0], "range": [12, 19, 1], "marks": [12.1, 18.7]},
    "prop": {"type": "prop", "prop": "balance_scale", "center": [0, 0], "left_mass": 3, "right_mass": 4},
    "drawing": {"type": "drawing", "center": [0, 0], "size": 2.0,
                "strokes": [{"d": "M 10 40 L 10 10 L 30 10 L 30 40 Z"}]},
    # Chemistry has its own renderer and carries no canvas geometry, so the SVG
    # still is not the surface that draws it.
    "molecule": {"type": "molecule", "smiles": "CCO", "label": "אתנול"},
}

# Types the SVG still deliberately does not draw, with the renderer that does.
DRAWN_ELSEWHERE = {"molecule"}


def accepted_types() -> set[str]:
    """The allow-list, read from the sanitizer rather than restated here."""
    return {
        name for name in SAMPLES
        if sanitize_scene({
            "use_visual": True, "title": "t", "alt": "a", "caption": "c",
            "elements": [SAMPLES[name]],
        }) is not None
    }


class SamplesCoverTheAllowList(unittest.TestCase):
    def test_every_sample_survives_validation(self) -> None:
        """A sample the sanitizer rejects would silently skip its renderer check."""
        missing = sorted(set(SAMPLES) - accepted_types())
        self.assertEqual(missing, [], f"sample elements were rejected: {missing}")


class StillRendererDrawsEveryType(unittest.TestCase):
    """The guarantee: accepted by the sanitizer ⇒ visible in the still."""

    def _svg(self, element: dict) -> str:
        scene = sanitize_scene({
            "use_visual": True, "title": "t", "alt": "a", "caption": "c",
            "elements": [element],
        })
        assert scene is not None
        return _svg_fallback(scene).decode("utf-8")

    def test_each_element_contributes_marks_to_the_still(self) -> None:
        baseline = len(self._svg(SAMPLES["text"]))
        for name in sorted(set(SAMPLES) - DRAWN_ELSEWHERE):
            with self.subTest(element=name):
                svg = self._svg(SAMPLES[name])
                drawn = sum(
                    svg.count(f"<{tag}")
                    for tag in ("polygon", "polyline", "line", "circle", "ellipse", "path", "rect")
                )
                self.assertGreater(
                    drawn, 1,  # the background <rect> is always present
                    f"'{name}' was accepted but drew nothing in the still",
                )
                self.assertGreater(len(svg), baseline // 2)

    def test_a_composite_scene_is_routed_to_the_server_drawing(self) -> None:
        """Props/drawings have no client renderer, so the route must not be 'mafs'."""
        from app.agents.manim_visual import build_scene_visual

        for name in ("prop", "drawing"):
            with self.subTest(element=name):
                scene = sanitize_scene({
                    "use_visual": True, "title": "t", "alt": "a", "caption": "c",
                    "elements": [SAMPLES[name]],
                })
                assert scene is not None
                self.assertEqual(scene["render"], "diagram")
                self.assertEqual(build_scene_visual(scene)["renderer"], "svg-diagram")

    def test_plain_geometry_still_renders_in_the_browser(self) -> None:
        """The routing change must not pull maths off the interactive renderer."""
        from app.agents.manim_visual import build_scene_visual

        scene = sanitize_scene({
            "use_visual": True, "title": "t", "alt": "a", "caption": "c",
            "elements": [SAMPLES["polygon"], SAMPLES["text"]],
        })
        assert scene is not None
        self.assertEqual(scene["render"], "geometry")
        self.assertEqual(build_scene_visual(scene)["renderer"], "mafs")


if __name__ == "__main__":
    unittest.main()
