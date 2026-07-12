"""Deterministic quality checks for safe Coach geometry normalization."""

from __future__ import annotations

import math
import unittest

from app.agents.manim_visual import (
    _canonical_function_scene,
    _canonical_midpoint_scene,
    _canonical_similar_triangles_scene,
    _ensure_parallel_angle_markers,
    _normalize_identity_line,
    _normalize_safe_function_graph,
    _svg_fallback,
    _visual_benefit_signal,
    sanitize_scene,
)


class VisualIntentTests(unittest.TestCase):
    def test_implicit_relationships_are_visual_candidates_without_draw_word(self) -> None:
        self.assertTrue(_visual_benefit_signal("למה y=x עולה באותו יחס?", "he"))
        self.assertTrue(_visual_benefit_signal("Explain how the parts change between steps", "en"))
        self.assertTrue(_visual_benefit_signal("كيف تتغير النسبة بين النقطتين؟", "ar"))
        self.assertFalse(_visual_benefit_signal("תודה, הבנתי", "he"))

    def test_scene_title_and_repeated_text_are_not_rendered_as_overlays(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "title": "הקשר בין x ל-y",
            "elements": [
                {"type": "text", "position": [0, 2], "label": "הקשר בין x ל-y"},
                {"type": "text", "position": [0, 1], "label": "y=x"},
                {"type": "text", "position": [0, 0], "label": "y=x"},
            ],
        })
        self.assertIsNotNone(scene)
        assert scene is not None
        self.assertEqual([item["label"] for item in scene["elements"]], ["y=x"])

    def test_recognized_identity_has_a_deterministic_first_turn_visual(self) -> None:
        scene = _canonical_function_scene(
            "למה x=y הוא אותו ישר כמו y=x, ואיך הנקודות השלמות מ-0 עד 5 קשורות לזה?",
            "he",
        )
        self.assertIsNotNone(scene)
        assert scene is not None
        graph = next(item for item in scene["elements"] if item["type"] == "polyline")
        self.assertTrue(all(abs(x - y) < 1e-9 for x, y in graph["points"]))
        self.assertEqual(len([item for item in scene["elements"] if item["type"] == "point"]), 6)

    def test_unknown_expression_does_not_get_a_canonical_visual(self) -> None:
        self.assertIsNone(_canonical_function_scene("תודה, הבנתי", "he"))

    def test_midpoint_demo_request_has_a_deterministic_visual(self) -> None:
        scene = _canonical_midpoint_scene(
            "סמן את A=(1,1), B=(5,3), ואת נקודת האמצע M=(3,2)",
            "he",
        )
        self.assertIsNotNone(scene)
        assert scene is not None
        points = [item["points"][0] for item in scene["elements"] if item["type"] == "point"]
        self.assertEqual(points, [[1.0, 1.0], [5.0, 3.0], [3.0, 2.0]])

    def test_parallel_transversal_gets_missing_alternate_angle_markers(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {"type": "line", "points": [[-5, 1.4], [5, 1.4]]},
                {"type": "line", "points": [[-5, -1.4], [5, -1.4]]},
                {"type": "line", "points": [[-3, 3], [2, -3]]},
            ],
        })
        self.assertIsNotNone(scene)
        assert scene is not None
        _ensure_parallel_angle_markers(
            scene,
            "שני ישרים מקבילים וישר שלישי שחוצה אותם; סמן זוויות מתחלפות",
            "he",
        )
        angles = [item for item in scene["elements"] if item["type"] == "angle"]
        self.assertEqual(len(angles), 2)
        self.assertEqual([item["label"] for item in angles], ["α", "α"])

    def test_similar_triangle_request_has_a_deterministic_scale_diagram(self) -> None:
        scene = _canonical_similar_triangles_scene("צור שרטוט של שני משולשים דומים", "he")
        self.assertIsNotNone(scene)
        assert scene is not None
        triangles = [item for item in scene["elements"] if item["type"] == "polygon"]
        self.assertEqual(len(triangles), 2)
        side_lengths = lambda triangle: sorted(
            math.dist(point, triangle["points"][(index + 1) % 3])
            for index, point in enumerate(triangle["points"])
        )
        first = side_lengths(triangles[0])
        second = side_lengths(triangles[1])
        self.assertTrue(all(abs(second[index] / first[index] - 1.5) < 1e-9 for index in range(3)))


class TriangleLayoutTests(unittest.TestCase):
    def test_side_roles_and_measures_are_bound_to_correct_edges(self) -> None:
        scene = sanitize_scene(
            {
                "use_visual": True,
                "title": "סינוס במשולש ישר־זווית",
                "elements": [
                    {
                        "type": "polygon",
                        "points": [[-4, -2], [-4, 1], [0, -2]],
                        "side_labels": ["3", "", "5"],
                    },
                    {"type": "text", "position": [-4.8, -0.5], "label": "מול"},
                    {"type": "text", "position": [-2.2, -2.5], "label": "ליד"},
                    {"type": "text", "position": [-1.8, -0.2], "label": "sin(θ)=3/5"},
                ],
            }
        )

        self.assertIsNotNone(scene)
        assert scene is not None
        triangle = scene["elements"][0]
        self.assertEqual(triangle["side_labels"], ["מול 3", "5", "ליד 4"])
        free_text = [item["label"] for item in scene["elements"] if item["type"] == "text"]
        self.assertEqual(free_text, ["sin(θ)=3/5"])

        svg = _svg_fallback(scene).decode("utf-8")
        self.assertIn('class="formula-label"', svg)
        self.assertIn('data-edge-index="0">מול 3</text>', svg)
        self.assertIn('data-edge-index="1">5</text>', svg)
        self.assertIn('data-edge-index="2">ליד 4</text>', svg)


class IdentityLineTests(unittest.TestCase):
    def _scene(self) -> dict:
        scene = sanitize_scene(
            {
                "use_visual": True,
                "title": "Identity line",
                "elements": [
                    {
                        "type": "axes",
                        "position": [0, 0],
                        "x_range": [0, 5, 1],
                        "y_range": [0, 5, 1],
                        "x_label": "x",
                        "y_label": "y",
                    },
                    {
                        "type": "polyline",
                        "points": [[0, 5], [2, 1], [5, 0]],
                        "label": "x=y",
                    },
                ],
            }
        )
        self.assertIsNotNone(scene)
        assert scene is not None
        return scene

    def test_equivalent_identity_equations_get_ordered_xy_points(self) -> None:
        for request in ("צייר את x=y", "plot y = x"):
            with self.subTest(request=request):
                scene = self._scene()
                _normalize_identity_line(scene, request)
                graph = next(item for item in scene["elements"] if item["type"] == "polyline")
                self.assertEqual(graph["label"], "y=x")
                self.assertEqual(len(graph["points"]), 17)
                self.assertTrue(all(x == y for x, y in graph["points"]))
                self.assertTrue(all(
                    graph["points"][index][0] < graph["points"][index + 1][0]
                    for index in range(len(graph["points"]) - 1)
                ))

    def test_identity_line_svg_is_a_rising_data_diagonal(self) -> None:
        scene = self._scene()
        _normalize_identity_line(scene, "גרף x = y")
        svg = _svg_fallback(scene).decode("utf-8")
        self.assertIn('points="160.0,460.0', svg)
        self.assertIn('800.0,80.0"', svg)
        self.assertIn('>y=x</text>', svg)


class SafeFunctionGraphTests(unittest.TestCase):
    def test_quadratic_request_replaces_incorrect_model_polyline(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {
                    "type": "axes",
                    "position": [0, 0],
                    "x_range": [-3.5, 3.5, 1],
                    "y_range": [-1, 10, 1],
                },
                {
                    "type": "polyline",
                    "points": [[-3, -3], [0, 0], [3, 3]],
                    "label": "y=x",
                },
            ],
        })
        self.assertIsNotNone(scene)
        assert scene is not None

        _normalize_safe_function_graph(scene, "צור גרף של y=x^2")

        graph = next(item for item in scene["elements"] if item["type"] == "polyline")
        self.assertEqual(graph["label"], "y=x^2")
        self.assertGreaterEqual(len(graph["points"]), 20)
        self.assertTrue(all(abs(y - x * x) < 1e-9 for x, y in graph["points"]))
        self.assertIn("פרבולה", scene["caption"])

    def test_sine_normalization_supplies_localized_concept_caption(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "caption": "נקודות דגימה לאורך הגרף.",
            "elements": [
                {
                    "type": "axes",
                    "position": [0, 0],
                    "x_range": [-6.5, 6.5, 1],
                    "y_range": [-1.5, 1.5, 0.5],
                },
                {"type": "polyline", "points": [[-1, -1], [0, 0], [1, 1]]},
            ],
        })
        self.assertIsNotNone(scene)
        assert scene is not None

        _normalize_safe_function_graph(scene, "צור גרף של y=sin(x)", "he")

        self.assertIn("סינוס", scene["caption"])
        self.assertIn("מחזור", scene["caption"])

    def test_unapproved_expression_is_not_evaluated_or_rewritten(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {
                    "type": "axes",
                    "position": [0, 0],
                    "x_range": [-3, 3, 1],
                    "y_range": [-3, 3, 1],
                },
                {"type": "polyline", "points": [[-1, -1], [1, 1]], "label": "original"},
            ],
        })
        self.assertIsNotNone(scene)
        assert scene is not None

        _normalize_safe_function_graph(scene, "plot y=__import__('os').system('echo unsafe')")

        graph = next(item for item in scene["elements"] if item["type"] == "polyline")
        self.assertEqual(graph["label"], "original")
        self.assertEqual(graph["points"], [[-1.0, -1.0], [1.0, 1.0]])


if __name__ == "__main__":
    unittest.main()