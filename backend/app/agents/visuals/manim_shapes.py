"""Draw renderer-neutral shapes with Manim.

The mirror of `visuals.svg_shapes`: both take the same canvas-space shapes from
`visuals.shapes`, so a prop drawn in a video and the same prop drawn in a still
are the same object rather than two implementations that drift.

Imported only from inside the render worker, which owns the Manim import.
"""

from __future__ import annotations

from typing import Any, Callable


def to_mobjects(
    shapes: list[dict],
    *,
    manim: Any,
    to_scene: Callable[[list], Any],
    unit: float,
) -> list:
    """Convert canvas shapes into mobjects.

    `to_scene` maps a canvas point into Manim's scene space and `unit` is the
    length of one canvas unit there, so shapes stay correct inside an `axes`
    scene as well as on a bare canvas.
    """
    built: list = []
    for shape in shapes:
        kind = shape["kind"]
        stroke = shape.get("stroke") or "#000000"
        width = float(shape.get("width", 4.0))

        if kind == "polygon":
            built.append(manim.Polygon(
                *[to_scene(point) for point in shape["points"]],
                color=stroke, stroke_width=width,
                fill_color=shape.get("fill") or stroke,
                fill_opacity=float(shape.get("fill_opacity") or 0.0),
            ))
        elif kind == "polyline":
            points = [to_scene(point) for point in shape["points"]]
            if len(points) == 2:
                built.append(manim.Line(points[0], points[1], color=stroke, stroke_width=width))
            else:
                built.append(
                    manim.VMobject(color=stroke, stroke_width=width).set_points_as_corners(points)
                )
        elif kind == "ellipse":
            built.append(manim.Ellipse(
                width=2 * shape["rx"] * unit, height=2 * shape["ry"] * unit,
                color=stroke, stroke_width=width,
                fill_color=shape.get("fill") or stroke,
                fill_opacity=float(shape.get("fill_opacity") or 0.0),
            ).move_to(to_scene(shape["center"])))
        elif kind == "dot":
            built.append(manim.Dot(
                to_scene(shape["center"]),
                radius=shape["radius"] * unit,
                color=shape.get("fill") or stroke,
            ))
        elif kind == "path":
            mobject = _path_mobject(shape, manim=manim, to_scene=to_scene, unit=unit)
            if mobject is not None:
                built.append(mobject)
    return built


def _path_mobject(shape: dict, *, manim: Any, to_scene: Callable[[list], Any], unit: float):
    """One freehand stroke, fitted to the canvas box the shape builder solved.

    Each stroke is fitted to its OWN solved box rather than the group being
    scaled as a whole. Both give the same picture — every stroke shares one
    transform — but per-stroke fitting means a drawing composes with the rest of
    the scene without a grouping step the SVG renderer would have to mirror.
    """
    import svgelements

    try:
        mobject = manim.VMobjectFromSVGPath(svgelements.Path(shape["d"]))
    except Exception:
        return None
    if not mobject.has_points():
        return None

    color = shape.get("stroke") or "#000000"
    mobject.set_stroke(color=color, width=float(shape.get("width", 4.5)))
    mobject.set_fill(color=shape.get("fill") or color, opacity=float(shape.get("fill_opacity") or 0.0))

    if shape["transform"]["sy"] < 0:
        mobject.flip(manim.RIGHT)
    x0, y0, x1, y1 = shape["bbox"]
    target_width, target_height = (x1 - x0) * unit, (y1 - y0) * unit
    if mobject.width > 1e-9 and target_width > 1e-9:
        mobject.scale(target_width / mobject.width)
    elif mobject.height > 1e-9 and target_height > 1e-9:
        mobject.scale(target_height / mobject.height)
    mobject.move_to(to_scene([(x0 + x1) / 2, (y0 + y1) / 2]))
    return mobject
