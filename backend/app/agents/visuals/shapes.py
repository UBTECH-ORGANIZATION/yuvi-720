"""Renderer-neutral shapes — the layer that stops props being Manim-only.

Props and freehand drawings used to be assembled directly out of Manim
mobjects, so they existed only on the animated path. Every still went to the
browser renderer or the SVG fallback, neither of which knows what a balance
scale is, and the entire object vocabulary — the part built specifically for
science — silently disappeared from the picture.

The fix is to stop building *mobjects* and start building *shapes*: plain dicts
in canvas coordinates that any renderer can draw. Manim, SVG and anything added
later consume the same list, so a prop is written once and appears everywhere.

Coordinates are CANVAS units (x -6.6..6.6, y -3.4..3.4), the space the planner
and the layout solver already reason in. Lengths are canvas units too; a
renderer scales them by whatever one canvas unit is worth in its own space.

Two rules survive from the Manim originals and still hold:
- **Text belongs to the caller.** A builder returns shapes plus named anchors;
  labels are placed by the renderer through its own RTL-safe text path.
- **Randomness is seeded.** Particle positions come from a per-prop seed, so
  the same spec draws the same picture on every renderer and every run.
"""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Optional

# A builder returns its shapes plus the points a caller may hang a label on.
BuildResult = tuple[list[dict], dict[str, Any]]

CANVAS_X = 6.6
CANVAS_Y = 3.4

# How far the beam of a balance may swing, in radians. Deliberately small: a
# real beam balance barely moves, and an exaggerated tilt reads as a see-saw.
_MAX_TILT = 0.22


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _as_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


# ── shape constructors ───────────────────────────────────────────────────────
def polygon(points, *, stroke, width=4.0, fill=None, fill_opacity=0.0) -> dict:
    return {"kind": "polygon", "points": [list(p) for p in points], "stroke": stroke,
            "width": width, "fill": fill, "fill_opacity": fill_opacity}


def polyline(points, *, stroke, width=4.0) -> dict:
    return {"kind": "polyline", "points": [list(p) for p in points], "stroke": stroke,
            "width": width}


def line(start, end, *, stroke, width=4.0) -> dict:
    return polyline([start, end], stroke=stroke, width=width)


def ellipse(center, rx, ry, *, stroke, width=5.0, fill=None, fill_opacity=0.0) -> dict:
    return {"kind": "ellipse", "center": list(center), "rx": float(rx), "ry": float(ry),
            "stroke": stroke, "width": width, "fill": fill, "fill_opacity": fill_opacity}


def rectangle(center, w, h, *, stroke, width=5.0, fill=None, fill_opacity=0.0) -> dict:
    half_w, half_h = w / 2.0, h / 2.0
    return polygon(
        [[center[0] - half_w, center[1] - half_h], [center[0] + half_w, center[1] - half_h],
         [center[0] + half_w, center[1] + half_h], [center[0] - half_w, center[1] + half_h]],
        stroke=stroke, width=width, fill=fill, fill_opacity=fill_opacity,
    )


def dot(center, radius, *, fill) -> dict:
    return {"kind": "dot", "center": list(center), "radius": float(radius), "fill": fill}


def bounds(shapes: list[dict]) -> Optional[tuple[float, float, float, float]]:
    """(min_x, min_y, max_x, max_y) over every shape, or None when empty."""
    xs: list[float] = []
    ys: list[float] = []
    for shape in shapes:
        kind = shape["kind"]
        if kind in {"polygon", "polyline"}:
            xs += [p[0] for p in shape["points"]]
            ys += [p[1] for p in shape["points"]]
        elif kind == "ellipse":
            xs += [shape["center"][0] - shape["rx"], shape["center"][0] + shape["rx"]]
            ys += [shape["center"][1] - shape["ry"], shape["center"][1] + shape["ry"]]
        elif kind == "dot":
            xs += [shape["center"][0] - shape["radius"], shape["center"][0] + shape["radius"]]
            ys += [shape["center"][1] - shape["radius"], shape["center"][1] + shape["radius"]]
        elif kind == "path":
            x0, y0, x1, y1 = shape["bbox"]
            xs += [x0, x1]
            ys += [y0, y1]
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def shift(shapes: list[dict], dx: float, dy: float) -> None:
    """Move every shape in place. Used to seat a load on a pan it cannot predict."""
    if not dx and not dy:
        return
    for shape in shapes:
        kind = shape["kind"]
        if kind in {"polygon", "polyline"}:
            shape["points"] = [[p[0] + dx, p[1] + dy] for p in shape["points"]]
        elif kind in {"ellipse", "dot"}:
            shape["center"] = [shape["center"][0] + dx, shape["center"][1] + dy]
        elif kind == "path":
            shape["transform"]["tx"] += dx
            shape["transform"]["ty"] += dy
            x0, y0, x1, y1 = shape["bbox"]
            shape["bbox"] = [x0 + dx, y0 + dy, x1 + dx, y1 + dy]


def rescale(shapes: list[dict], scale: float, dx: float, dy: float) -> None:
    """Scale about the origin then translate, in place.

    Lets a builder author in whatever space suits it and be fitted afterwards,
    which is what keeps freehand objects from ever landing off-canvas.
    """
    for shape in shapes:
        kind = shape["kind"]
        if kind in {"polygon", "polyline"}:
            shape["points"] = [[p[0] * scale + dx, p[1] * scale + dy] for p in shape["points"]]
        elif kind in {"ellipse", "dot"}:
            shape["center"] = [shape["center"][0] * scale + dx, shape["center"][1] * scale + dy]
            if kind == "ellipse":
                shape["rx"] *= scale
                shape["ry"] *= scale
            else:
                shape["radius"] *= scale


# ── balance scale ────────────────────────────────────────────────────────────
def _balance_scale(spec, color_for) -> BuildResult:
    """Two-pan beam balance — "which is heavier", and equations as balance.

    `tilt` is signed and means what gravity means: POSITIVE dips the RIGHT pan,
    because a positive difference is the right side being heavier. Getting this
    sign backwards is not a cosmetic bug — it draws the heavier object rising,
    which is the exact misconception the picture exists to correct.

    The pans hang from the beam ends but stay LEVEL — a pan that rotates with
    the beam is the commonest way this drawing goes wrong, and it makes the
    contents look like they are sliding off.
    """
    center = spec.get("center") or [0.0, 0.0]
    size = _clamp(_as_float(spec.get("size"), 1.0), 0.4, 2.2)
    ink = color_for(spec.get("color") or "ink")
    accent = color_for("accent")

    left_mass = spec.get("left_mass")
    right_mass = spec.get("right_mass")
    if left_mass is not None and right_mass is not None:
        left_value = _as_float(left_mass, 0.0)
        right_value = _as_float(right_mass, 0.0)
        total = abs(left_value) + abs(right_value)
        # Normalised difference, so the tilt shows WHICH side is heavier
        # without pretending to be a proportional readout of by how much.
        tilt = 0.0 if total <= 0 else _clamp((right_value - left_value) / total * 2.2, -1.0, 1.0)
    else:
        tilt = _clamp(_as_float(spec.get("tilt"), 0.0), -1.0, 1.0)

    beam_half = 1.55 * size
    pillar_height = 1.15 * size
    angle = tilt * _MAX_TILT

    pivot = [center[0], center[1] + pillar_height]
    # Heavier side DOWN: a positive tilt lowers the right end.
    left_end = [pivot[0] - beam_half * math.cos(angle), pivot[1] + beam_half * math.sin(angle)]
    right_end = [pivot[0] + beam_half * math.cos(angle), pivot[1] - beam_half * math.sin(angle)]

    base_half = 0.62 * size
    parts: list[dict] = [
        polygon(
            [[center[0] - base_half, center[1] - 0.12 * size],
             [center[0] + base_half, center[1] - 0.12 * size],
             [center[0] + base_half * 0.42, center[1] + 0.1 * size],
             [center[0] - base_half * 0.42, center[1] + 0.1 * size]],
            stroke=ink, width=4, fill=ink, fill_opacity=0.16,
        ),
        line(center, pivot, stroke=ink, width=5),
        line(left_end, right_end, stroke=ink, width=6),
        dot(pivot, 0.075, fill=accent),
    ]

    anchors: dict[str, Any] = {"pivot": pivot}
    for side, end in (("left", left_end), ("right", right_end)):
        pan_y = end[1] - 0.52 * size
        pan_half = 0.46 * size
        # The hanger is vertical whatever the beam does — that is what keeps the
        # pan level and the load looking supported rather than tipped.
        parts.append(line(end, [end[0], pan_y], stroke=ink, width=3))
        parts.append(polygon(
            [[end[0] - pan_half, pan_y], [end[0] + pan_half, pan_y],
             [end[0] + pan_half * 0.66, pan_y - 0.24 * size],
             [end[0] - pan_half * 0.66, pan_y - 0.24 * size]],
            stroke=ink, width=4,
            fill=color_for(spec.get("pan_color") or "muted"), fill_opacity=0.22,
        ))
        anchors[f"{side}_pan"] = [end[0], pan_y - 0.42 * size]
        anchors[f"{side}_load"] = [end[0], pan_y + 0.44 * size]

        # What is BEING weighed, built straight onto the pan. Asking the planner
        # to guess where a pan ended up after the beam tilted is asking it to
        # redo this trigonometry from outside — it lands the object next to the
        # scale instead of on it.
        load = spec.get(f"{side}_load")
        if isinstance(load, dict) and load.get("prop") in _PROPS:
            nested = dict(load)
            nested["size"] = min(_as_float(nested.get("size"), 0.55), 0.62 * size)
            nested["center"] = [end[0], pan_y]
            built = _PROPS[nested["prop"]](nested, color_for)
            if built:
                shapes, load_anchors = built
                # Seat it ON the pan by MEASURING the assembled shapes rather
                # than predicting their extent: a balloon's lowest point is its
                # neck, a container's is its base, and guessing per prop is how
                # loads end up hovering above the pan they should rest in.
                box = bounds(shapes)
                if box:
                    shift(shapes, 0.0, pan_y - box[1])
                parts.extend(shapes)
                for name, point in load_anchors.items():
                    if isinstance(point, list):
                        anchors[f"{side}_load.{name}"] = [point[0], point[1] + (pan_y - box[1] if box else 0.0)]
    return parts, anchors


# ── balloon ──────────────────────────────────────────────────────────────────
def _balloon(spec, color_for) -> BuildResult:
    """An inflatable balloon: body, neck, knot, optional string and gas inside.

    `inflation` (0..1) drives the body size, so "empty" and "inflated" are the
    same prop at two settings rather than two unrelated drawings — the learner
    sees one object changing, which is the whole point of the question.
    """
    center = spec.get("center") or [0.0, 0.0]
    size = _clamp(_as_float(spec.get("size"), 1.0), 0.35, 2.0)
    inflation = _clamp(_as_float(spec.get("inflation"), 1.0), 0.0, 1.0)
    color = color_for(spec.get("color") or "warning")

    # Never collapses to nothing: a deflated balloon is still a balloon, and a
    # zero-radius ellipse would render as a dot the learner cannot identify.
    radius_x = size * (0.34 + 0.5 * inflation)
    radius_y = size * (0.4 + 0.58 * inflation)

    parts: list[dict] = [ellipse(center, radius_x, radius_y, stroke=color, width=5,
                                 fill=color, fill_opacity=0.2)]

    neck_half = 0.12 * size * (0.6 + 0.4 * inflation)
    neck_top = center[1] - radius_y
    neck_bottom = neck_top - 0.2 * size
    parts.append(polygon(
        [[center[0] - neck_half, neck_top], [center[0] + neck_half, neck_top],
         [center[0] + neck_half * 0.5, neck_bottom], [center[0] - neck_half * 0.5, neck_bottom]],
        stroke=color, width=4, fill=color, fill_opacity=0.32,
    ))
    if spec.get("string"):
        parts.append(line(
            [center[0], neck_bottom],
            [center[0] + 0.16 * size, neck_bottom - 0.85 * size],
            stroke=color_for("muted"), width=3,
        ))
    if spec.get("particles"):
        parts.extend(_scatter_dots(
            center=center, radius_x=radius_x * 0.72, radius_y=radius_y * 0.72,
            count=int(_clamp(_as_float(spec.get("particles"), 0), 0, 40)),
            color=color_for(spec.get("particle_color") or "secondary"),
            seed=int(_as_float(spec.get("seed"), 7)),
        ))
    return parts, {
        "top": [center[0], center[1] + radius_y + 0.22],
        "center": list(center),
        "bottom": [center[0], neck_bottom - 0.25],
    }


# ── particle box ─────────────────────────────────────────────────────────────
def _particle_box(spec, color_for) -> BuildResult:
    """Particles in a container — states of matter, gas, density, diffusion.

    `state` chooses the arrangement: a solid packs to a lattice, a liquid sits
    loose in the lower half, a gas fills the volume. Deterministic given `seed`.
    """
    center = spec.get("center") or [0.0, 0.0]
    width = _clamp(_as_float(spec.get("width"), 2.2), 0.6, 6.0)
    height = _clamp(_as_float(spec.get("height"), 1.8), 0.6, 5.0)
    state = str(spec.get("state") or "gas").strip().lower()
    count = int(_clamp(_as_float(spec.get("count"), 14), 1, 48))
    ink = color_for(spec.get("color") or "ink")
    particle_color = color_for(spec.get("particle_color") or "secondary")
    shape = str(spec.get("shape") or "box").strip().lower()

    if shape == "circle":
        parts: list[dict] = [ellipse(center, width / 2, height / 2, stroke=ink, width=5)]
    else:
        parts = [rectangle(center, width, height, stroke=ink, width=5)]

    radius = 0.5 * _clamp(_as_float(spec.get("particle_size"), 0.14), 0.05, 0.3)
    rng = random.Random(int(_as_float(spec.get("seed"), 11)))
    if state == "solid":
        # A lattice, not a scatter: the regularity IS the fact being taught.
        columns = max(1, int(round(math.sqrt(count * width / max(height, 0.1)))))
        rows = max(1, math.ceil(count / columns))
        for index in range(count):
            col, row = index % columns, index // columns
            x = center[0] + width * ((col + 0.5) / columns - 0.5) * 0.78
            y = center[1] + height * ((row + 0.5) / rows - 0.5) * 0.78
            parts.append(dot([x, y], radius, fill=particle_color))
    else:
        span_y = 0.42 if state == "liquid" else 0.82
        offset_y = -height * 0.22 if state == "liquid" else 0.0
        for _ in range(count):
            x = center[0] + rng.uniform(-0.4, 0.4) * width
            y = center[1] + offset_y + rng.uniform(-0.5, 0.5) * span_y * height
            parts.append(dot([x, y], radius, fill=particle_color))
    return parts, {
        "top": [center[0], center[1] + height / 2 + 0.24],
        "center": list(center),
        "bottom": [center[0], center[1] - height / 2 - 0.24],
    }


# ── container ────────────────────────────────────────────────────────────────
def _container(spec, color_for) -> BuildResult:
    """A vessel with a liquid level — beaker, cup, jar, measuring cylinder.

    The silhouette is built rather than drawn so the object can stay *live*: the
    walls taper, the rim overhangs and the beaker has a spout, but `fill_level`
    still moves the liquid and the surface still meets the walls at the right
    width. A hand-drawn beaker looks the same but freezes its own level, which
    makes it decoration on any question where the amount is the point.
    """
    center = spec.get("center") or [0.0, 0.0]
    width = _clamp(_as_float(spec.get("width"), 1.4), 0.4, 4.0)
    height = _clamp(_as_float(spec.get("height"), 1.8), 0.5, 4.5)
    fill_level = _clamp(_as_float(spec.get("fill_level"), 0.5), 0.0, 1.0)
    ink = color_for(spec.get("color") or "ink")
    liquid = color_for(spec.get("liquid_color") or "secondary")
    style = str(spec.get("style") or "beaker").strip().lower()

    bottom, top = center[1] - height / 2, center[1] + height / 2
    half_top = width / 2
    # A slight taper is most of what separates a vessel from a rectangle.
    half_bottom = half_top * (1.0 if style == "box" else 0.87)
    corner = min(0.16 * width, 0.22 * height)

    def half_at(y: float) -> float:
        ratio = 0.0 if height <= 0 else _clamp((y - bottom) / height, 0.0, 1.0)
        return half_bottom + (half_top - half_bottom) * ratio

    def wall(sign: float) -> list[list[float]]:
        return [
            [center[0] + sign * half_top, top],
            [center[0] + sign * half_bottom, bottom + corner],
            [center[0] + sign * (half_bottom - corner * 0.45), bottom],
        ]

    left, right = wall(-1.0), wall(1.0)
    parts: list[dict] = [polyline(left + list(reversed(right)), stroke=ink, width=5)]

    if fill_level > 0:
        surface = bottom + height * fill_level
        half_surface = half_at(surface)
        parts.append(polygon(
            [[center[0] - half_surface, surface],
             [center[0] - half_bottom, bottom + corner],
             [center[0] - (half_bottom - corner * 0.45), bottom],
             [center[0] + (half_bottom - corner * 0.45), bottom],
             [center[0] + half_bottom, bottom + corner],
             [center[0] + half_surface, surface]],
            stroke=liquid, width=0, fill=liquid, fill_opacity=0.34,
        ))
        parts.append(line([center[0] - half_surface, surface],
                          [center[0] + half_surface, surface], stroke=liquid, width=4))

    if style != "box":
        overhang = 0.08 * width
        parts.append(line([center[0] - half_top - overhang, top],
                          [center[0] + half_top + overhang, top], stroke=ink, width=5))
    if style == "beaker":
        # The pouring spout: the detail that makes it read as laboratory glass.
        overhang = 0.08 * width
        parts.append(polyline([
            [center[0] + half_top + overhang, top],
            [center[0] + half_top + overhang * 2.2, top - 0.04 * height],
            [center[0] + half_top + overhang * 1.5, top - 0.13 * height],
        ], stroke=ink, width=4))
    if style == "cup":
        # A handle, drawn as a squared-off loop on the right wall.
        handle_top, handle_bottom = top - 0.22 * height, top - 0.62 * height
        reach = center[0] + half_top + 0.34 * width
        parts.append(polyline([
            [center[0] + half_at(handle_top), handle_top],
            [reach, handle_top - 0.04 * height],
            [reach, handle_bottom + 0.04 * height],
            [center[0] + half_at(handle_bottom), handle_bottom],
        ], stroke=ink, width=5))

    if spec.get("graduations"):
        steps = int(_clamp(_as_float(spec.get("graduations"), 4), 1, 10))
        for index in range(1, steps):
            y = bottom + height * index / steps
            edge = center[0] + half_at(y)
            parts.append(line([edge - width * 0.22, y], [edge, y], stroke=ink, width=2))

    return parts, {
        "top": [center[0], top + 0.3],
        "center": list(center),
        "surface": [center[0], bottom + height * fill_level],
        "base": [center[0], bottom - 0.28],
    }


# ── balance ──────────────────────────────────────────────────────────────────
def _balance(spec, color_for) -> BuildResult:
    """A digital balance: platform, body, and a display that shows a reading.

    The instrument the whole mass unit is about. It exists so a reading can be
    drawn where a reading actually appears — on the display — instead of as a
    number floating beside a picture of nothing. `load` puts an object ON the
    platform, seated by measuring it, so a cup cannot end up hovering above the
    scale it is supposed to be standing on.
    """
    center = spec.get("center") or [0.0, 0.0]
    size = _clamp(_as_float(spec.get("size"), 1.0), 0.4, 2.2)
    ink = color_for(spec.get("color") or "ink")

    half = 1.05 * size
    body_top = center[1] + 0.16 * size
    body_bottom = center[1] - 0.62 * size
    pan_y = center[1] + 0.34 * size
    pan_half = 0.86 * size

    parts: list[dict] = [
        polygon(
            [[center[0] - half, body_top], [center[0] + half, body_top],
             [center[0] + half * 0.88, body_bottom], [center[0] - half * 0.88, body_bottom]],
            stroke=ink, width=5, fill=ink, fill_opacity=0.10,
        ),
        polygon(
            [[center[0] - pan_half, pan_y], [center[0] + pan_half, pan_y],
             [center[0] + pan_half, body_top], [center[0] - pan_half, body_top]],
            stroke=ink, width=4, fill=color_for(spec.get("pan_color") or "muted"),
            fill_opacity=0.24,
        ),
    ]

    display_center = [center[0], (body_top + body_bottom) / 2 - 0.02 * size]
    display_half_w, display_half_h = 0.52 * size, 0.17 * size
    parts.append(rectangle(display_center, display_half_w * 2, display_half_h * 2,
                           stroke=ink, width=3, fill="#ffffff", fill_opacity=0.92))

    anchors: dict[str, Any] = {
        "top": [center[0], pan_y + 0.34 * size],
        "center": list(center),
        "bottom": [center[0], body_bottom - 0.3],
        "display": display_center,
        "pan": [center[0], pan_y],
    }

    load = spec.get("load")
    if isinstance(load, dict) and load.get("prop") in _PROPS:
        nested = dict(load)
        nested["center"] = [center[0], pan_y]
        # An object on the platform is part of the same drawing, so it takes the
        # instrument's colour unless it was given one of its own.
        nested.setdefault("color", spec.get("color") or "primary")
        built = _PROPS[nested["prop"]](nested, color_for)
        if built:
            shapes, load_anchors = built
            box = bounds(shapes)
            if box:
                lift = pan_y - box[1]
                shift(shapes, 0.0, lift)
                for name, point in load_anchors.items():
                    if isinstance(point, list):
                        anchors[f"load.{name}"] = [point[0], point[1] + lift]
            parts.extend(shapes)
            top_box = bounds(shapes)
            if top_box:
                anchors["top"] = [center[0], top_box[3] + 0.3]
    return parts, anchors



# ── bar comparison ───────────────────────────────────────────────────────────
def _bar_comparison(spec, color_for) -> BuildResult:
    """Side-by-side magnitude bars — the honest form of "A weighs more than B".

    This is the prop that should have drawn the balloon question: two labelled
    bars whose HEIGHTS carry the comparison, instead of two words parked above
    a number line where the position meant nothing.
    """
    center = spec.get("center") or [0.0, 0.0]
    items = [item for item in (spec.get("items") or []) if isinstance(item, dict)][:5]
    if not items:
        return [], {}
    values = [abs(_as_float(item.get("value"), 0.0)) for item in items]
    peak = max(values) or 1.0
    max_height = _clamp(_as_float(spec.get("height"), 2.0), 0.5, 3.2)
    bar_width = _clamp(_as_float(spec.get("bar_width"), 0.62), 0.2, 1.4)
    gap = bar_width * 1.85
    baseline = center[1]
    start_x = center[0] - gap * (len(items) - 1) / 2

    parts: list[dict] = []
    anchors: dict[str, Any] = {"baseline": [center[0], baseline]}
    for index, (item, value) in enumerate(zip(items, values)):
        bar_height = max(0.08, max_height * value / peak)
        x = start_x + gap * index
        color = color_for(item.get("color") or ("primary" if index == 0 else "secondary"))
        parts.append(rectangle([x, baseline + bar_height / 2], bar_width, bar_height,
                               stroke=color, width=4, fill=color, fill_opacity=0.28))
        anchors[f"top:{index}"] = [x, baseline + bar_height + 0.26]
        anchors[f"foot:{index}"] = [x, baseline - 0.3]
    return parts, anchors


def _scatter_dots(*, center, radius_x, radius_y, count, color, seed) -> list[dict]:
    """Dots scattered inside an ellipse, deterministically."""
    if count <= 0:
        return []
    rng = random.Random(seed)
    dots = []
    for _ in range(count):
        # Rejection-free polar placement, square-rooted so the dots spread
        # evenly over the AREA instead of clustering at the centre.
        angle = rng.uniform(0, 2 * math.pi)
        reach = math.sqrt(rng.random())
        dots.append(dot(
            [center[0] + radius_x * reach * math.cos(angle),
             center[1] + radius_y * reach * math.sin(angle)],
            0.055, fill=color,
        ))
    return dots


_PROPS: dict[str, Callable[..., BuildResult]] = {
    "balance_scale": _balance_scale,
    "balance": _balance,
    "balloon": _balloon,
    "particle_box": _particle_box,
    "container": _container,
    "bar_comparison": _bar_comparison,
}

PROP_KINDS = frozenset(_PROPS)


def build_prop(spec: dict, *, color_for: Callable[[str], str]) -> Optional[BuildResult]:
    """Build one prop as canvas shapes, or None when the kind is unknown."""
    factory = _PROPS.get(str(spec.get("prop") or "").strip().lower())
    return factory(spec, color_for) if factory else None


# ── freehand drawings ────────────────────────────────────────────────────────
# Leave a margin so a drawing does not graze the frame edge, which reads as
# clipped even when it technically is not.
_DRAW_HALF_WIDTH = 6.6
_DRAW_HALF_HEIGHT = 3.5


def build_drawing(spec: dict, *, color_for: Callable[[str], str]) -> BuildResult:
    """Fit an authored object to `size` and centre it on `center`.

    Two authoring forms feed this. `parts` composes the object from parametric
    generators, which is the one to prefer: each part is correct by
    construction, so the planner cannot produce a malformed shape. `strokes` is
    raw SVG path data, kept for objects the vocabulary has no part for.

    Fitting is what makes either safe to hand to a planner. The object arrives
    in whatever coordinate space the model found convenient and comes out the
    same size in the same place. The planner supplies shape; placement is ours.
    """
    center = spec.get("center") or [0.0, 0.0]
    size = max(0.2, min(_as_float(spec.get("size"), 1.5), 5.0))
    if spec.get("parts"):
        return _fit_parts(spec, center, size, color_for)
    return _fit_strokes(spec, center, size, color_for)


def _fit_parts(spec: dict, center, size: float, color_for) -> BuildResult:
    from app.agents.visuals import sketch

    built = sketch.build_parts(spec["parts"], color_for)
    box = bounds(built)
    if not built or box is None:
        return [], {}
    source_w = max(box[2] - box[0], 1e-6)
    source_h = max(box[3] - box[1], 1e-6)
    scale = size / max(source_w, source_h)
    width, height = source_w * scale, source_h * scale

    fit = min(1.0, (2 * _DRAW_HALF_WIDTH) / width, (2 * _DRAW_HALF_HEIGHT) / height)
    scale *= fit
    width, height = width * fit, height * fit
    cx = _clamp(center[0], -_DRAW_HALF_WIDTH + width / 2, _DRAW_HALF_WIDTH - width / 2)
    cy = _clamp(center[1], -_DRAW_HALF_HEIGHT + height / 2, _DRAW_HALF_HEIGHT - height / 2)

    source_cx = (box[0] + box[2]) / 2
    source_cy = (box[1] + box[3]) / 2
    # Parts are authored y-up already, so unlike SVG paths there is no flip.
    rescale(built, scale, cx - source_cx * scale, cy - source_cy * scale)
    return built, _anchors(cx, cy, width, height)


def _fit_strokes(spec: dict, center, size: float, color_for) -> BuildResult:
    import svgelements

    parsed: list[tuple[Any, dict]] = []
    box: Optional[list[float]] = None
    for stroke in spec.get("strokes") or []:
        try:
            path = svgelements.Path(stroke["d"])
            extent = path.bbox()
        except Exception:
            # One unparseable stroke must not lose the whole drawing: the rest
            # of the object is still a truthful picture of itself.
            continue
        if extent is None:
            continue
        parsed.append((path, stroke))
        box = list(extent) if box is None else [
            min(box[0], extent[0]), min(box[1], extent[1]),
            max(box[2], extent[2]), max(box[3], extent[3]),
        ]
    if not parsed or box is None:
        return [], {}

    source_w = max(box[2] - box[0], 1e-6)
    source_h = max(box[3] - box[1], 1e-6)
    scale = size / max(source_w, source_h)
    width, height = source_w * scale, source_h * scale

    # The planner picks `center` and `size` blind — it has no bounding box for a
    # shape it has just invented, so it cannot know that a sun at [-6, 3] with
    # size 2.4 hangs off the corner. Half a sun is not a sun; it reads as a bug.
    fit = min(1.0, (2 * _DRAW_HALF_WIDTH) / width, (2 * _DRAW_HALF_HEIGHT) / height)
    scale *= fit
    width, height = width * fit, height * fit
    cx = _clamp(center[0], -_DRAW_HALF_WIDTH + width / 2, _DRAW_HALF_WIDTH - width / 2)
    cy = _clamp(center[1], -_DRAW_HALF_HEIGHT + height / 2, _DRAW_HALF_HEIGHT - height / 2)

    source_cx = (box[0] + box[2]) / 2
    source_cy = (box[1] + box[3]) / 2
    # SVG's y axis points down and the canvas' points up, so the fit flips y.
    # Without it every drawing arrives upside down — and a planner that "fixes"
    # that by negating its own y values produces a path wrong everywhere else.
    transform = {"sx": scale, "sy": -scale,
                 "tx": cx - source_cx * scale, "ty": cy + source_cy * scale}

    shapes: list[dict] = []
    for path, stroke in parsed:
        color = color_for(stroke.get("color") or "ink")
        extent = path.bbox()
        shapes.append({
            "kind": "path",
            "d": stroke["d"],
            "transform": dict(transform),
            "bbox": [
                extent[0] * transform["sx"] + transform["tx"],
                extent[3] * transform["sy"] + transform["ty"],
                extent[2] * transform["sx"] + transform["tx"],
                extent[1] * transform["sy"] + transform["ty"],
            ],
            "stroke": color,
            "width": _as_float(stroke.get("stroke_width"), 4.5),
            "fill": color,
            "fill_opacity": _as_float(stroke.get("fill_opacity"), 0.0),
        })
    return shapes, _anchors(cx, cy, width, height)


def _anchors(cx: float, cy: float, width: float, height: float) -> dict[str, Any]:
    half_w, half_h = width / 2, height / 2
    return {
        "bbox": [cx - half_w, cy - half_h, cx + half_w, cy + half_h],
        "top": [cx, cy + half_h + 0.24],
        "bottom": [cx, cy - half_h - 0.24],
        "left": [cx - half_w - 0.24, cy],
        "right": [cx + half_w + 0.24, cy],
        "center": [cx, cy],
    }
