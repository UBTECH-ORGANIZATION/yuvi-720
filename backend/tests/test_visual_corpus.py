"""Run the entire visual case matrix through the real pipeline.

This is the "works on any generic case" layer. `test_visual_layout` proves the
solver's properties on scenes built for it; this proves them on the scenes the
planner actually emits, in every language, in both modes, plus the adversarial
block — and it does so through `sanitize_scene`, so normalizers, the fit, the
molecule gate and the layout solver are all exercised together.

It stays in the fast suite deliberately: no Manim, no browser, no network. A
regression in label placement should fail in seconds on every commit, not be
discovered in a rendered MP4.
"""

from __future__ import annotations

import unittest

from app.agents.manim_visual import sanitize_scene
from app.agents.visual_layout import (
    FRAME_X, FRAME_Y, Box, check_layout, collect_label_requests,
)
from tests.visual_corpus import CORPUS


# Violations the placement solver is answerable for. `anchor_off_canvas` is
# excluded: it means the planner named something outside the frame, which no
# placement can rescue (see visual_layout.check_layout).
SOLVER_OWNED = {"unplaced", "off_canvas", "label_overlap", "far_from_anchor"}


class CorpusShapeTests(unittest.TestCase):
    """Every case must be handled — accepted cleanly or refused cleanly."""

    def test_corpus_covers_its_axes(self) -> None:
        languages = {tag for case in CORPUS for tag in case.tags} & {"he", "ar", "en"}
        modes = {tag for case in CORPUS for tag in case.tags} & {"still", "video"}
        self.assertEqual(languages, {"he", "ar", "en"})
        self.assertEqual(modes, {"still", "video"})
        self.assertGreaterEqual(len(CORPUS), 90, "corpus has shrunk below its intended breadth")

    def test_every_case_is_handled_without_raising(self) -> None:
        for case in CORPUS:
            with self.subTest(case=case.id):
                scene = sanitize_scene(case.raw)
                if case.expect_visual:
                    self.assertIsNotNone(scene, "pipeline refused a case it should have drawn")
                else:
                    self.assertIsNone(scene, "pipeline drew a case it should have refused")

    def test_accepted_scenes_are_structurally_complete(self) -> None:
        for case in CORPUS:
            if not case.expect_visual:
                continue
            with self.subTest(case=case.id):
                scene = sanitize_scene(case.raw)
                assert scene is not None
                self.assertTrue(scene["elements"], "accepted a scene with no elements")
                self.assertIn(scene["render"], {"geometry", "molecule", "diagram"})
                self.assertIsInstance(scene["animated"], bool)
                for element in scene["elements"]:
                    self.assertIn("type", element)
                    self.assertIn("color", element)

    def test_animated_flag_is_honoured(self) -> None:
        """The still/video split drives which renderer runs — it must not drift."""
        for case in CORPUS:
            if "topic" not in case.tags:
                continue
            with self.subTest(case=case.id):
                scene = sanitize_scene(case.raw)
                assert scene is not None
                self.assertEqual(scene["animated"], "video" in case.tags)


class CorpusLayoutTests(unittest.TestCase):
    """The placement guarantee, over the whole matrix."""

    def test_no_case_violates_the_layout_invariants(self) -> None:
        failures: list[tuple[str, list[str]]] = []
        for case in CORPUS:
            scene = sanitize_scene(case.raw)
            # Deliberately NOT filtered by render mode: filtering on
            # `render == "geometry"` is exactly what hid a scene whose geometry
            # label was never solved because the scene contained a molecule.
            if scene is None:
                continue
            bad = [f"{v.kind}: {v.detail}" for v in check_layout(scene) if v.kind in SOLVER_OWNED]
            if bad:
                failures.append((case.id, bad))
        self.assertEqual(failures, [], f"{len(failures)}/{len(CORPUS)} cases violated layout invariants")

    def test_every_label_stays_inside_the_frame(self) -> None:
        """Stated separately from the invariants: an off-frame label is invisible,
        which is the one failure a learner cannot work around."""
        for case in CORPUS:
            scene = sanitize_scene(case.raw)
            if scene is None:
                continue
            with self.subTest(case=case.id):
                for element in scene["elements"]:
                    for slot, position in (element.get("layout") or {}).items():
                        self.assertLessEqual(
                            abs(position[0]), FRAME_X,
                            f"{case.id} {slot} is off-frame horizontally",
                        )
                        self.assertLessEqual(
                            abs(position[1]), FRAME_Y,
                            f"{case.id} {slot} is off-frame vertically",
                        )

    def test_solved_layout_is_deterministic(self) -> None:
        """Same input, same picture — a prerequisite for golden comparisons."""
        for case in CORPUS:
            with self.subTest(case=case.id):
                first = sanitize_scene(case.raw)
                second = sanitize_scene(case.raw)
                self.assertEqual(first, second)

    def test_still_and_animated_twins_place_labels_identically(self) -> None:
        """One solver, both renderers: a video and its still must not disagree."""
        by_topic: dict[str, dict[str, dict]] = {}
        for case in CORPUS:
            if "topic" not in case.tags:
                continue
            topic_lang, _, mode = case.id.rpartition(".")
            scene = sanitize_scene(case.raw)
            if scene is not None:
                by_topic.setdefault(topic_lang, {})[mode] = scene

        compared = 0
        for topic_lang, modes in by_topic.items():
            if {"still", "video"} - modes.keys():
                continue
            with self.subTest(case=topic_lang):
                still_layout = [e.get("layout") for e in modes["still"]["elements"]]
                video_layout = [e.get("layout") for e in modes["video"]["elements"]]
                self.assertEqual(still_layout, video_layout)
                compared += 1
        self.assertGreater(compared, 0, "no still/video twins were compared")


class CorpusQualityTests(unittest.TestCase):
    """Softer properties: not correctness, but whether the output reads well."""

    def test_labels_are_not_crammed_against_each_other(self) -> None:
        """Non-overlap is the floor; readable output needs actual whitespace."""
        from app.agents.visual_layout import (
            LABEL_BREATHING_ROOM, build_transform, collect_label_requests,
        )

        crowded: list[str] = []
        for case in CORPUS:
            scene = sanitize_scene(case.raw)
            if scene is None:
                continue
            transform = build_transform(scene["elements"])
            boxes = []
            for request in collect_label_requests(scene["elements"], transform):
                position = (scene["elements"][request.element_index].get("layout") or {}).get(request.slot)
                if position is None:
                    continue
                width, height = request.extent()
                boxes.append(Box(position[0], position[1], width, height))
            for i, a in enumerate(boxes):
                for b in boxes[i + 1:]:
                    if a.overlap(b, pad=LABEL_BREATHING_ROOM * 0.5) > 0:
                        crowded.append(case.id)
                        break
        self.assertEqual(sorted(set(crowded)), [], "labels are touching without breathing room")

    def test_no_label_sits_on_renderer_drawn_text(self) -> None:
        """Tick numbers, axis names and mark dots are drawn by their element,
        never requested from the solver. Two pieces of text on the same pixels
        is unreadable regardless of which code path drew them, so the solver
        has to know about the ones it does not own — twice now it did not
        (a curve label over "6.28"; a caption over a number line's "3").

        Ground truth is built here from the element definitions rather than
        read back out of `collect_obstacles`, which is the function under test:
        sourcing both sides from it would make the assertion vacuous the moment
        a decoration stopped being registered.
        """
        from app.agents.visual_layout import (
            _axis_decoration_boxes, _number_line_decoration_boxes, build_transform,
        )

        def decorations_of(elements, transform) -> list[Box]:
            boxes: list[Box] = []
            for item in elements:
                if item["type"] == "number_line":
                    boxes.extend(_number_line_decoration_boxes(item, transform))
                elif item["type"] == "axes":
                    x0, x1, x_step = (float(v) for v in item["x_range"][:3])
                    y0, y1, y_step = (float(v) for v in item["y_range"][:3])
                    boxes.extend(_axis_decoration_boxes(
                        item, transform, (x0, x1, x_step), (y0, y1, y_step),
                        min(max(0.0, x0), x1), min(max(0.0, y0), y1),
                    ))
            return boxes

        collisions: list[str] = []
        for case in CORPUS:
            scene = sanitize_scene(case.raw)
            if scene is None:
                continue
            transform = build_transform(scene["elements"])
            decorations = decorations_of(scene["elements"], transform)
            if not decorations:
                continue
            for request in collect_label_requests(scene["elements"], transform):
                position = (scene["elements"][request.element_index].get("layout") or {}).get(request.slot)
                if position is None:
                    continue
                width, height = request.extent()
                box = Box(position[0], position[1], width, height)
                if any(box.overlap(other) > 0 for other in decorations):
                    collisions.append(f"{case.id}: {request.text!r}")
        self.assertEqual(collisions, [], "labels are covering renderer-drawn text")

    def test_molecule_cases_are_verified_not_asserted(self) -> None:
        for case in CORPUS:
            scene = sanitize_scene(case.raw)
            if scene is None or scene["render"] != "molecule":
                continue
            with self.subTest(case=case.id):
                for element in scene["elements"]:
                    if element["type"] != "molecule":
                        continue
                    # Present and computed — the planner supplies neither.
                    self.assertTrue(element["formula"])
                    self.assertGreater(element["mass"], 0)
                    self.assertIn(element["view"], {"2d", "3d"})


if __name__ == "__main__":
    unittest.main()


class CoordinateSpaceTests(unittest.TestCase):
    """Which space a scene's numbers live in decides what may be clamped."""

    def test_number_line_annotations_keep_their_values(self) -> None:
        """A number line's range IS the meaning of x.

        Coordinates were clamped to the canvas bound (±6.6) regardless of
        space, so on a 0..10 line every annotation past 6.6 was silently
        dragged back to 6.6: a caption about the mark at 8 pointed at 6.6 and
        a brace spanning to 8 stopped short. Both were visible in a live
        render and neither was the planner's fault.
        """
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {"type": "number_line", "color": "ink", "position": [0, 0],
                 "range": [0, 10, 1], "marks": [8]},
                {"type": "text", "color": "warning", "position": [8.0, 0.9], "label": "חריגה?"},
                {"type": "brace", "color": "warning", "points": [[3.4, -0.9], [8.0, -0.9]],
                 "label": "פער"},
            ],
        })
        assert scene is not None
        self.assertEqual(scene["elements"][1]["position"][0], 8.0,
                         "caption was clamped off the value it names")
        self.assertEqual(scene["elements"][2]["points"][1][0], 8.0,
                         "brace was clamped short of its span")

    def test_canvas_space_scenes_are_still_bounded(self) -> None:
        """The clamp is right when there IS no data space — without axes or a
        number line the planner's numbers are canvas units, and an unbounded
        one puts geometry off-frame."""
        from app.agents.manim_visual import X_LIMIT

        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {"type": "line", "color": "primary", "points": [[0, 0], [99.0, 0]], "label": "L"},
            ],
        })
        assert scene is not None
        self.assertLessEqual(abs(scene["elements"][0]["points"][1][0]), X_LIMIT)


class MoleculeSceneCoherenceTests(unittest.TestCase):
    """A molecule scene must contain only what the chemistry renderer draws."""

    def test_geometry_is_not_smuggled_into_a_molecule_scene(self) -> None:
        scene = sanitize_scene({
            "use_visual": True,
            "elements": [
                {"type": "molecule", "color": "primary", "smiles": "CCO", "label": "אתנול"},
                {"type": "point", "color": "primary", "points": [[0, 0]], "label": "P"},
                {"type": "line", "color": "primary", "points": [[0, 0], [1, 1]]},
            ],
        })
        assert scene is not None
        self.assertEqual([e["type"] for e in scene["elements"]], ["molecule"])
        self.assertEqual(check_layout(scene), [], "a dropped element left an unplaced label")
