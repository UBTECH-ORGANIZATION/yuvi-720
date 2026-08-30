"""Deterministic quality checks for safe Coach geometry normalization."""

from __future__ import annotations

import base64
import math
import unittest
import unittest.mock

from app.agents.manim_visual import (
    build_scene_visual,
    render_visual,
    split_visual_response,
    _svg_fallback,
    _visual_benefit_signal,
    sanitize_scene,
)
from app.agents.visuals.maths import (
    canonical_function_scene as _canonical_function_scene,
    canonical_midpoint_scene as _canonical_midpoint_scene,
    canonical_similar_triangles_scene as _canonical_similar_triangles_scene,
    ensure_parallel_angle_markers as _ensure_parallel_angle_markers,
    normalize_identity_line as _normalize_identity_line,
    normalize_safe_function_graph as _normalize_safe_function_graph,
)


class VisualIntentTests(unittest.TestCase):
    def test_visual_is_placed_after_a_complete_numbered_list(self) -> None:
        response = (
            "אפשר לפרק את העבודה כך:\n\n"
            "1. להבין מה צריך להגיש.\n\n"
            "2. לחלק לחלקים קטנים.\n\n"
            "3. לעשות חלק אחד בכל פעם."
        )

        text_before, text_after = split_visual_response(response)

        self.assertEqual(text_before, response)
        self.assertEqual(text_after, "")

    def test_duplicate_diagram_is_removed_without_splitting_the_reply(self) -> None:
        response = (
            "פתיח קצר.\n\n"
            "```yuvi-diagram\n{\"kind\":\"cycle\"}\n```\n\n"
            "1. שלב ראשון.\n2. שלב שני.\n3. שלב שלישי."
        )

        text_before, text_after = split_visual_response(response)

        self.assertEqual(
            text_before,
            "פתיח קצר.\n\n1. שלב ראשון.\n2. שלב שני.\n3. שלב שלישי.",
        )
        self.assertEqual(text_after, "")

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

class RenderRoutingTests(unittest.IsolatedAsyncioTestCase):
    """Still images render in the browser; only video still costs a subprocess."""

    STILL = {
        "use_visual": True,
        "elements": [
            {"type": "polygon", "color": "primary",
             "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
             "labels": ["A", "B", "C"], "side_labels": ["4", "3", "יתר"],
             "fill_opacity": 0.08},
        ],
    }

    async def test_still_scene_skips_manim_entirely(self) -> None:
        scene = sanitize_scene(dict(self.STILL))
        assert scene is not None
        visual = await render_visual(scene)
        self.assertEqual(visual["type"], "scene")
        self.assertEqual(visual["renderer"], "mafs")
        self.assertEqual(visual["scene"], scene)

    async def test_animated_scene_still_goes_to_manim(self) -> None:
        """Guard the split: video must not silently become a client render."""
        scene = sanitize_scene({**self.STILL, "animated": True})
        assert scene is not None
        self.assertTrue(scene["animated"])
        calls: list[dict] = []

        async def fake_manim(spec: dict) -> dict:
            calls.append(spec)
            return {"type": "video", "renderer": "manim"}

        with unittest.mock.patch("app.agents.manim_visual.render_manim_visual", fake_manim):
            visual = await render_visual(scene)
        self.assertEqual(len(calls), 1, "animated scene did not reach the Manim renderer")
        self.assertEqual(visual["type"], "video")

    def test_scene_payload_carries_an_svg_fallback(self) -> None:
        """If the client renderer throws, the <img> must still show the diagram."""
        scene = sanitize_scene(dict(self.STILL))
        assert scene is not None
        visual = build_scene_visual(scene)
        self.assertTrue(visual["data_url"].startswith("data:image/svg+xml;base64,"))
        decoded = base64.b64decode(visual["data_url"].split(",", 1)[1]).decode("utf-8")
        self.assertIn("<svg", decoded)
        self.assertIn("יתר", decoded)

    def test_scene_payload_carries_the_solved_layout(self) -> None:
        """The client renderer must inherit the same placement as the video."""
        scene = sanitize_scene(dict(self.STILL))
        assert scene is not None
        visual = build_scene_visual(scene)
        self.assertIn("layout", visual["scene"]["elements"][0])


class InteractivityTests(unittest.TestCase):
    """Handles are additive, validated, and never load-bearing."""

    TRIANGLE = {
        "use_visual": True,
        "elements": [
            {"type": "polygon", "color": "primary",
             "points": [[-2, -1.5], [2, -1.5], [2, 1.5]],
             "labels": ["A", "B", "C"], "side_labels": ["4", "3", "5"]},
            {"type": "point", "color": "accent", "points": [[0, 2]], "label": "P"},
        ],
    }

    def test_valid_handles_survive(self) -> None:
        scene = sanitize_scene({**self.TRIANGLE,
                                "interactive": {"handles": [{"element": 0, "vertex": 2},
                                                            {"element": 1}]}})
        assert scene is not None
        self.assertEqual(
            scene["interactive"]["handles"],
            [{"element": 0, "vertex": 2}, {"element": 1}],
        )

    def test_a_polygon_handle_needs_a_valid_vertex(self) -> None:
        for vertex in (9, -1, "2", None):
            with self.subTest(vertex=vertex):
                scene = sanitize_scene({**self.TRIANGLE,
                                        "interactive": {"handles": [{"element": 0, "vertex": vertex}]}})
                assert scene is not None
                self.assertNotIn("interactive", scene)

    def test_handles_on_undraggable_kinds_are_dropped(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [{"type": "line", "color": "primary", "points": [[-1, 0], [1, 0]]}],
            "interactive": {"handles": [{"element": 0}]},
        })
        assert scene is not None
        self.assertNotIn("interactive", scene)

    def test_handle_indices_follow_dropped_elements(self) -> None:
        """The planner indexes its own array; invalid elements shift everything."""
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {"type": "polygon", "color": "primary", "points": [[0, 0]]},   # too few points
                {"type": "point", "color": "accent", "points": [[1, 1]], "label": "P"},
            ],
            "interactive": {"handles": [{"element": 1}]},
        })
        assert scene is not None
        self.assertEqual(scene["interactive"]["handles"], [{"element": 0}])

    def test_handles_are_capped(self) -> None:
        scene = sanitize_scene({**self.TRIANGLE, "interactive": {
            "handles": [{"element": 0, "vertex": i % 3} for i in range(12)]}})
        assert scene is not None
        self.assertLessEqual(len(scene["interactive"]["handles"]), 4)

    def test_duplicate_handles_are_collapsed(self) -> None:
        scene = sanitize_scene({**self.TRIANGLE, "interactive": {
            "handles": [{"element": 0, "vertex": 1}, {"element": 0, "vertex": 1}]}})
        assert scene is not None
        self.assertEqual(len(scene["interactive"]["handles"]), 1)

    def test_junk_interactive_blocks_are_ignored(self) -> None:
        for junk in ("yes", 5, [], {"handles": "all"}, {"handles": [7]}):
            with self.subTest(junk=junk):
                scene = sanitize_scene({**self.TRIANGLE, "interactive": junk})
                assert scene is not None
                self.assertNotIn("interactive", scene)

    def test_an_interactive_scene_still_renders_statically(self) -> None:
        """The degradation guarantee: handles must never be load-bearing."""
        interactive = sanitize_scene({**self.TRIANGLE,
                                      "interactive": {"handles": [{"element": 0, "vertex": 2}]}})
        plain = sanitize_scene(dict(self.TRIANGLE))
        assert interactive is not None and plain is not None
        self.assertEqual(interactive["elements"], plain["elements"])
        self.assertEqual(interactive["canvas"], plain["canvas"])


class MoleculeTests(unittest.TestCase):
    """RDKit is the gate: an unparseable SMILES is not a molecule."""

    def _scene(self, **element):
        return sanitize_scene({
            "use_visual": True,
            "elements": [{"type": "molecule", "color": "primary", **element}],
        })

    def test_a_real_molecule_is_verified_and_enriched(self) -> None:
        scene = self._scene(smiles="CC(=O)Oc1ccccc1C(=O)O", label="אספירין")
        assert scene is not None
        element = scene["elements"][0]
        self.assertEqual(element["formula"], "C9H8O4")
        self.assertAlmostEqual(element["mass"], 180.16, places=2)
        self.assertEqual(element["label"], "אספירין")
        self.assertEqual(scene["render"], "molecule")

    def test_smiles_is_canonicalised(self) -> None:
        """The same molecule written two ways must compare and cache as one."""
        a = self._scene(smiles="OCC")
        b = self._scene(smiles="CCO")
        assert a is not None and b is not None
        self.assertEqual(a["elements"][0]["smiles"], b["elements"][0]["smiles"])

    def test_unparseable_smiles_never_becomes_a_visual(self) -> None:
        for bad in ("C1CC", "not a molecule", "", "   ", "[[[", "C" * 500):
            with self.subTest(smiles=bad):
                self.assertIsNone(self._scene(smiles=bad))

    def test_non_string_smiles_is_rejected(self) -> None:
        for bad in (None, 42, ["CCO"], {"smiles": "CCO"}):
            with self.subTest(smiles=bad):
                self.assertIsNone(self._scene(smiles=bad))

    def test_absurdly_large_molecules_are_rejected(self) -> None:
        self.assertIsNone(self._scene(smiles="C" * 120))

    def test_substructure_highlight_resolves_to_atom_indices(self) -> None:
        scene = self._scene(smiles="CC(=O)O", highlight="C(=O)O")
        assert scene is not None
        self.assertTrue(scene["elements"][0]["highlight"])
        self.assertTrue(all(isinstance(i, int) for i in scene["elements"][0]["highlight"]))

    def test_a_bad_highlight_does_not_invalidate_the_molecule(self) -> None:
        scene = self._scene(smiles="CCO", highlight="!!!not a pattern!!!")
        assert scene is not None
        self.assertNotIn("highlight", scene["elements"][0])
        self.assertEqual(scene["elements"][0]["formula"], "C2H6O")

    def test_view_defaults_to_2d_and_only_accepts_3d(self) -> None:
        self.assertEqual(self._scene(smiles="C")["elements"][0]["view"], "2d")
        self.assertEqual(self._scene(smiles="C", view="3d")["elements"][0]["view"], "3d")
        self.assertEqual(self._scene(smiles="C", view="hologram")["elements"][0]["view"], "2d")

    def test_render_discriminator_follows_what_survived_validation(self) -> None:
        """A scene whose only molecule was rejected is not a molecule scene."""
        scene = sanitize_scene({
            "use_visual": True,
            "render": "molecule",
            "elements": [
                {"type": "molecule", "color": "primary", "smiles": "C1CC"},   # invalid
                {"type": "point", "color": "primary", "points": [[0, 0]], "label": "P"},
            ],
        })
        assert scene is not None
        self.assertEqual(scene["render"], "geometry")
        self.assertEqual([e["type"] for e in scene["elements"]], ["point"])

    def test_molecule_scenes_skip_the_geometry_solver(self) -> None:
        scene = self._scene(smiles="CCO", label="אתנול")
        assert scene is not None
        self.assertNotIn("layout", scene["elements"][0])
        self.assertNotIn("canvas", scene)
