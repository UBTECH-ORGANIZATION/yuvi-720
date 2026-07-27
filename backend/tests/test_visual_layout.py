"""Layout invariants for Coach scene labels.

These are the fast layer of the visual quality suite: pure Python, no Manim, no
browser, milliseconds per case.  They encode what "text in the right places"
actually means, so the property is enforced on every commit instead of being
eyeballed in a rendered MP4.

The fuzzer at the bottom is the part that covers *generic* scenes — hand-written
cases only test the failures we already thought of.
"""

from __future__ import annotations

import math
import pathlib
import random
import re
import unittest

from app.agents.visual_layout import (
    BRACE_BAR,
    BRACE_GAP,
    BRACE_REACH,
    Box,
    CanvasTransform,
    _FIT_TARGET_X,
    _FIT_TARGET_X_WITH_FORMULA,
    _FIT_TARGET_Y,
    _FORMULA_PATTERN,
    _MARK_DOT_RADIUS,
    _MAX_FIT_SCALE,
    _MAX_FIT_SCALE_NUMBER_LINE,
    _NUMBER_LINE_TICK_DROP,
    _NUMBER_LINE_TICK_FONT_SIZE,
    _number_line_decoration_boxes,
    _number_line_tick_labels,
    build_transform,
    check_layout,
    collect_label_requests,
    collect_obstacles,
    solve_scene_layout,
    text_extent,
    FRAME_X,
    FRAME_Y,
)

backend_root = pathlib.Path(__file__).resolve().parents[1]


def _scene(elements: list[dict], **extra) -> dict:
    return {"use_visual": True, "title": "", "alt": "", "caption": "", "elements": elements, **extra}


PYTHAGORAS = [
    {
        "type": "polygon", "color": "primary",
        "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
        "labels": ["A", "B", "C"], "side_labels": ["4", "3", "יתר"],
        "fill_opacity": 0.08,
    },
    {"type": "right_angle", "color": "accent", "points": [[-2, -1.5], [2, -1.5], [2, 1.5]]},
    {"type": "text", "color": "ink", "position": [-3.4, 2.2], "label": "a² + b² = c²"},
]

PARABOLA = [
    {
        "type": "axes", "color": "ink", "position": [0, 0],
        "x_range": [-3, 3, 1], "y_range": [-1, 9.5, 1], "x_label": "x", "y_label": "y",
    },
    {
        "type": "polyline", "color": "primary", "label": "y=x²",
        "points": [[x / 4 - 3, (x / 4 - 3) ** 2] for x in range(25)],
    },
    {"type": "point", "color": "accent", "points": [[2, 4]], "label": "(2,4)"},
    {"type": "point", "color": "accent", "points": [[-2, 4]], "label": "(-2,4)"},
]


class CanvasTransformTests(unittest.TestCase):
    """The transform must match what manim_worker actually draws."""

    def test_axes_scene_maps_data_range_onto_the_axes_box(self) -> None:
        transform = build_transform(PARABOLA)
        # x_range [-3,3] over the worker's x_length 9.5, centred on position [0,0].
        left = transform.apply([-3, 0])
        right = transform.apply([3, 0])
        self.assertAlmostEqual(right[0] - left[0], 9.5, places=6)
        self.assertAlmostEqual((left[0] + right[0]) / 2, 0.0, places=6)

    def test_circle_scene_uses_one_unit_scale_so_circles_stay_round(self) -> None:
        transform = build_transform([
            {"type": "axes", "color": "ink", "position": [0, 0],
             "x_range": [-4, 4, 1], "y_range": [-4, 4, 1]},
            {"type": "circle", "color": "primary", "center": [0, 0], "radius": 3},
        ])
        self.assertAlmostEqual(transform.scale_x, transform.scale_y, places=6)

    def test_plain_scene_fit_is_bounded_and_centred(self) -> None:
        transform = build_transform(PYTHAGORAS)
        # The worker caps the fit scale at 1.7 for non-number-line scenes.
        self.assertLessEqual(transform.scale_x, 1.7 + 1e-9)
        self.assertGreater(transform.scale_x, 0.0)

    def test_transform_round_trips(self) -> None:
        transform = CanvasTransform(scale_x=1.6, scale_y=1.6, offset_x=0.4, offset_y=-0.2)
        point = transform.invert(transform.apply([2.5, -1.25]))
        self.assertAlmostEqual(point[0], 2.5, places=9)
        self.assertAlmostEqual(point[1], -1.25, places=9)


class FitTests(unittest.TestCase):
    """The fit that shapes are drawn through, and its two known failure modes."""

    def test_circle_extent_is_fitted_not_just_its_centre(self) -> None:
        """A circle fitted as a point hung off one side with dead space opposite."""
        elements = [
            {"type": "circle", "color": "primary", "center": [0, 0], "radius": 2.2, "label": "r"},
            {"type": "line", "color": "secondary", "points": [[0, 0], [2.2, 0]]},
        ]
        transform = build_transform(elements)
        left = transform.apply([-2.2, 0])[0]
        right = transform.apply([2.2, 0])[0]
        self.assertAlmostEqual(
            (left + right) / 2, 0.0, places=1,
            msg="circle is not horizontally centred in the frame",
        )
        self.assertLessEqual(max(abs(left), abs(right)), FRAME_X)

    def test_rectangle_extent_is_fitted(self) -> None:
        elements = [{"type": "rectangle", "color": "primary", "center": [0, 0],
                     "width": 12.0, "height": 6.0, "label": "R"}]
        transform = build_transform(elements)
        half = abs(transform.apply([6.0, 0])[0] - transform.apply([0, 0])[0])
        self.assertLessEqual(half, FRAME_X, "rectangle overflows the frame")

    def test_number_line_stretches_toward_the_full_width(self) -> None:
        """A 12..13 line used to occupy 3.2 of the ~10.7 available units."""
        elements = [{"type": "number_line", "color": "ink", "position": [0, 0],
                     "range": [12, 13, 0.1], "marks": [12.1, 12.7]}]
        transform = build_transform(elements)
        span = transform.apply([13, 0])[0] - transform.apply([12, 0])[0]
        self.assertGreater(span, 8.0, f"number line spans only {span:.2f} units")

    def test_solved_scene_publishes_its_transform(self) -> None:
        """One producer, many consumers — the renderers must not re-derive it."""
        scene = solve_scene_layout(_scene(list(PYTHAGORAS)))
        self.assertIn("canvas", scene)
        canvas = scene["canvas"]
        self.assertEqual(canvas["space"], "canvas")
        transform = build_transform(scene["elements"])
        self.assertAlmostEqual(canvas["scale_x"], transform.scale_x, places=5)
        self.assertAlmostEqual(canvas["offset_x"], transform.offset_x, places=5)

    def test_axes_scene_publishes_data_space(self) -> None:
        scene = solve_scene_layout(_scene(list(PARABOLA)))
        self.assertEqual(scene["canvas"]["space"], "data")


class ContentBoundsTests(unittest.TestCase):
    """What the renderers crop a small preview to."""

    def test_bounds_cover_every_label_and_stay_in_frame(self) -> None:
        scene = solve_scene_layout(_scene([
            {"type": "number_line", "color": "ink", "position": [0, 0],
             "range": [0, 10, 1], "marks": [3, 8], "label": "מדידות"},
            {"type": "text", "color": "warning", "position": [8.0, 0.9], "label": "חריגה?"},
        ]))
        x0, y0, x1, y1 = scene["content"]
        self.assertLess(x0, x1)
        self.assertLess(y0, y1)
        self.assertGreaterEqual(x0, -FRAME_X)
        self.assertLessEqual(x1, FRAME_X)
        self.assertGreaterEqual(y0, -FRAME_Y)
        self.assertLessEqual(y1, FRAME_Y)
        for element in scene["elements"]:
            for slot, (cx, cy) in (element.get("layout") or {}).items():
                self.assertTrue(x0 <= cx <= x1 and y0 <= cy <= y1,
                                f"{slot} falls outside the published content bounds")

    def test_bounds_are_tighter_than_the_frame_when_they_can_be(self) -> None:
        """The whole point: a flat scene must not claim the full 8-unit height."""
        scene = solve_scene_layout(_scene([
            {"type": "number_line", "color": "ink", "position": [0, 0],
             "range": [0, 10, 1], "marks": [3]},
        ]))
        _, y0, _, y1 = scene["content"]
        self.assertLess(y1 - y0, FRAME_Y, "a number line claimed more than half the frame height")


class BraceGeometryTests(unittest.TestCase):
    """The brace band is copied from the real mobject — verify against it.

    Skipped when Manim is not importable: the rest of this suite is deliberately
    Manim-free and must stay runnable without it.
    """

    def test_band_matches_the_real_brace(self) -> None:
        try:
            import numpy as np
            from manim import Brace, Line
        except Exception as exc:                       # pragma: no cover
            self.skipTest(f"manim unavailable: {exc}")

        for length in (2.0, 6.0):
            with self.subTest(length=length):
                span = Line(np.array([-length / 2, 0, 0]), np.array([length / 2, 0, 0]))
                brace = Brace(span, direction=np.array([0, -1, 0]))
                self.assertAlmostEqual(-brace.get_top()[1], BRACE_GAP, places=2)
                self.assertAlmostEqual(-brace.get_bottom()[1], BRACE_REACH, places=2)
                self.assertLess(BRACE_GAP, BRACE_BAR)
                self.assertLess(BRACE_BAR, BRACE_REACH)


class FitConstantDriftTests(unittest.TestCase):
    """The fit is mirrored in the TS renderer as a fallback for old scenes.

    New scenes carry `canvas` so the mirror is not consulted, but a silent
    divergence would still misplace history. These read the other copies.
    """

    def _frontend(self, name: str) -> str:
        path = backend_root.parent / "frontend" / "src" / "features" / "visuals" / name
        return path.read_text(encoding="utf-8")

    def test_frontend_mirrors_the_fit_targets(self) -> None:
        source = self._frontend("MafsScene.tsx")
        self.assertIn(f"[{_FIT_TARGET_X[0]}, {_FIT_TARGET_X[1]}]", source)
        self.assertIn(f"[{_FIT_TARGET_X_WITH_FORMULA[0]}, {_FIT_TARGET_X_WITH_FORMULA[1]}]", source)
        self.assertIn(f"[{_FIT_TARGET_Y[0]}, {_FIT_TARGET_Y[1]}]", source)

    def test_frontend_mirrors_the_scale_caps(self) -> None:
        source = self._frontend("MafsScene.tsx")
        self.assertIn(f"hasNumberLine ? {_MAX_FIT_SCALE_NUMBER_LINE} : {_MAX_FIT_SCALE}", source)

    def test_frontend_draws_the_number_line_ticks_the_solver_models(self) -> None:
        """The solver reserves the tick row on BOTH renderers, so both must
        draw it. Mafs drew a bare segment with dots and no numbers at all,
        which made a still and its video twin different pictures.
        """
        source = self._frontend("MafsScene.tsx")
        self.assertIn(f"const TICK_DROP = {_NUMBER_LINE_TICK_DROP}", source)
        self.assertIn("widest * 0.12 + 0.16", source, "tick stride formula diverged")
        self.assertIn("numberLineTicks", source, "number line ticks are not drawn")

    def test_frontend_mirrors_the_brace_geometry(self) -> None:
        source = self._frontend("MafsScene.tsx")
        self.assertIn(f"const BRACE_GAP = {BRACE_GAP}", source)
        self.assertIn(f"const BRACE_REACH = {BRACE_REACH}", source)
        self.assertIn(f"const BRACE_BAR = {BRACE_BAR}", source)

    def test_frontend_mirrors_the_frame(self) -> None:
        source = self._frontend("MafsScene.tsx")
        self.assertIn(f"const FRAME_X = {FRAME_X}", source)
        self.assertIn(f"const FRAME_Y = {FRAME_Y}", source)


class TextExtentTests(unittest.TestCase):
    # Measured from real Manim mobjects: Text(s, font_size=n).width/.height.
    # The estimate must COVER these (never smaller) without being absurdly
    # larger, or the solver reasons about boxes the renderer does not draw.
    MEASURED = [
        ("C", 24, 0.203, 0.230), ("A'", 24, 0.286, 0.225), ("4.5", 24, 0.392, 0.233),
        ("12.75", 24, 0.659, 0.233), ("y=x²", 24, 0.592, 0.296), ("abcd", 24, 0.601, 0.231),
        ("M=(3,2)", 24, 1.091, 0.285),
        ("C", 26, 0.220, 0.249), ("A'", 26, 0.289, 0.244), ("4.5", 26, 0.454, 0.252),
        ("12.75", 26, 0.818, 0.252), ("y=x²", 26, 0.700, 0.321), ("M=(3,2)", 26, 1.199, 0.309),
        ("C", 28, 0.236, 0.268), ("A'", 28, 0.342, 0.263), ("12.75", 28, 0.827, 0.272),
        ("y=x²", 28, 0.707, 0.346), ("abcd", 28, 0.677, 0.269), ("M=(3,2)", 28, 1.306, 0.332),
        ("יתר", 26, 0.528, 0.213), ("זוית", 26, 0.561, 0.213), ("زاوية", 26, 0.593, 0.331),
    ]

    def test_estimate_covers_real_manim_metrics(self) -> None:
        for text, size, real_w, real_h in self.MEASURED:
            with self.subTest(text=text, size=size):
                width, height = text_extent(text, size)
                self.assertGreaterEqual(
                    width, real_w * 0.98,
                    f"width estimate {width:.3f} is narrower than the rendered {real_w:.3f}",
                )
                self.assertGreaterEqual(
                    height, real_h * 0.98,
                    f"height estimate {height:.3f} is shorter than the rendered {real_h:.3f}",
                )

    def test_estimate_is_not_wastefully_large(self) -> None:
        for text, size, real_w, real_h in self.MEASURED:
            with self.subTest(text=text, size=size):
                width, height = text_extent(text, size)
                self.assertLessEqual(width, real_w * 2.0 + 0.15)
                self.assertLessEqual(height, real_h * 1.6)

    def test_short_labels_are_not_proportionally_narrow(self) -> None:
        """The bug that let 'C' and \"A'\" collide: a lone glyph is wide."""
        width, height = text_extent("C", 28)
        self.assertGreater(width, height * 0.8)

    def test_rtl_text_is_estimated_wider_per_glyph(self) -> None:
        latin, _ = text_extent("abcd", 28)
        hebrew, _ = text_extent("אבגד", 28)
        self.assertGreater(hebrew, latin)

    def test_height_scales_with_font_size(self) -> None:
        _, small = text_extent("x", 18)
        _, large = text_extent("x", 36)
        self.assertAlmostEqual(large / small, 2.0, places=6)


class PlacementTests(unittest.TestCase):
    def test_every_label_gets_a_solved_position(self) -> None:
        scene = solve_scene_layout(_scene(list(PYTHAGORAS)))
        polygon = scene["elements"][0]
        self.assertIn("layout", polygon)
        for slot in ("labels:0", "labels:1", "labels:2", "side_labels:0", "side_labels:1", "side_labels:2"):
            self.assertIn(slot, polygon["layout"], f"missing solved position for {slot}")

    def test_pythagoras_scene_has_no_violations(self) -> None:
        scene = solve_scene_layout(_scene(list(PYTHAGORAS)))
        self.assertEqual(check_layout(scene), [])

    def test_parabola_scene_has_no_violations(self) -> None:
        scene = solve_scene_layout(_scene(list(PARABOLA)))
        self.assertEqual(check_layout(scene), [])

    def test_vertex_labels_are_pushed_outward_from_the_polygon(self) -> None:
        scene = solve_scene_layout(_scene(list(PYTHAGORAS)))
        elements = scene["elements"]
        transform = build_transform(elements)
        vertices = [transform.apply(p) for p in elements[0]["points"]]
        centroid = (
            sum(v[0] for v in vertices) / 3,
            sum(v[1] for v in vertices) / 3,
        )
        for index in range(3):
            label = elements[0]["layout"][f"labels:{index}"]
            vertex = vertices[index]
            # The label must be further from the centroid than its own vertex is.
            self.assertGreater(
                math.dist(label, centroid),
                math.dist(vertex, centroid) - 1e-6,
                f"vertex label {index} was placed toward the interior",
            )

    def test_a_label_dropped_on_a_line_is_moved_off_it(self) -> None:
        """The exact failure the old greedy nudge could not fix."""
        elements = [
            {"type": "line", "color": "primary", "points": [[-4, 0], [4, 0]]},
            # Planner put the caption directly on the line.
            {"type": "text", "color": "ink", "position": [0, 0], "label": "הבסיס"},
        ]
        scene = solve_scene_layout(_scene(elements))
        transform = build_transform(scene["elements"])
        solved = scene["elements"][1]["layout"]["position"]
        _, height = text_extent("הבסיס")
        line_y = transform.apply([0, 0])[1]
        self.assertGreater(
            abs(solved[1] - line_y), height / 2,
            "caption is still sitting on the line it labels",
        )

    def test_formula_text_is_left_to_the_renderer_card(self) -> None:
        """manim_worker parks formulas in a fixed card on non-axes scenes.

        The solver must not fight that — but other labels must avoid the card.
        """
        elements = [
            {"type": "polygon", "color": "primary", "points": [[-2, -1], [1, -1], [1, 1]]},
            {"type": "text", "color": "ink", "position": [0, 2.5], "label": "a² + b² = c²"},
            {"type": "point", "color": "accent", "points": [[1.0, 0.2]], "label": "P"},
        ]
        scene = solve_scene_layout(_scene(elements))
        self.assertNotIn("layout", scene["elements"][1], "card formula should not be solved")

        card = Box(3.35, 0.25, 3.5, 1.05)
        solved = scene["elements"][2]["layout"]["label"]
        box = Box(solved[0], solved[1], *text_extent("P", 26))
        self.assertEqual(box.overlap(card), 0.0, "a label was placed inside the formula card")

    def test_formula_pattern_matches_the_renderer(self) -> None:
        """A divergence here silently breaks the fit target and the card."""
        worker = (backend_root / "app" / "agents" / "manim_worker.py").read_text(encoding="utf-8")
        match = re.search(r"formula_pattern = re\.compile\(\s*r\"([^\"]+)\"", worker)
        self.assertIsNotNone(match, "could not find manim_worker's formula_pattern")
        assert match is not None
        self.assertEqual(match.group(1), _FORMULA_PATTERN.pattern)

    def test_every_worker_label_consumes_the_solved_layout(self) -> None:
        """A solved position the renderer ignores is worse than no solver.

        Two call sites (brace labels, a number line's own title) never called
        `placed()`, so the solver positioned them against the whole scene and
        Manim then drew them at a fixed local offset instead — while Mafs used
        the solved value. The still and the video became different pictures.
        The twin test cannot see this: it compares solver output, and both
        renderers were handed the same correct answer.
        """
        worker = (backend_root / "app" / "agents" / "manim_worker.py").read_text(encoding="utf-8")
        body = worker[worker.index("def build("):]

        unsolved: list[str] = []
        for match in re.finditer(r"(label_for|backed_label)\(", body):
            call = body[match.start():match.start() + 320]
            # Two label kinds are deliberately renderer-owned rather than
            # solved, and are modelled as fixed obstacles instead:
            #   - tick numbers      -> _number_line_decoration_boxes
            #   - the formula card  -> _FORMULA_CARD_CENTER
            if "tick_values[tick_index]" in call or "3.35, 0.25" in call:
                continue
            if "placed(" not in call:
                line = body[:match.start()].count("\n") + body[:worker.index("def build(")].count("\n") + 1
                unsolved.append(f"line ~{line}: {call.splitlines()[0]}")
        self.assertEqual(unsolved, [], "worker labels bypassing the placement solver")

    def test_number_line_tick_row_is_an_obstacle(self) -> None:
        """The row of tick numbers is drawn by the element, not solved.

        Regression: it was invisible to the solver, so the whole strip under a
        number line scored as free space and a caption was placed on top of the
        tick "3" in a live Hebrew render.
        """
        line = {"type": "number_line", "color": "ink", "position": [0, 0],
                "range": [0, 10, 1], "marks": [3, 3.4, 8]}
        transform = build_transform([line])
        obstacles = collect_obstacles([line], transform)

        tick_y = transform.apply([3, 0])[1] - _NUMBER_LINE_TICK_DROP
        probe = Box(transform.apply([3, 0])[0], tick_y, *text_extent("3", _NUMBER_LINE_TICK_FONT_SIZE))
        self.assertGreater(
            obstacles.collides(probe), 0.0,
            "the tick row does not repel labels",
        )
        for mark in (3, 3.4, 8):
            cx, cy = transform.apply([mark, 0])
            dot = Box(cx, cy, _MARK_DOT_RADIUS * 2, _MARK_DOT_RADIUS * 2)
            self.assertGreater(obstacles.collides(dot), 0.0, f"mark {mark} does not repel labels")

    def test_caption_is_pushed_off_the_tick_row(self) -> None:
        """End to end: the exact failure from the render, solved."""
        elements = [
            {"type": "number_line", "color": "ink", "position": [0, 0],
             "range": [0, 10, 1], "marks": [3, 3.4, 8], "label": "מדידות"},
            # Sits squarely in the tick row, which is where the planner put it.
            {"type": "text", "color": "success", "position": [3.2, -0.4], "label": "קרובות"},
        ]
        scene = solve_scene_layout(_scene(elements))
        transform = build_transform(scene["elements"])
        solved = scene["elements"][1]["layout"]["position"]
        box = Box(solved[0], solved[1], *text_extent("קרובות", 28))
        for tick in _number_line_decoration_boxes(scene["elements"][0], transform):
            self.assertEqual(box.overlap(tick), 0.0, "caption is still covering a tick number")

    def test_tick_selection_matches_the_renderer(self) -> None:
        """Model the ticks the worker PRINTS, not every tick it could print.

        Over-modelling is as wrong as under-modelling: a thinned-away tick that
        the solver still avoids sterilises space that is actually empty.
        """
        worker = (backend_root / "app" / "agents" / "manim_worker.py").read_text(encoding="utf-8")
        self.assertIn("widest_chars * 0.12 + 0.16", worker, "tick stride formula moved")
        self.assertIn("np.array([0, -0.42, 0])", worker, "tick label drop moved")
        self.assertIn("radius=0.11", worker, "mark dot radius moved")
        self.assertIn(f'"muted",\n                            {_NUMBER_LINE_TICK_FONT_SIZE},', worker)

        # 101 ticks cannot all fit across the frame, so the worker strides them
        # — but marks are semantic and are labelled regardless.
        line = {"type": "number_line", "color": "ink", "position": [0, 0],
                "range": [0, 100, 1], "marks": [12, 47]}
        transform = build_transform([line])
        printed = [text for _, text in _number_line_tick_labels(line, transform)]
        self.assertIn("12", printed, "a marked value must always be labelled")
        self.assertIn("47", printed, "a marked value must always be labelled")
        self.assertLess(len(printed), 101, "every tick was labelled; the stride was not applied")
        self.assertGreater(len(printed), 4, "the stride thinned the line down to nothing")

        # A span that DOES fit keeps every tick — over-thinning would sterilise
        # space the solver could otherwise use.
        narrow = {"type": "number_line", "color": "ink", "position": [0, 0],
                  "range": [0, 10, 1], "marks": [3]}
        every = [text for _, text in _number_line_tick_labels(narrow, build_transform([narrow]))]
        self.assertEqual(len(every), 11, "a line with room lost tick labels")

    def test_two_labels_at_the_same_spot_are_separated(self) -> None:
        elements = [
            {"type": "text", "color": "ink", "position": [0, 0], "label": "first"},
            {"type": "text", "color": "ink", "position": [0, 0], "label": "second"},
        ]
        scene = solve_scene_layout(_scene(elements))
        a = scene["elements"][0]["layout"]["position"]
        b = scene["elements"][1]["layout"]["position"]
        box_a = Box(a[0], a[1], *text_extent("first"))
        box_b = Box(b[0], b[1], *text_extent("second"))
        self.assertEqual(box_a.overlap(box_b), 0.0, "coincident labels were not separated")

    def test_a_deliberate_caption_position_is_kept_when_it_works(self) -> None:
        """A hint that collides with nothing must survive — captions are intentional."""
        elements = [
            {"type": "polygon", "color": "primary", "points": [[-1, -1], [1, -1], [1, 1]]},
            {"type": "text", "color": "ink", "position": [-2.0, 1.7], "label": "שטח"},
        ]
        scene = solve_scene_layout(_scene(elements))
        transform = build_transform(scene["elements"])
        expected = transform.apply([-2.0, 1.7])
        # Guard the premise: a hint is only honoured when it is actually usable.
        self.assertLess(abs(expected[1]), FRAME_Y, "test hint is off-canvas")
        solved = scene["elements"][1]["layout"]["position"]
        self.assertAlmostEqual(solved[0], expected[0], places=3)
        self.assertAlmostEqual(solved[1], expected[1], places=3)

    def test_labels_never_leave_the_safe_frame(self) -> None:
        elements = [
            {"type": "point", "color": "primary", "points": [[6.4, 3.2]], "label": "corner"},
        ]
        scene = solve_scene_layout(_scene(elements))
        solved = scene["elements"][0]["layout"]["label"]
        width, height = text_extent("corner", 26)
        self.assertLessEqual(abs(solved[0]) + width / 2, FRAME_X)
        self.assertLessEqual(abs(solved[1]) + height / 2, FRAME_Y)

    def test_solving_is_deterministic(self) -> None:
        first = solve_scene_layout(_scene(list(PYTHAGORAS)))["elements"][0]["layout"]
        second = solve_scene_layout(_scene(list(PYTHAGORAS)))["elements"][0]["layout"]
        self.assertEqual(first, second)

    def test_circle_label_sits_on_the_rim_not_the_centre(self) -> None:
        """A centred label reads as naming the centre point, not the circle."""
        scene = solve_scene_layout(_scene([
            {"type": "circle", "color": "primary", "center": [0, 0], "radius": 2.2, "label": "r=2.2"},
            {"type": "point", "color": "accent", "points": [[0, 0]], "label": "O"},
        ]))
        transform = build_transform(scene["elements"])
        centre = transform.apply([0, 0])
        radius = 2.2 * transform.scale_y
        solved = scene["elements"][0]["layout"]["label"]
        self.assertGreater(
            math.dist(solved, centre), radius * 0.5,
            "circle label was placed near the centre instead of the rim",
        )

    def test_circle_label_stays_in_frame_for_a_large_circle(self) -> None:
        """The renderer's own offset (centre + radius + 0.35) rendered off-screen."""
        scene = solve_scene_layout(_scene([
            {"type": "circle", "color": "primary", "center": [0, 0], "radius": 2.2, "label": "r=2.2"},
            {"type": "line", "color": "secondary", "points": [[0, 0], [2.2, 0]], "label": "רדיוס"},
        ]))
        self.assertEqual([v for v in check_layout(scene) if v.kind == "off_canvas"], [])

    def test_line_label_avoids_the_midpoint_but_a_brace_keeps_it(self) -> None:
        scene = solve_scene_layout(_scene([
            {"type": "line", "color": "primary", "points": [[-4, 1], [4, 1]], "label": "m"},
            {"type": "brace", "color": "ink", "points": [[-4, -2], [4, -2]], "label": "8"},
        ]))
        transform = build_transform(scene["elements"])
        line_mid_x = transform.apply([0, 1])[0]
        brace_mid_x = transform.apply([0, -2])[0]
        self.assertGreater(
            abs(scene["elements"][0]["layout"]["label"][0] - line_mid_x), 1.0,
            "line label is parked at the midpoint, where diagrams are busiest",
        )
        self.assertLess(
            abs(scene["elements"][1]["layout"]["label"][0] - brace_mid_x), 0.5,
            "a measuring brace must stay labelled at its midpoint",
        )

    def test_scene_without_labels_is_untouched(self) -> None:
        elements = [{"type": "line", "color": "primary", "points": [[-1, 0], [1, 0]]}]
        scene = solve_scene_layout(_scene(list(elements)))
        self.assertNotIn("layout", scene["elements"][0])


class AxisDecorationTests(unittest.TestCase):
    """Tick numbers and arrows are drawn by the worker outside build()."""

    def test_curve_label_avoids_the_axis_arrow_and_last_tick(self) -> None:
        sine = [[x / 4 - 6.28, math.sin(x / 4 - 6.28)] for x in range(51)]
        scene = solve_scene_layout(_scene([
            {"type": "axes", "color": "ink", "position": [0, 0],
             "x_range": [-6.28, 6.28, 1.57], "y_range": [-1.5, 1.5, 0.5],
             "x_label": "x", "y_label": "y"},
            {"type": "polyline", "color": "primary", "points": sine, "label": "y=sin(x)"},
        ]))
        elements = scene["elements"]
        transform = build_transform(elements)
        solved = elements[1]["layout"]["label"]
        box = Box(solved[0], solved[1], *text_extent("y=sin(x)", 24))

        axis_end = transform.apply([6.28, 0])
        arrow = Box(axis_end[0] + 0.16, axis_end[1], 0.32, 0.26)
        self.assertEqual(box.overlap(arrow), 0.0, "curve label sits on the x-axis arrow")

        last_tick = transform.apply([6.28, 0])
        tick_box = Box(last_tick[0], last_tick[1] - 0.28, *text_extent("6.28", 17))
        self.assertEqual(box.overlap(tick_box), 0.0, "curve label sits on the last tick number")

    def test_axes_contribute_tick_and_arrow_obstacles(self) -> None:
        transform = build_transform(PARABOLA)
        without = collect_obstacles([e for e in PARABOLA if e["type"] != "axes"], transform)
        with_axes = collect_obstacles(PARABOLA, transform)
        self.assertGreater(
            len(with_axes.boxes), len(without.boxes),
            "axes contributed no tick/arrow boxes",
        )


class ObstacleTests(unittest.TestCase):
    def test_polygon_contributes_a_closed_ring(self) -> None:
        transform = build_transform(PYTHAGORAS)
        obstacles = collect_obstacles(PYTHAGORAS, transform)
        # 3 triangle edges + 2 right-angle rays.
        self.assertGreaterEqual(len(obstacles.segments), 5)

    def test_axes_contribute_both_axis_lines(self) -> None:
        transform = build_transform(PARABOLA)
        obstacles = collect_obstacles(PARABOLA, transform)
        self.assertGreaterEqual(len(obstacles.segments), 2)


class FuzzTests(unittest.TestCase):
    """Generic-case coverage: random valid scenes must still satisfy the invariants.

    Hand-written cases test the failures we anticipated.  This tests the ones we
    did not — it is the operational meaning of "works on any generic case".
    """

    ALPHABET = ["A", "B", "C", "x", "y", "3", "4.5", "יתר", "زاوية", "y=x²", "12.75"]

    def _random_scene(self, rng: random.Random) -> dict:
        elements: list[dict] = []
        for _ in range(rng.randint(1, 6)):
            kind = rng.choice(["polygon", "line", "point", "circle", "text", "polyline", "rectangle"])
            def coord() -> list[float]:
                return [round(rng.uniform(-6.0, 6.0), 2), round(rng.uniform(-3.2, 3.2), 2)]

            if kind == "polygon":
                elements.append({
                    "type": "polygon", "color": "primary",
                    "points": [coord() for _ in range(rng.randint(3, 5))],
                    "labels": [rng.choice(self.ALPHABET) for _ in range(3)],
                    "side_labels": [rng.choice(self.ALPHABET) for _ in range(3)],
                    "fill_opacity": 0.08,
                })
            elif kind in {"line", "polyline"}:
                elements.append({
                    "type": kind, "color": "primary",
                    "points": [coord() for _ in range(2 if kind == "line" else rng.randint(2, 8))],
                    "label": rng.choice(self.ALPHABET),
                })
            elif kind == "point":
                elements.append({
                    "type": "point", "color": "accent",
                    "points": [coord()], "label": rng.choice(self.ALPHABET),
                })
            elif kind == "circle":
                elements.append({
                    "type": "circle", "color": "primary",
                    "center": coord(), "radius": round(rng.uniform(0.3, 2.5), 2),
                    "label": rng.choice(self.ALPHABET),
                })
            elif kind == "rectangle":
                elements.append({
                    "type": "rectangle", "color": "primary", "center": coord(),
                    "width": round(rng.uniform(0.5, 4.0), 2),
                    "height": round(rng.uniform(0.5, 3.0), 2),
                    "label": rng.choice(self.ALPHABET), "fill_opacity": 0.08,
                })
            else:
                elements.append({
                    "type": "text", "color": "ink",
                    "position": coord(), "label": rng.choice(self.ALPHABET),
                })
        return _scene(elements)

    # Violations the solver is responsible for. `anchor_off_canvas` is excluded
    # deliberately: it means the planner put a caption outside the frame, which
    # the renderer would also draw off-screen — no placement can rescue it.
    SOLVER_OWNED = {"unplaced", "off_canvas", "label_overlap", "far_from_anchor"}

    def test_random_scenes_satisfy_the_layout_invariants(self) -> None:
        rng = random.Random(20260727)   # fixed seed: a failure is reproducible
        failures: list[tuple[int, list]] = []
        for case in range(400):
            scene = solve_scene_layout(self._random_scene(rng))
            violations = [v for v in check_layout(scene) if v.kind in self.SOLVER_OWNED]
            if violations:
                failures.append((case, violations))
        self.assertEqual(
            failures[:5], [],
            f"{len(failures)}/400 fuzzed scenes violated layout invariants",
        )

    def test_off_canvas_anchors_are_reported_rather_than_silently_dropped(self) -> None:
        """A caption far from its geometry must still surface as a problem."""
        scene = solve_scene_layout(_scene([
            {"type": "polygon", "color": "primary", "points": [[0, 0], [0.4, 0], [0.4, 0.4]]},
            # A text position is not part of the renderer's fit, so a caption
            # parked far from the geometry really does land off-screen.
            {"type": "text", "color": "ink", "position": [40, 40], "label": "רחוק"},
        ]))
        kinds = {v.kind for v in check_layout(scene)}
        self.assertIn("anchor_off_canvas", kinds)

    def test_every_fuzzed_label_is_placed(self) -> None:
        rng = random.Random(11)
        for _ in range(200):
            scene = solve_scene_layout(self._random_scene(rng))
            transform = build_transform(scene["elements"])
            requests = collect_label_requests(scene["elements"], transform)
            for request in requests:
                layout = scene["elements"][request.element_index].get("layout") or {}
                self.assertIn(request.slot, layout)


if __name__ == "__main__":
    unittest.main()
