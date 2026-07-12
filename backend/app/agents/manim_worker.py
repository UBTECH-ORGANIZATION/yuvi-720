"""Isolated renderer for validated Learning Coach scene specifications.

Run only through ``manim_visual.render_manim_visual``.  It accepts data, never
model-generated source code.
"""

from __future__ import annotations

from html import escape
import json
import math
from pathlib import Path
import re
import shutil
import sys


COLORS = {
    "primary": "#6f5bff",
    "secondary": "#33b8cf",
    "accent": "#f2a91b",
    "success": "#21a67a",
    "warning": "#df704d",
    "ink": "#302b4a",
    "muted": "#77718f",
    "white": "#ffffff",
}


def render(spec_path: Path, output_path: Path) -> None:
    from manim import (
        Arc,
        Arrow,
        Axes,
        Circle,
        DashedLine,
        DashedVMobject,
        Dot,
        Ellipse,
        Line,
        MarkupText,
        Polygon,
        Rectangle,
        RoundedRectangle,
        Scene,
        Text,
        VMobject,
        tempconfig,
    )
    import numpy as np

    available_fonts = set(Text.font_list())

    def font_for(text: str) -> str:
        if re.search(r"[\u0590-\u05ff]", text):
            candidates = ("Noto Sans Hebrew", "Arial Hebrew", "Arial")
        elif re.search(r"[\u0600-\u06ff]", text):
            candidates = ("Noto Sans Arabic", "Arial", "DejaVu Sans")
        else:
            candidates = ("Noto Sans", "Arial", "DejaVu Sans")
        return next((font for font in candidates if font in available_fonts), "")

    scene_spec = json.loads(spec_path.read_text(encoding="utf-8"))

    formula_pattern = re.compile(
        r"(?:=|\\frac|\\sqrt|\b(?:sin|cos|tan|log)\s*\(|[A-Za-zα-ωΑ-Ωθ]\s*[\^/])",
        re.IGNORECASE,
    )

    geometry_points: list[list[float]] = []
    for item in scene_spec["elements"]:
        if item["type"] in {"polygon", "polyline", "line", "arrow", "point", "angle", "right_angle"}:
            geometry_points.extend(item.get("points", []))
        elif item["type"] in {"circle", "rectangle", "arc"}:
            geometry_points.append(item["center"])
    has_formula_annotation = any(
        item["type"] == "text" and formula_pattern.search(item.get("label", ""))
        for item in scene_spec["elements"]
    )
    has_axes = any(item["type"] == "axes" for item in scene_spec["elements"])
    display_scale = 1.0
    display_offset = np.array([0.0, 0.0, 0.0])
    if geometry_points and not has_axes:
        xs = [point[0] for point in geometry_points]
        ys = [point[1] for point in geometry_points]
        source_width = max(max(xs) - min(xs), 0.1)
        source_height = max(max(ys) - min(ys), 0.1)
        target_left, target_right = (-5.45, 0.35) if has_formula_annotation else (-5.35, 5.35)
        target_bottom, target_top = -2.45, 2.45
        display_scale = min(
            (target_right - target_left) / source_width,
            (target_top - target_bottom) / source_height,
            1.7,
        )
        source_center = np.array([(min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 0.0])
        target_center = np.array([(target_left + target_right) / 2, (target_bottom + target_top) / 2, 0.0])
        display_offset = target_center - source_center * display_scale

    def vector(point: list[float]):
        return np.array([point[0], point[1], 0.0])

    def label_for(text: str, position, color: str = "ink", size: int = 28):
        if re.search(r"[\u0590-\u06ff]", text):
            label = MarkupText(escape(text), font=font_for(text), font_size=size, color=COLORS[color])
        else:
            label = Text(text, font=font_for(text), font_size=size, color=COLORS[color])
        return label.move_to(position)

    def backed_label(text: str, position, color: str = "ink", size: int = 28):
        label = label_for(text, position, color, size)
        label.add_background_rectangle(color="#fbfaff", opacity=0.9, buff=0.1)
        return label

    class EducationalScene(Scene):
        def construct(self) -> None:
            self.camera.background_color = "#fbfaff"
            axis_element = next(
                (element for element in scene_spec["elements"] if element["type"] == "axes"),
                None,
            )
            axes = None
            if axis_element:
                axis_color_name = axis_element.get("color", "ink")
                x_length = 9.5
                y_length = 5.4
                if any(element["type"] == "circle" for element in scene_spec["elements"]):
                    x_span = axis_element["x_range"][1] - axis_element["x_range"][0]
                    y_span = axis_element["y_range"][1] - axis_element["y_range"][0]
                    unit_scale = min(x_length / x_span, y_length / y_span)
                    x_length = x_span * unit_scale
                    y_length = y_span * unit_scale
                axes = Axes(
                    x_range=axis_element["x_range"],
                    y_range=axis_element["y_range"],
                    x_length=x_length,
                    y_length=y_length,
                    axis_config={
                        "color": COLORS[axis_color_name],
                        "stroke_width": 3,
                        "include_numbers": False,
                    },
                    tips=True,
                ).move_to(vector(axis_element["position"]))
                self.add(axes)
                x_start, x_end, x_step = axis_element["x_range"]
                x_value = math.ceil(x_start / x_step) * x_step
                while x_value <= x_end + 1e-9:
                    if abs(x_value) > 1e-9:
                        self.add(label_for(f"{x_value:g}", axes.c2p(x_value, 0) + np.array([0, -0.28, 0]), "muted", 17))
                    x_value += x_step
                y_start, y_end, y_step = axis_element["y_range"]
                y_value = math.ceil(y_start / y_step) * y_step
                while y_value <= y_end + 1e-9:
                    if abs(y_value) > 1e-9:
                        self.add(label_for(f"{y_value:g}", axes.c2p(0, y_value) + np.array([-0.3, 0, 0]), "muted", 17))
                    y_value += y_step
                if axis_element.get("x_label"):
                    self.add(label_for(axis_element["x_label"], axes.x_axis.get_end() + np.array([0.25, 0.2, 0]), axis_color_name, 23))
                if axis_element.get("y_label"):
                    self.add(label_for(axis_element["y_label"], axes.y_axis.get_end() + np.array([0.2, 0.2, 0]), axis_color_name, 23))

            def scene_point(point: list[float]):
                return axes.c2p(point[0], point[1]) if axes is not None else vector(point) * display_scale + display_offset

            def scene_scales() -> tuple[float, float]:
                if axes is None:
                    return display_scale, display_scale
                origin = axes.c2p(0, 0)
                return (
                    float(np.linalg.norm(axes.c2p(1, 0) - origin)),
                    float(np.linalg.norm(axes.c2p(0, 1) - origin)),
                )

            for element in scene_spec["elements"]:
                kind = element["type"]
                color_name = element.get("color", "primary")
                color = COLORS[color_name]

                if kind == "axes":
                    continue

                if kind == "polygon":
                    points = [scene_point(point) for point in element["points"]]
                    shape = Polygon(
                        *points,
                        color=color,
                        stroke_width=5,
                        fill_color=color,
                        fill_opacity=element.get("fill_opacity", 0.08),
                    )
                    self.add(shape)
                    center = sum(points) / len(points)
                    for index, text in enumerate(element.get("labels", [])):
                        if not text:
                            continue
                        direction = points[index] - center
                        length = np.linalg.norm(direction) or 1.0
                        self.add(label_for(text, points[index] + direction / length * 0.34))
                    for index, text in enumerate(element.get("side_labels", [])):
                        if not text:
                            continue
                        start = points[index]
                        end = points[(index + 1) % len(points)]
                        midpoint = (start + end) / 2
                        tangent = end - start
                        normal = np.array([-tangent[1], tangent[0], 0.0])
                        if np.dot(normal, midpoint - center) < 0:
                            normal = -normal
                        normal_length = np.linalg.norm(normal) or 1.0
                        self.add(backed_label(text, midpoint + normal / normal_length * 0.5, "ink", 25))

                elif kind == "polyline":
                    points = [scene_point(point) for point in element["points"]]
                    path = VMobject(color=color, stroke_width=5).set_points_as_corners(points)
                    self.add(DashedVMobject(path) if element.get("dashed") else path)
                    if element.get("label"):
                        label_index = min(max(1, len(points) * 2 // 3), len(points) - 1)
                        tangent = points[label_index] - points[label_index - 1]
                        normal = np.array([tangent[1], -tangent[0], 0.0])
                        normal_length = np.linalg.norm(normal) or 1.0
                        label_position = points[label_index] + normal / normal_length * 0.42
                        self.add(label_for(element["label"], label_position))

                elif kind in {"line", "arrow"}:
                    start, end = [scene_point(point) for point in element["points"]]
                    if kind == "arrow":
                        shape = Arrow(start, end, color=color, stroke_width=5, buff=0.03)
                    elif element.get("dashed"):
                        shape = DashedLine(start, end, color=color, stroke_width=5)
                    else:
                        shape = Line(start, end, color=color, stroke_width=5)
                    self.add(shape)
                    if element.get("label"):
                        tangent = end - start
                        normal = np.array([-tangent[1], tangent[0], 0.0])
                        if normal[1] < 0:
                            normal = -normal
                        normal_length = np.linalg.norm(normal) or 1.0
                        self.add(label_for(element["label"], (start + end) / 2 + normal / normal_length * 0.34))

                elif kind == "point":
                    position = scene_point(element["points"][0])
                    self.add(Dot(position, radius=0.09, color=color))
                    if element.get("label"):
                        self.add(label_for(element["label"], position + np.array([0.3, 0.26, 0])))

                elif kind == "circle":
                    center = scene_point(element["center"])
                    x_scale, y_scale = scene_scales()
                    shape = Ellipse(
                        width=2 * element["radius"] * x_scale,
                        height=2 * element["radius"] * y_scale,
                        color=color,
                        stroke_width=5,
                        fill_color=color,
                        fill_opacity=0.06,
                    ).move_to(center)
                    self.add(shape)
                    if element.get("label"):
                        self.add(label_for(element["label"], center + np.array([0, element["radius"] * y_scale + 0.35, 0])))

                elif kind == "rectangle":
                    center = scene_point(element["center"])
                    x_scale, y_scale = scene_scales()
                    shape = Rectangle(
                        width=element["width"] * x_scale,
                        height=element["height"] * y_scale,
                        color=color,
                        stroke_width=5,
                        fill_color=color,
                        fill_opacity=element.get("fill_opacity", 0.08),
                    ).move_to(center)
                    self.add(shape)
                    if element.get("label"):
                        self.add(label_for(element["label"], center))

                elif kind == "arc":
                    center_data = element["center"]
                    samples = 32
                    arc_points = []
                    for index in range(samples + 1):
                        theta = element["start_angle"] + element["angle"] * index / samples
                        arc_points.append(scene_point([
                            center_data[0] + element["radius"] * math.cos(theta),
                            center_data[1] + element["radius"] * math.sin(theta),
                        ]))
                    arc = VMobject(color=color, stroke_width=5).set_points_as_corners(arc_points)
                    self.add(arc)
                    if element.get("label"):
                        middle = element["start_angle"] + element["angle"] / 2
                        position = scene_point([
                            center_data[0] + (element["radius"] + 0.35) * math.cos(middle),
                            center_data[1] + (element["radius"] + 0.35) * math.sin(middle),
                        ])
                        self.add(label_for(element["label"], position, color_name, 25))

                elif kind == "text" and element.get("label"):
                    text = element["label"]
                    if axes is None and formula_pattern.search(text):
                        formula = label_for(text, np.array([3.35, 0.25, 0.0]), color_name, 31)
                        card = RoundedRectangle(
                            width=max(3.5, formula.width + 0.7),
                            height=max(1.05, formula.height + 0.48),
                            corner_radius=0.18,
                            color=COLORS["primary"],
                            stroke_width=2.5,
                            fill_color="#ffffff",
                            fill_opacity=0.96,
                        ).move_to(formula.get_center())
                        self.add(card, formula)
                    else:
                        self.add(backed_label(text, scene_point(element["position"]), color_name, 27))

                elif kind == "angle":
                    ray1, vertex, ray2 = element["points"]
                    ray1_scene = scene_point(ray1)
                    center = scene_point(vertex)
                    ray2_scene = scene_point(ray2)
                    angle1 = math.atan2(ray1_scene[1] - center[1], ray1_scene[0] - center[0])
                    angle2 = math.atan2(ray2_scene[1] - center[1], ray2_scene[0] - center[0])
                    delta = (angle2 - angle1 + math.pi) % (2 * math.pi) - math.pi
                    arc = Arc(
                        radius=0.52,
                        start_angle=angle1,
                        angle=delta,
                        arc_center=center,
                        color=color,
                        stroke_width=5,
                    )
                    self.add(arc)
                    if element.get("label"):
                        middle = angle1 + delta / 2
                        position = center + np.array([0.88 * math.cos(middle), 0.88 * math.sin(middle), 0])
                        self.add(backed_label(element["label"], position, color_name, 25))

                elif kind == "right_angle":
                    ray1, vertex, ray2 = [scene_point(point) for point in element["points"]]
                    first = ray1 - vertex
                    second = ray2 - vertex
                    first /= np.linalg.norm(first) or 1.0
                    second /= np.linalg.norm(second) or 1.0
                    size = 0.4
                    corner1 = vertex + first * size
                    corner2 = vertex + second * size
                    square_corner = corner1 + second * size
                    marker = VMobject(color=color, stroke_width=5).set_points_as_corners([
                        corner1,
                        square_corner,
                        corner2,
                    ])
                    self.add(marker)

    media_dir = output_path.parent / "media"
    with tempconfig(
        {
            "pixel_width": 960,
            "pixel_height": 540,
            "frame_width": 14.0,
            "frame_height": 7.875,
            "media_dir": str(media_dir),
            "output_file": "yuvi_visual",
            "format": "png",
            "save_last_frame": True,
            "write_to_movie": False,
            "disable_caching": True,
            "verbosity": "ERROR",
        }
    ):
        scene = EducationalScene()
        scene.render()
        generated = Path(scene.renderer.file_writer.image_file_path)
        if not generated.exists():
            raise RuntimeError("Manim did not produce the expected still image")
        shutil.copyfile(generated, output_path)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: python -m app.agents.manim_worker SCENE_JSON OUTPUT_PNG")
    render(Path(sys.argv[1]), Path(sys.argv[2]))
