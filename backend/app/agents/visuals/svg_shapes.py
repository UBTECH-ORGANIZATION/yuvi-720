"""Draw renderer-neutral shapes as SVG.

The mirror of `visuals.manim_shapes`. This is the half that was missing: every
still went to the browser renderer or this SVG fallback, and neither knew what a
balance scale or a freehand drawing was, so props rendered only in video.

Coordinates arrive in canvas space and are mapped by the caller's `project`,
which is the same projection the rest of the SVG fallback uses for primitives.
"""

from __future__ import annotations

from html import escape
from typing import Callable

Point = Callable[[list], tuple[float, float]]

# Manim stroke widths run 2..6 and read heavier there than the same number does
# in SVG, so they are nudged down rather than copied.
_STROKE_SCALE = 0.62


def _stroke_px(width: float) -> float:
    return max(0.0, round(width * _STROKE_SCALE, 2))


def _projection(project: Point) -> tuple[float, float, float, float]:
    """Recover (scale_x, scale_y, origin_x, origin_y) from the caller's mapping.

    The fallback fits the whole scene before drawing, so a prop must be measured
    in that same fit — a fixed pixels-per-unit constant would make a balance
    render at a different size from the number line beside it. Two probe points
    are enough: the projection is an axis-aligned affine map.
    """
    origin_x, origin_y = project([0.0, 0.0])
    unit_x, unit_y = project([1.0, 1.0])
    return unit_x - origin_x, unit_y - origin_y, origin_x, origin_y


def to_svg(shapes: list[dict], project: Point) -> list[str]:
    """Render canvas shapes as SVG element strings."""
    scale_x, scale_y, _, _ = _projection(project)
    unit_px = max(abs(scale_x), abs(scale_y), 1e-6)
    rows: list[str] = []
    for shape in shapes:
        kind = shape["kind"]
        stroke = escape(str(shape.get("stroke") or "#302b4a"), quote=True)
        width = _stroke_px(float(shape.get("width", 4.0)))
        fill = shape.get("fill")
        fill_opacity = float(shape.get("fill_opacity") or 0.0)
        paint = (
            f'fill="{escape(str(fill), quote=True)}" fill-opacity="{fill_opacity:g}"'
            if fill and fill_opacity > 0 else 'fill="none"'
        )

        if kind in {"polygon", "polyline"}:
            points = " ".join(f"{x:.2f},{y:.2f}" for x, y in (project(p) for p in shape["points"]))
            tag = "polygon" if kind == "polygon" else "polyline"
            body = paint if kind == "polygon" else 'fill="none"'
            rows.append(
                f'<{tag} points="{points}" {body} stroke="{stroke}" '
                f'stroke-width="{width}" stroke-linejoin="round" stroke-linecap="round" />'
            )
        elif kind == "ellipse":
            cx, cy = project(shape["center"])
            rx = shape["rx"] * abs(scale_x)
            ry = shape["ry"] * abs(scale_y)
            rows.append(
                f'<ellipse cx="{cx:.2f}" cy="{cy:.2f}" rx="{rx:.2f}" ry="{ry:.2f}" '
                f'{paint} stroke="{stroke}" stroke-width="{width}" />'
            )
        elif kind == "dot":
            cx, cy = project(shape["center"])
            radius = max(1.2, shape["radius"] * unit_px)
            colour = escape(str(shape.get("fill") or shape.get("stroke") or "#302b4a"), quote=True)
            rows.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{radius:.2f}" fill="{colour}" />')
        elif kind == "path":
            rows.append(_path_svg(shape, project, stroke, width, paint))
    return rows


def _path_svg(shape: dict, project: Point, stroke: str, width: float, paint: str) -> str:
    """A freehand stroke, placed by composing its canvas fit with the projection.

    The stroke's own `d` is emitted untouched and moved by a transform, so the
    path data the planner authored is never re-serialised — nothing can be lost
    or rounded on the way through.
    """
    transform = shape["transform"]
    scale_x, scale_y, origin_x, origin_y = _projection(project)

    a = transform["sx"] * scale_x
    d = transform["sy"] * scale_y
    e = transform["tx"] * scale_x + origin_x
    f = transform["ty"] * scale_y + origin_y
    # Pre-divided rather than left to `vector-effect="non-scaling-stroke"`: that
    # keyword is honoured by browsers and ignored by several rasterisers, which
    # multiplies the weight by the fit and turns a thin outline into a blob.
    pen = max(width / max(abs(a), 1e-6), 0.01)
    return (
        f'<g transform="matrix({a:.5f} 0 0 {d:.5f} {e:.3f} {f:.3f})">'
        f'<path d="{escape(str(shape["d"]), quote=True)}" {paint} stroke="{stroke}" '
        f'stroke-width="{pen:.3f}" stroke-linejoin="round" stroke-linecap="round" />'
        f"</g>"
    )
